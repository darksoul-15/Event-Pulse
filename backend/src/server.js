import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import eventsRouter from './events.routes.js';
import usersRouter from './users.routes.js';
import authRouter from './auth.routes.js';
import { query } from './db.js';
import { generateUserProfileEmbedding, generateEmbedding } from './ai.service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ---------------------------------------------------------------------------
// STARTUP: Auto-embed all users + seed events that have NULL embeddings
// ---------------------------------------------------------------------------
async function embedUsersOnStartup() {
  console.log('\n[Startup] Checking for users with NULL profile embeddings...');
  const { rows } = await query(
    'SELECT id, name, department, interests, skills, career_goals, location, past_event_descriptions FROM users WHERE profile_embedding IS NULL'
  );

  if (rows.length === 0) {
    console.log('[Startup] ✅ All users already have profile embeddings.');
    return;
  }

  console.log(`[Startup] Found ${rows.length} users without embeddings. Generating now...`);

  for (const user of rows) {
    try {
      const embedding = await generateUserProfileEmbedding(user);
      await query(
        'UPDATE users SET profile_embedding = $1::vector WHERE id = $2',
        [`[${embedding.join(',')}]`, user.id]
      );
      console.log(`[Startup] ✅ Embedded: ${user.name}`);
      // Rate limit: gemini-embedding-001 free tier = ~5 RPM, wait 1.5s between calls
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Startup] ❌ Failed to embed ${user.name}:`, err.message);
    }
  }

  console.log('[Startup] ✅ All user profile embeddings complete.\n');
}

async function embedSeedEventsOnStartup() {
  console.log('[Startup] Checking for seed events with NULL embeddings...');
  const { rows } = await query(
    'SELECT id, title, extracted_vibe, smart_categories, skill_tags, semantic_summary FROM events WHERE event_embedding IS NULL'
  );

  if (rows.length === 0) {
    console.log('[Startup] ✅ All seed events already have embeddings.');
    return;
  }

  console.log(`[Startup] Found ${rows.length} events without embeddings. Generating...`);

  for (const event of rows) {
    try {
      const categories = Array.isArray(event.smart_categories) ? event.smart_categories.join(', ') : '';
      const skills = Array.isArray(event.skill_tags) ? event.skill_tags.join(', ') : '';
      const text = `${event.title}. Vibe: ${event.extracted_vibe}. Categories: ${categories}. Skills: ${skills}. Summary: ${event.semantic_summary}`;
      const embedding = await generateEmbedding(text);
      await query(
        'UPDATE events SET event_embedding = $1::vector WHERE id = $2',
        [`[${embedding.join(',')}]`, event.id]
      );
      console.log(`[Startup] ✅ Embedded event: ${event.title}`);
      // Rate limit delay
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.error(`[Startup] ❌ Failed to embed event ${event.title}:`, err.message);
    }
  }

  console.log('[Startup] ✅ All seed event embeddings complete.\n');
}

// Routes
app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);
app.use('/api/users', usersRouter);

// Health check
app.get('/health', async (req, res) => {
  const { rows } = await query('SELECT COUNT(*) as count FROM users WHERE profile_embedding IS NOT NULL').catch(() => ({ rows: [{ count: 0 }] }));
  res.json({
    status: 'Backend operational',
    engine: 'Zero-Shot Vector Recommendation Engine',
    ai_provider: 'Google Gemini 3.6 Flash + gemini-embedding-001',
    vector_dim: 3072,
    embedded_users: Number(rows[0].count),
    database: 'PostgreSQL + pgvector',
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error Handler]:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Start server then run startup embedding
app.listen(PORT, async () => {
  console.log(`\n=============================================================`);
  console.log(`🚀 EventPulse AI Backend: http://localhost:${PORT}`);
  console.log(`🤖 AI Provider: Google Gemini 1.5 Flash + text-embedding-004`);
  console.log(`📦 Database: PostgreSQL + pgvector (768-dim)`);
  console.log(`=============================================================\n`);

  // Auto-embed users and seed events
  await embedUsersOnStartup();
  await embedSeedEventsOnStartup();
});
