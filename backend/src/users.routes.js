import express from 'express';
import { query } from './db.js';
import { getTopMatches } from './recommendations.js';
import { generateUserProfileEmbedding } from './ai.service.js';
import { authenticate } from './middleware/auth.js';

const router = express.Router();

/**
 * GET /api/users
 * Fetch all users from PostgreSQL (excluding embedding bytes)
 */
router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, department, interests, skills, career_goals, location, past_event_descriptions, created_at
       FROM users ORDER BY created_at ASC`
    );
    res.json({ count: result.rows.length, users: result.rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/users/me
 * Updates the current user's profile and regenerates embedding
 */
router.put('/me', authenticate, async (req, res, next) => {
  try {
    const { department, interests, skills, career_goals, location, past_event_descriptions } = req.body;
    
    // Update basic fields
    const updateQuery = `
      UPDATE users 
      SET 
        department = COALESCE($1, department),
        interests = COALESCE($2, interests),
        skills = COALESCE($3, skills),
        career_goals = COALESCE($4, career_goals),
        location = COALESCE($5, location),
        past_event_descriptions = COALESCE($6, past_event_descriptions)
      WHERE id = $7
      RETURNING *;
    `;
    
    const parsedInterests = Array.isArray(interests) ? interests : (interests ? interests.split(',').map(s=>s.trim()) : undefined);
    const parsedSkills = Array.isArray(skills) ? skills : (skills ? skills.split(',').map(s=>s.trim()) : undefined);

    const result = await query(updateQuery, [
      department,
      parsedInterests,
      parsedSkills,
      career_goals,
      location,
      past_event_descriptions,
      req.user.userId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result.rows[0];

    // Re-generate embeddings
    try {
      const embedding = await generateUserProfileEmbedding(updatedUser);
      await query(
        'UPDATE users SET profile_embedding = $1::vector WHERE id = $2',
        [`[${embedding.join(',')}]`, updatedUser.id]
      );
    } catch (err) {
        console.error('Embedding failed during update', err);
    }

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/users
 * Manually add a new user and immediately generate their profile embedding
 */
router.post('/', async (req, res, next) => {
  try {
    const { name, department, interests, skills, career_goals, location, past_event_descriptions } = req.body;

    // Validate required fields
    if (!name || !department || !career_goals || !location) {
      return res.status(400).json({
        error: 'Required fields: name, department, career_goals, location'
      });
    }

    const parsedInterests = Array.isArray(interests) ? interests : (interests || '').split(',').map(s => s.trim()).filter(Boolean);
    const parsedSkills = Array.isArray(skills) ? skills : (skills || '').split(',').map(s => s.trim()).filter(Boolean);

    // Check for duplicate name
    const existing = await query('SELECT id FROM users WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `User "${name}" already exists.` });
    }

    // Insert user first (without embedding)
    const insertResult = await query(
      `INSERT INTO users (name, department, interests, skills, career_goals, location, past_event_descriptions)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, department, interests, skills, career_goals, location, past_event_descriptions, created_at`,
      [name, department, parsedInterests, parsedSkills, career_goals, location, past_event_descriptions || '']
    );

    const newUser = insertResult.rows[0];
    console.log(`[Users API] ✅ New user created: ${newUser.name} (ID: ${newUser.id})`);

    // Generate profile embedding asynchronously (don't block the response)
    generateUserProfileEmbedding(newUser)
      .then(async (embedding) => {
        await query(
          'UPDATE users SET profile_embedding = $1::vector WHERE id = $2',
          [`[${embedding.join(',')}]`, newUser.id]
        );
        console.log(`[Users API] ✅ Profile embedding generated for: ${newUser.name}`);
      })
      .catch(err => {
        console.error(`[Users API] ⚠️  Embedding failed for ${newUser.name} (will retry on next match):`, err.message);
      });

    return res.status(201).json({
      success: true,
      message: `User "${name}" added successfully. Profile embedding is being generated.`,
      user: newUser
    });

  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/users/pool/clear-attendees
 * Bulk remove all attendee profiles from the candidate pool
 */
router.delete('/pool/clear-attendees', async (req, res, next) => {
  try {
    const result = await query("DELETE FROM users WHERE role = 'attendee' RETURNING id");
    res.json({ success: true, count: result.rows.length, message: `Deleted ${result.rows.length} attendee users.` });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/users/:userId
 * Remove a single user from the system
 */
router.delete('/:userId', async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM users WHERE id = $1 RETURNING name',
      [req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: `User "${result.rows[0].name}" deleted.` });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/profile/:userId
 */
router.get('/profile/:userId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, department, interests, skills, career_goals, location, past_event_descriptions, created_at
       FROM users WHERE id = $1`,
      [req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/recommendations/match?eventId=<eventId>
 * Zero-shot top matching users for a given event using pgvector cosine distance
 */
router.get('/recommendations/match', async (req, res, next) => {
  try {
    const { eventId } = req.query;
    if (!eventId) {
      return res.status(400).json({ error: 'Query parameter "eventId" is required.' });
    }
    const matches = await getTopMatches(eventId, 3);
    res.json(matches);
  } catch (error) {
    next(error);
  }
});

export default router;
