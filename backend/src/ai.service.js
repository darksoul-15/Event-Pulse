import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Gemini client
const gemini = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('your_gemini_api_key')
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

if (gemini) {
  console.log('[AI Service] ✅ Gemini AI initialized (gemini-3.6-flash + gemini-embedding-001)');
} else {
  console.warn('[AI Service] ⚠️  No GEMINI_API_KEY set — using smart fallback extractor & mock embeddings');
}

// ---------------------------------------------------------------------------
// RETRY HELPER: Exponential backoff for Gemini 429 rate limit errors
// Retries up to maxRetries times with doubling delay (baseMs * 2^attempt)
// ---------------------------------------------------------------------------
async function withRetry(fn, maxRetries = 3, baseMs = 2000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.includes('429') || err?.message?.includes('Too Many Requests') || err?.message?.includes('Quota exceeded');
      const isLastAttempt = attempt === maxRetries;

      if (isRateLimit && !isLastAttempt) {
        const delay = baseMs * Math.pow(2, attempt);
        console.warn(`[AI Service] ⏳ Rate limited (429). Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}


// ---------------------------------------------------------------------------
// FALLBACK: Deterministic 768-dim semantic mock embedding
// Produces consistent, domain-aware vectors when Gemini is not available.
// ---------------------------------------------------------------------------
function generateMockEmbedding(text, dimension = 3072) {
  const normalizedText = text.toLowerCase();

  let hash = 0;
  for (let i = 0; i < normalizedText.length; i++) {
    hash = (hash << 5) - hash + normalizedText.charCodeAt(i);
    hash |= 0;
  }

  const domains = [
    { keywords: ['ai', 'ml', 'machine learning', 'llm', 'python', 'pytorch', 'agent', 'langchain', 'prompt', 'saas', 'deep learning', 'neural'], weight: 1.2 },
    { keywords: ['design', 'figma', 'ux', 'ui', 'prototype', 'accessibility', 'components', 'visual', 'brand', 'user research', 'typography'], weight: 1.2 },
    { keywords: ['business', 'vc', 'startup', 'marketing', 'pitch', 'fundraising', 'esg', 'nonprofit', 'finance', 'revenue', 'growth'], weight: 1.2 },
    { keywords: ['game', 'unity', 'c#', 'shader', '3d', 'creative', 'graphics', 'indie', 'blender', 'unreal', 'procedural'], weight: 1.2 },
    { keywords: ['blockchain', 'web3', 'rust', 'solidity', 'crypto', 'devops', 'kubernetes', 'aws', 'docker', 'security', 'zk'], weight: 1.2 },
    { keywords: ['social', 'climate', 'impact', 'community', 'ngo', 'grant', 'equity', 'policy', 'environment', 'sustainability'], weight: 1.2 },
  ];

  const embedding = new Array(dimension);
  for (let i = 0; i < dimension; i++) {
    const angle = (i * 0.1) + hash;
    let val = Math.sin(angle) * 0.05;

    domains.forEach((domain, idx) => {
      const matchCount = domain.keywords.filter(kw => normalizedText.includes(kw)).length;
      if (matchCount > 0) {
        val += Math.cos(angle * (idx + 1)) * (matchCount * domain.weight * 0.2);
      }
    });

    embedding[i] = val;
  }

  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map(v => v / norm);
}

// ---------------------------------------------------------------------------
// 1. Extract Event Features using Gemini 1.5 Flash
// ---------------------------------------------------------------------------
export async function extractEventFeatures(rawDescription, titleHint = '') {
  console.log(`[AI Service] Extracting features: "${(titleHint || rawDescription).slice(0, 50)}..."`);

  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({
        model: 'models/gemini-3.6-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const prompt = `You are an expert event analyst. Extract structured metadata from this event description.

Raw Input: ${rawDescription}
Title Hint: ${titleHint || 'Not provided'}

Return ONLY valid JSON in this exact structure (no markdown, no extra text):
{
  "title": "event title string",
  "extracted_vibe": "short phrase describing atmosphere and energy",
  "smart_categories": ["category1", "category2"],
  "skill_tags": ["Skill1", "Skill2", "Skill3"],
  "target_audience": "description of ideal attendees",
  "difficulty_level": "beginner|intermediate|advanced",
  "career_relevance": "how this accelerates career growth",
  "budget_range": "free|$0-50|$50-100|$100+",
  "semantic_summary": "2-3 sentence summary emphasizing vibe, audience, and skills gained"
}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const extracted = JSON.parse(text);
      console.log(`[AI Service] ✅ Gemini extraction successful for "${extracted.title}"`);
      return extracted;
    } catch (err) {
      console.warn('[AI Service] Gemini extraction failed, using smart fallback:', err.message);
    }
  }

  // Smart rule-based fallback
  const lower = rawDescription.toLowerCase();

  let vibe = 'interactive & collaborative';
  if (lower.includes('hackathon')) vibe = 'fast-paced technical building & innovation';
  else if (lower.includes('agents') || lower.includes('llm')) vibe = 'cutting-edge AI development & learning';
  else if (lower.includes('design') || lower.includes('figma')) vibe = 'professional, system-focused design workshop';
  else if (lower.includes('business') || lower.includes('pitch') || lower.includes('startup')) vibe = 'entrepreneurial networking & pitch strategy';
  else if (lower.includes('blockchain') || lower.includes('web3')) vibe = 'decentralized tech & Web3 development';

  const categories = ['community', 'event'];
  if (lower.includes('hackathon')) categories.push('hackathon', 'building');
  if (lower.includes('ai') || lower.includes('llm') || lower.includes('agents')) categories.push('AI', 'machine-learning');
  if (lower.includes('design') || lower.includes('figma') || lower.includes('ux')) categories.push('design', 'UI/UX');
  if (lower.includes('startup') || lower.includes('business')) categories.push('startup', 'business');
  if (lower.includes('blockchain') || lower.includes('web3')) categories.push('blockchain', 'web3');
  if (lower.includes('devops') || lower.includes('cloud')) categories.push('cloud', 'DevOps');

  const skills = [];
  if (lower.includes('python')) skills.push('Python');
  if (lower.includes('llm') || lower.includes('prompt')) skills.push('LLM APIs', 'Prompt Engineering');
  if (lower.includes('langchain')) skills.push('LangChain');
  if (lower.includes('figma')) skills.push('Figma', 'Design Systems');
  if (lower.includes('react') || lower.includes('next')) skills.push('React', 'Next.js');
  if (lower.includes('rust') || lower.includes('solidity')) skills.push('Rust', 'Solidity');
  if (lower.includes('docker') || lower.includes('kubernetes')) skills.push('Docker', 'Kubernetes');
  if (skills.length === 0) skills.push('Problem Solving', 'Collaboration', 'Product Development');

  const title = titleHint || rawDescription.split(/[.\n]/)[0].slice(0, 60) || 'Exciting Tech Event';
  const summary = `${title}: A ${vibe} event. Categories include ${categories.slice(2).join(', ') || 'general tech'}. Key skills: ${skills.join(', ')}.`;

  return {
    title,
    extracted_vibe: vibe,
    smart_categories: categories,
    skill_tags: skills,
    target_audience: lower.includes('beginner') ? 'Students & beginners welcome' : 'Developers, designers, and founders',
    difficulty_level: lower.includes('intermediate') ? 'intermediate' : lower.includes('advanced') ? 'advanced' : 'beginner',
    career_relevance: 'Skill acquisition, networking, portfolio building, and professional growth',
    budget_range: lower.includes('free') ? 'free' : '$50-100',
    semantic_summary: summary
  };
}

