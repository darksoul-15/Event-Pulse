import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from './db.js';
import { authenticate } from './middleware/auth.js';
import { generateUserProfileEmbedding } from './ai.service.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'hackathon_secret_key';

// ---------------------------------------------------------------------------
// POST /api/auth/register
// Registers a new user (attendee or organizer) and auto-embeds if attendee
// ---------------------------------------------------------------------------
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, role, name, department, location, interests, skills, career_goals } = req.body;

    if (!email || !password || !role || !name) {
      return res.status(400).json({ error: 'Email, password, role, and name are required.' });
    }

    if (!['attendee', 'organizer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }

    // Check existing email
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const parsedInterests = Array.isArray(interests) ? interests : (interests || '').split(',').map(s => s.trim()).filter(Boolean);
    const parsedSkills = Array.isArray(skills) ? skills : (skills || '').split(',').map(s => s.trim()).filter(Boolean);

    // Insert user
    const insertResult = await query(
      `INSERT INTO users (name, email, password_hash, role, department, location, interests, skills, career_goals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email, role, department, location, interests, skills, career_goals, created_at`,
      [name, email, passwordHash, role, department || '', location || '', parsedInterests, parsedSkills, career_goals || '']
    );

    const newUser = insertResult.rows[0];

    // Auto-embed if attendee (organizers don't strictly need embeddings to post events, but we can embed them too)
    if (role === 'attendee') {
      generateUserProfileEmbedding(newUser)
        .then(async (embedding) => {
          await query(
            'UPDATE users SET profile_embedding = $1::vector WHERE id = $2',
            [`[${embedding.join(',')}]`, newUser.id]
          );
          console.log(`[Auth] ✅ Profile embedding generated for: ${newUser.name}`);
        })
        .catch(err => {
          console.error(`[Auth] ⚠️ Embedding failed for ${newUser.name}:`, err.message);
        });
    }

    // Generate JWT
    const token = jwt.sign({ userId: newUser.id, role: newUser.role, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      token,
      user: newUser
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign({ userId: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    
    // Omit password hash in response
    delete user.password_hash;
    delete user.profile_embedding; 

    res.json({
      success: true,
      token,
      user
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// Returns current logged in user
// ---------------------------------------------------------------------------
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, email, role, department, location, interests, skills, career_goals, created_at
       FROM users WHERE id = $1`,
      [req.user.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
