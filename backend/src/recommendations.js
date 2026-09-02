import { query } from './db.js';
import { generateUserProfileEmbedding, generateExplanation } from './ai.service.js';

/**
 * Zero-Shot Matching Engine using native PostgreSQL pgvector cosine distance (<=>)
 * Returns top K users matching a given event via 1536-dim vector similarity
 */
export async function getTopMatches(eventId, limit = 3) {

  // 1. Fetch event and its embedding from PostgreSQL
  const eventResult = await query(
    'SELECT id, title, extracted_vibe, skill_tags, event_embedding FROM events WHERE id = $1',
    [eventId]
  );

  if (eventResult.rows.length === 0) {
    throw new Error(`Event with ID "${eventId}" not found in database.`);
  }

  const event = eventResult.rows[0];

  if (!event.event_embedding) {
    throw new Error(`Event "${event.title}" has no embedding yet. It must be generated during ingestion.`);
  }

  // 2. Ensure all users have embeddings — lazy-generate for any that are NULL
  const nullEmbUsers = await query(
    'SELECT id, name, department, interests, skills, career_goals, location, past_event_descriptions FROM users WHERE profile_embedding IS NULL'
  );

  for (const user of nullEmbUsers.rows) {
    console.log(`[Zero-Shot] Lazy-generating embedding for user: ${user.name}`);
    const embedding = await generateUserProfileEmbedding(user);
    const vectorStr = `[${embedding.join(',')}]`;
    await query(
      'UPDATE users SET profile_embedding = $1::vector WHERE id = $2',
      [vectorStr, user.id]
    );
  }

  // 3. pgvector cosine distance query: (1 - distance) = cosine similarity
  //    <=> operator = cosine distance in pgvector
  //    ORDER BY distance ASC = highest similarity first
  const matchResult = await query(
    `SELECT
       u.id,
       u.name,
       u.department,
       u.interests,
       u.skills,
       u.career_goals,
       u.location,
       (1 - (u.profile_embedding <=> $1::vector)) AS relevance_score
     FROM users u
     WHERE u.profile_embedding IS NOT NULL
     ORDER BY relevance_score DESC
     LIMIT $2`,
    [event.event_embedding, limit]
  );

  // 4. Generate 1-sentence AI explanation for each top match
  const topMatches = await Promise.all(
    matchResult.rows.map(async (user, idx) => {
      const explanation = await generateExplanation(user, event, user.relevance_score);
      return {
        rank: idx + 1,
        user_id: user.id,
        user_name: user.name,
        department: user.department,
        interests: user.interests || [],
        skills: user.skills || [],
        career_goals: user.career_goals,
        location: user.location,
        relevance_score: Number(Number(user.relevance_score).toFixed(3)),
        explanation
      };
    })
  );

  return {
    event_id: event.id,
    event_title: event.title,
    extracted_vibe: event.extracted_vibe,
    top_matches: topMatches
  };
}
