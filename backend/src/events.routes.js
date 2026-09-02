import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { query } from './db.js';
import { extractEventFeatures, generateEmbedding } from './ai.service.js';
import { getTopMatches } from './recommendations.js';
import { authenticate } from './middleware/auth.js';

const router = express.Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// POST /api/events/:id/rsvp
// Registers / RSVPs the logged-in attendee for an event
// ---------------------------------------------------------------------------
router.post('/:id/rsvp', authenticate, async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const userId = req.user.userId;

    // Check if event exists
    const eventCheck = await query('SELECT id, title FROM events WHERE id = $1', [eventId]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found.' });
    }

    // Insert registration
    await query(
      `INSERT INTO event_registrations (event_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, userId]
    );

    console.log(`[RSVP] Attendee ${userId} registered for event: ${eventCheck.rows[0].title}`);

    res.json({
      success: true,
      message: `Successfully registered for "${eventCheck.rows[0].title}".`,
      event_id: eventId
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/registrations/my
// Returns list of event IDs the current attendee has registered for
// ---------------------------------------------------------------------------
router.get('/registrations/my', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const result = await query(
      'SELECT event_id, registered_at FROM event_registrations WHERE user_id = $1 ORDER BY registered_at DESC',
      [userId]
    );
    res.json({ registered_event_ids: result.rows.map(r => r.event_id), registrations: result.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/overview/with-registrations
// Returns all events with their registered attendees list for Organizer Dashboard
// ---------------------------------------------------------------------------
router.get('/overview/with-registrations', async (req, res, next) => {
  try {
    const eventsQuery = `
      SELECT 
        e.id, 
        e.title, 
        e.extracted_vibe, 
        e.smart_categories, 
        e.skill_tags,
        e.target_audience, 
        e.difficulty_level, 
        e.career_relevance, 
        e.budget_range,
        e.location, 
        e.duration, 
        e.semantic_summary, 
        e.created_at,
        COUNT(er.id) AS registration_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', u.id,
              'name', u.name,
              'email', u.email,
              'department', u.department,
              'location', u.location,
              'skills', u.skills,
              'career_goals', u.career_goals,
              'registered_at', er.registered_at
            )
          ) FILTER (WHERE u.id IS NOT NULL),
          '[]'
        ) AS registered_attendees
      FROM events e
      LEFT JOIN event_registrations er ON e.id = er.event_id
      LEFT JOIN users u ON er.user_id = u.id
      GROUP BY e.id
      ORDER BY e.created_at DESC;
    `;
    const result = await query(eventsQuery);
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/events/feed
// Gets personalized event feed for current attendee using their embedding
// ---------------------------------------------------------------------------
router.get('/feed', authenticate, async (req, res, next) => {
  try {
    const userResult = await query('SELECT profile_embedding FROM users WHERE id = $1', [req.user.userId]);
    if (userResult.rows.length === 0 || !userResult.rows[0].profile_embedding) {
      // Fallback: just return latest events if user has no embedding yet
      const events = await query('SELECT * FROM events ORDER BY created_at DESC');
      return res.json({ events: events.rows });
    }

    const embedding = userResult.rows[0].profile_embedding;

    // Vector search against event embeddings (no limit, return all)
    const feedQuery = `
      SELECT 
        *,
        (1 - (event_embedding <=> $1::vector)) AS match_score
      FROM events
      WHERE event_embedding IS NOT NULL
      ORDER BY event_embedding <=> $1::vector;
    `;
    const feed = await query(feedQuery, [embedding]);

    res.json({ events: feed.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/events
 * Ingest event (text or image) → extract features → generate vector → save to PostgreSQL → match
 */
router.post('/', authenticate, upload.single('poster'), async (req, res, next) => {
  try {
    const { title, description, location, duration } = req.body;
    const rawDescription = description || (req.file ? `Poster image: ${req.file.originalname}` : '');

    if (!rawDescription) {
      return res.status(400).json({ error: 'Event description or poster image is required.' });
    }

    console.log(`[Ingestion] Processing event: "${title || 'Untitled'}"`);

    // 1. AI Feature Extraction
    const extracted = await extractEventFeatures(rawDescription, title);

    // 2. Build semantic text for embedding
    const embeddingInput = `${extracted.title}. Vibe: ${extracted.extracted_vibe}. Categories: ${(extracted.smart_categories || []).join(', ')}. Skills: ${(extracted.skill_tags || []).join(', ')}. Summary: ${extracted.semantic_summary}`;

    // 3. Generate 1536-dim vector embedding
    const vectorEmbedding = await generateEmbedding(embeddingInput);
    const vectorStr = `[${vectorEmbedding.join(',')}]`;

    // 4. Insert into PostgreSQL events table
    const insertResult = await query(
      `INSERT INTO events (
        title, raw_description, extracted_vibe, smart_categories, skill_tags,
        target_audience, difficulty_level, career_relevance, budget_range,
        location, duration, semantic_summary, event_embedding
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
      ON CONFLICT (title) DO UPDATE SET
        raw_description = EXCLUDED.raw_description,
        extracted_vibe = EXCLUDED.extracted_vibe,
        smart_categories = EXCLUDED.smart_categories,
        skill_tags = EXCLUDED.skill_tags,
        target_audience = EXCLUDED.target_audience,
        difficulty_level = EXCLUDED.difficulty_level,
        career_relevance = EXCLUDED.career_relevance,
        budget_range = EXCLUDED.budget_range,
        location = EXCLUDED.location,
        duration = EXCLUDED.duration,
        semantic_summary = EXCLUDED.semantic_summary,
        event_embedding = EXCLUDED.event_embedding
      RETURNING id, title`,
      [
        extracted.title || title || 'Untitled Event',
        rawDescription,
        extracted.extracted_vibe || '',
        extracted.smart_categories || [],
        extracted.skill_tags || [],
        extracted.target_audience || 'General Tech Audience',
        extracted.difficulty_level || 'beginner',
        extracted.career_relevance || 'Career development',
        extracted.budget_range || 'free',
        location || extracted.location || 'Remote / TBD',
        duration || extracted.duration || '1 day',
        extracted.semantic_summary || '',
        vectorStr
      ]
    );

    const savedEvent = insertResult.rows[0];
    console.log(`[Ingestion] Event saved to PostgreSQL: ID ${savedEvent.id}`);

    // 5. Run Zero-Shot Matching
    const matchResults = await getTopMatches(savedEvent.id, 3);

    return res.status(201).json({
      success: true,
      event: {
        id: savedEvent.id,
        title: extracted.title || title,
        extracted_vibe: extracted.extracted_vibe,
        smart_categories: extracted.smart_categories,
        skill_tags: extracted.skill_tags,
        target_audience: extracted.target_audience,
        difficulty_level: extracted.difficulty_level,
        career_relevance: extracted.career_relevance,
        budget_range: extracted.budget_range,
        location: location || extracted.location || 'Remote / TBD',
        duration: duration || extracted.duration || '1 day',
        semantic_summary: extracted.semantic_summary,
      },
      matches: matchResults.top_matches
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/events
 * Return all ingested events (excluding raw embedding bytes)
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, extracted_vibe, smart_categories, skill_tags,
              target_audience, difficulty_level, career_relevance, budget_range,
              location, duration, semantic_summary, created_at
       FROM events ORDER BY created_at DESC`
    );
    res.json({ count: result.rows.length, events: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/events/:eventId
 */
router.get('/:eventId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, title, extracted_vibe, smart_categories, skill_tags,
              target_audience, difficulty_level, career_relevance, budget_range,
              location, duration, semantic_summary, created_at
       FROM events WHERE id = $1`,
      [req.params.eventId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