// ---------------------------------------------------------------------------
// 2. Generate 3072-dim Embedding using Gemini gemini-embedding-001
// ---------------------------------------------------------------------------
export async function generateEmbedding(text) {
  if (gemini) {
    try {
      const embedding = await withRetry(async () => {
        const model = gemini.getGenerativeModel({ model: 'models/gemini-embedding-001' });
        const result = await model.embedContent(text);
        return result.embedding.values;
      });
      console.log(`[AI Service] ✅ Gemini embedding generated (${embedding.length}-dim) for "${text.slice(0, 40)}..."`);
      return embedding;
    } catch (err) {
      console.warn('[AI Service] Gemini embedding failed after retries, using mock vector:', err.message);
    }
  }

  return generateMockEmbedding(text, 3072);
}


// ---------------------------------------------------------------------------
// 3. Generate User Profile Embedding
// ---------------------------------------------------------------------------
export async function generateUserProfileEmbedding(userProfile) {
  const profileText = [
    `Name: ${userProfile.name}`,
    `Department: ${userProfile.department}`,
    `Location: ${userProfile.location}`,
    `Interests: ${Array.isArray(userProfile.interests) ? userProfile.interests.join(', ') : userProfile.interests}`,
    `Skills: ${Array.isArray(userProfile.skills) ? userProfile.skills.join(', ') : userProfile.skills}`,
    `Career Goals: ${userProfile.career_goals}`,
    `Past Events: ${userProfile.past_event_descriptions || 'None yet'}`
  ].join('. ');

  return generateEmbedding(profileText);
}

// ---------------------------------------------------------------------------
// 4. Generate Personalized 1-Sentence Explanation using Gemini 1.5 Flash
// ---------------------------------------------------------------------------
export async function generateExplanation(userProfile, eventMetadata, similarityScore) {
  const percentage = Math.round(Number(similarityScore) * 100);
  const skillTags = Array.isArray(eventMetadata.skill_tags) ? eventMetadata.skill_tags : (eventMetadata.skill_tags || '').split(',');
  const userSkills = Array.isArray(userProfile.skills) ? userProfile.skills : [];
  const userInterests = Array.isArray(userProfile.interests) ? userProfile.interests : [];

  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({ model: 'models/gemini-3.6-flash' });

      const prompt = `Write exactly 1 sentence (max 25 words) explaining why this event matches this user for a recommendation system.

User: ${userProfile.name}
Department: ${userProfile.department}
Career Goal: ${userProfile.career_goals}
Top Skills: ${userSkills.slice(0, 3).join(', ')}
Interests: ${userInterests.slice(0, 3).join(', ')}

Event: ${eventMetadata.title}
Vibe: ${eventMetadata.extracted_vibe}
Skills Taught: ${skillTags.slice(0, 3).join(', ')}
Match Score: ${percentage}%

Format EXACTLY: "Recommended for [Name] because [specific reason linking their profile to this event]."
Return ONLY that sentence, nothing else.`;

      const result = await model.generateContent(prompt);
      const explanation = result.response.text().trim();
      console.log(`[AI Service] ✅ Gemini explanation for ${userProfile.name}: ${explanation.slice(0, 60)}...`);
      return explanation;
    } catch (err) {
      console.warn('[AI Service] Gemini explanation failed, using rule-based fallback:', err.message);
    }
  }

  // Smart rule-based fallback
  const matchedSkill = userSkills.find(s =>
    skillTags.some(et => et.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(et.toLowerCase()))
  ) || userInterests[0] || 'technical background';

  return `Recommended for ${userProfile.name} because your expertise in ${matchedSkill} is a direct match for this event's ${eventMetadata.extracted_vibe || 'core focus'}.`;
}
