-- =============================================================================
-- AI-Powered Event Intelligence & Personalized Recommendation System
-- Phase 1: Database Initialization Script
-- PostgreSQL + pgvector | Google Gemini text-embedding-004 (768 dimensions)
-- =============================================================================

-- Enable pgvector extension (must be installed first; see README.md)
CREATE EXTENSION IF NOT EXISTS vector;
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- TABLE: users
-- Represents the pool of users available for zero-shot event matching.
-- profile_embedding is NULL at creation; populated in Phase 2 by the backend.
-- =============================================================================

DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    email                   VARCHAR(255) UNIQUE NOT NULL,
    password_hash           VARCHAR(255) NOT NULL,
    role                    VARCHAR(50)  NOT NULL CHECK (role IN ('attendee', 'organizer')),
    department              VARCHAR(255) NOT NULL,
    interests               TEXT[]       NOT NULL DEFAULT '{}',
    skills                  TEXT[]       NOT NULL DEFAULT '{}',
    career_goals            TEXT         NOT NULL,
    location                VARCHAR(255) NOT NULL,
    past_event_descriptions TEXT         NOT NULL DEFAULT '',
    profile_embedding       vector(3072),                          -- NULL until startup auto-embed (Gemini gemini-embedding-001, 3072-dim)
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: events
-- Represents events ingested via poster or text description.
-- event_embedding is NULL at creation; populated in Phase 2 during ingestion.
-- =============================================================================

CREATE TABLE events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title               VARCHAR(500) NOT NULL UNIQUE,
    raw_description     TEXT         NOT NULL,
    extracted_vibe      VARCHAR(500),
    smart_categories    TEXT[]       NOT NULL DEFAULT '{}',
    skill_tags          TEXT[]       NOT NULL DEFAULT '{}',
    target_audience     VARCHAR(500),
    difficulty_level    VARCHAR(50)  CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
    career_relevance    VARCHAR(500),
    budget_range        VARCHAR(100),
    location            VARCHAR(255),
    duration            VARCHAR(100),
    semantic_summary    TEXT,
    event_embedding     vector(3072),                              -- NULL until startup auto-embed (Gemini gemini-embedding-001, 3072-dim)
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: event_registrations
-- Tracks attendee RSVPs/registrations for events shown on Organizer Dashboard
-- =============================================================================

DROP TABLE IF EXISTS event_registrations CASCADE;

CREATE TABLE event_registrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registered_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- User lookup by name (for deduplication)
CREATE INDEX idx_users_name ON users (name);

-- Event lookup by title (for deduplication on re-ingestion)
CREATE INDEX idx_events_title ON events (title);

-- Event feed ordering by newest first
CREATE INDEX idx_events_created_at ON events (created_at DESC);

-- Optional: IVFFlat vector indexes (uncomment after populating embeddings in Phase 2)
-- These dramatically speed up ANN search on large datasets.
-- CREATE INDEX idx_users_embedding ON users USING ivfflat (profile_embedding vector_cosine_ops) WITH (lists = 10);
-- CREATE INDEX idx_events_embedding ON events USING ivfflat (event_embedding vector_cosine_ops) WITH (lists = 5);

-- =============================================================================
-- MOCK USER PROFILES (8 Diverse, Rich Profiles)
-- profile_embedding intentionally NULL — populated in Phase 2
-- =============================================================================

INSERT INTO users (name, email, password_hash, role, department, interests, skills, career_goals, location, past_event_descriptions, profile_embedding)
VALUES

-- Password for all mock users is 'password123' (bcrypt hash)
-- $2a$10$wN9H1Z.uV/9L7oYy9/OQh.b/3V9.p/9Z9/9/9/9/9/9/9/9/9/9/9 (using a generic hash for brevity, will just insert standard mock hash)

-- 1. Alex Chen — AI/ML-focused CS student, startup-oriented
(
    'Alex Chen',
    'alex@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe', -- password123
    'attendee',
    'Computer Science',
    ARRAY['Artificial Intelligence', 'Machine Learning', 'LLM APIs', 'Startups', 'Open Source'],
    ARRAY['Python', 'PyTorch', 'LangChain', 'LLM Prompting', 'FastAPI', 'Git'],
    'Build and launch an AI-powered SaaS product. Eventually found a venture-backed startup in the AI infrastructure space.',
    'San Francisco',
    'Attended the OpenAI DevDay 2024 hackathon where he built a real-time voice assistant using GPT-4o. Also participated in a 24-hour LangChain Agents sprint where his team won 2nd place for an autonomous research agent.',
    NULL
),

-- 2. Maya Patel — UX/product designer, web3 and community focus
(
    'Maya Patel',
    'maya@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe',
    'attendee',
    'Design',
    ARRAY['UX/UI Design', 'Web3', 'Community Building', 'Design Systems', 'Accessibility'],
    ARRAY['Figma', 'Prototyping', 'User Research', 'Usability Testing', 'Adobe XD', 'HTML/CSS'],
    'Lead design at a cutting-edge product studio focused on Web3 and decentralized experiences. Eventually start my own design consultancy.',
    'New York',
    'Attended the Design Systems Conference 2024 in NYC where she presented a lightning talk on accessible component libraries. Also joined a Web3 UX Jam, collaborating with blockchain developers to redesign an NFT minting flow.',
    NULL
),

-- 3. Jordan Smith — entrepreneurship and VC-focused business student
(
    'Jordan Smith',
    'jordan@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe',
    'attendee',
    'Business',
    ARRAY['Entrepreneurship', 'Venture Capital', 'Growth Marketing', 'SaaS Metrics', 'Pitch Decks'],
    ARRAY['Public Speaking', 'Financial Modeling', 'Excel', 'Notion', 'CRM Tools', 'Storytelling'],
    'Raise a Series A round for a B2B SaaS startup. Become a general partner at an early-stage VC fund within 10 years.',
    'Remote',
    'Attended TechCrunch Disrupt 2024 as a startup exhibitor, pitching his MVP to investors and journalists. Also joined a Y Combinator Startup School cohort, completing the 10-week program on product-market fit and fundraising.',
    NULL
),

-- 4. Casey Nguyen — game developer and creative coder
(
    'Casey Nguyen',
    'casey@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe',
    'attendee',
    'Computer Science',
    ARRAY['Game Development', 'Creative Coding', 'Procedural Generation', 'Graphics Programming', 'Indie Games'],
    ARRAY['C#', 'Unity', 'HLSL/Shader Programming', 'Blender', 'C++', 'OpenGL'],
    'Ship a critically acclaimed indie game and eventually found a small indie game studio specializing in procedurally generated worlds.',
    'Seattle',
    'Attended the GDC 2024 talk on procedural generation in open-world games. Also participated in Ludum Dare 55 game jam, building a complete puzzle game solo in 48 hours that was rated in the top 10% for innovation.',
    NULL
),

-- 5. Sophia Garcia — sustainable fashion and AR designer
(
    'Sophia Garcia',
    'sophia@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe',
    'attendee',
    'Design',
    ARRAY['Sustainable Fashion', 'Augmented Reality', '3D Design', 'Ethical Tech', 'Brand Identity'],
    ARRAY['Adobe Creative Cloud', 'CLO 3D', 'Blender', 'SparkAR', 'Sustainable Materials Research', 'Brand Strategy'],
    'Start an ethical fashion brand that uses AR try-on technology and sustainable manufacturing. Bridge the gap between technology and conscious fashion.',
    'London',
    'Attended the Fashion Tech Forum 2024 in London, where she workshopped AR-powered virtual fitting rooms with engineers and fashion designers. Also joined a sustainability hackathon focused on circular fashion supply chains.',
    NULL
),

-- 6. Rahul Verma — blockchain and Web3 security engineer
(
    'Rahul Verma',
    'rahul@example.com',
    '$2b$10$EEyl3ptAghTkghVqS9QNeOQS0tvaPn409s23GrQEw.sPZdDV9jmSe',
    'attendee',
    'Computer Science',
    ARRAY['Blockchain', 'Smart Contract Security', 'DevOps', 'Zero-Knowledge Proofs', 'DeFi'],
    ARRAY['Rust', 'Solidity', 'Docker', 'Kubernetes', 'Foundry', 'Hardhat', 'Linux'],
    'Build critical Web3 infrastructure — specifically zero-knowledge proof systems for private DeFi protocols. Contribute to foundational open-source cryptography libraries.',
    'Bangalore',
    'Attended EthCC Brussels 2024 where he presented a research poster on ZK rollup optimization. Also completed an intensive smart contract auditing bootcamp, finding 3 critical vulnerabilities in practice CTF contracts.',
    NULL
),

-- 7. Emma Johnson — social impact and ESG nonprofit professional
(
    'Emma Johnson',
    'emma@example.com',
    '$2a$10$tZ8QyC2M9J7YyD2/8v0fE.C5Qx4GzI6R6K5P/X4F3h7J2q2O5u8V2',
    'attendee',
    'Business',
    ARRAY['ESG', 'Social Impact', 'Nonprofits', 'Community Organizing', 'Climate Policy'],
    ARRAY['Grant Writing', 'Fundraising', 'Community Organizing', 'Impact Measurement', 'Storytelling', 'Stakeholder Management'],
    'Found a tech-enabled nonprofit focused on climate justice and equitable access to green energy for underserved communities.',
    'Boston',
    'Attended the Dassi Foundation Social Innovation Summit 2024, where she co-facilitated a workshop on impact measurement frameworks. Also participated in a 3-day climate hackathon, developing a community energy-sharing platform that won the "Most Impactful" award.',
    NULL
),

-- 8. Liam O''Brien — DevOps and cloud platform engineer
(
    'Liam O''Brien',
    'liam@example.com',
    '$2a$10$tZ8QyC2M9J7YyD2/8v0fE.C5Qx4GzI6R6K5P/X4F3h7J2q2O5u8V2',
    'attendee',
    'Computer Science',
    ARRAY['DevOps', 'Cloud Architecture', 'Platform Engineering', 'Observability', 'Site Reliability Engineering'],
    ARRAY['Kubernetes', 'AWS', 'Terraform', 'Prometheus', 'Grafana', 'Go', 'Bash', 'ArgoCD'],
    'Become a Staff Engineer or Principal Platform Engineer, leading cloud infrastructure at a high-growth tech company. Long-term, architect multi-cloud platforms that serve millions of users.',
    'Dublin',
    'Attended KubeCon Europe 2024 in Paris, participating in co-located events on eBPF and GitOps. Also completed the AWS Solutions Architect Professional certification after a focused 6-week study sprint.',
    NULL
);

-- =============================================================================
-- SEED EVENTS (2 sample events for Phase 2 testing)
-- event_embedding intentionally NULL — populated during ingestion in Phase 2
-- =============================================================================

INSERT INTO events (
    title, raw_description, extracted_vibe, smart_categories, skill_tags,
    target_audience, difficulty_level, career_relevance, budget_range,
    location, duration, semantic_summary, event_embedding
)
VALUES

-- Event 1: AI Agents Hackathon
(
    'AI Agents Hackathon 2024',
    '48-hour hackathon focused on building autonomous AI agents. Teams of 2-4 will prototype AI systems that can reason, plan, and act independently. Tracks include: customer support agents, research assistants, and code generation agents. Free entry. Beginner-friendly workshops on Day 1. Hosted at our San Francisco office. Prizes: $5,000 first place, $2,500 second place. Meals and drinks provided.',
    'fast-paced technical learning, collaborative innovation',
    ARRAY['hackathon', 'AI', 'agents', 'autonomous systems', 'LLM'],
    ARRAY['Python', 'LLM APIs', 'LangChain', 'Prompt Engineering', 'Teamwork', 'Rapid Prototyping'],
    'CS students, AI enthusiasts, startup founders, software engineers curious about LLMs',
    'beginner',
    'AI career transition, startup preparation, LLM portfolio building',
    'free',
    'San Francisco',
    '2 days',
    'Fast-paced 48-hour hackathon for building autonomous AI agents using LLM APIs. Hands-on, collaborative, beginner-friendly with workshops on Day 1. Great for CS students and startup founders wanting to build AI agent portfolios and explore autonomous systems, prompt engineering, and LangChain.',
    NULL
),

-- Event 2: Figma Design Systems Workshop
(
    'Figma Design Systems Workshop',
    'Learn how to build and scale enterprise design systems in Figma. This full-day interactive workshop covers component libraries, design tokens, documentation best practices, and team governance models. Led by senior designers from Airbnb and Stripe. $50 registration fee. Limited to 30 participants for a hands-on experience. Located in NYC (Midtown).',
    'professional, systems-thinking, collaborative learning',
    ARRAY['workshop', 'design', 'systems', 'Figma', 'UI', 'enterprise'],
    ARRAY['Figma', 'Design Systems', 'Component Libraries', 'Design Tokens', 'User Research', 'Documentation'],
    'Designers, design leads, senior product designers, product managers working on design-engineering collaboration',
    'intermediate',
    'Design career progression, senior IC to design lead transition, enterprise design skills',
    '$50-100',
    'New York',
    '1 day',
    'Professional full-day workshop on building and scaling Figma design systems. Taught by Airbnb and Stripe senior designers. Covers component libraries, design tokens, governance, and documentation. Ideal for intermediate designers aiming for senior or lead roles at product companies.',
    NULL
),

-- Event 3: Web3 & Smart Contract Security Summit
(
    'Web3 & Smart Contract Security Summit',
    'A deep-dive technical conference on Ethereum protocol security, smart contract auditing, and zero-knowledge proofs. Featuring keynote workshops on vulnerability detection in DeFi protocols, fuzzing tools, and formal verification methods. Ideal for blockchain developers and security researchers.',
    'intensive, technical, security-focused, research-oriented',
    ARRAY['conference', 'blockchain', 'security', 'web3', 'cryptography', 'defi'],
    ARRAY['Solidity', 'Smart Contract Security', 'Zero-Knowledge Proofs', 'DeFi', 'Rust', 'Auditing'],
    'Blockchain developers, security auditors, cryptographers, CS graduate students',
    'advanced',
    'Transitioning to Web3 security auditor, smart contract engineer, protocol architect',
    '$100-250',
    'Bangalore',
    '3 days',
    'Technical summit covering smart contract auditing, zero-knowledge proofs, and DeFi protocol vulnerability analysis. Tailored for advanced developers and security researchers aiming for high-impact Web3 security roles.',
    NULL
),

-- Event 4: Early-Stage Founder Pitch & VC Mixer
(
    'Early-Stage Founder Pitch & VC Mixer',
    'Connect directly with leading seed-stage venture capitalists, angel investors, and accelerator scouts. 15 pre-selected student and early-stage founders will pitch live on stage followed by open networking with food and drinks. Workshop on structuring term sheets and SaaS unit economics before the pitches.',
    'high-energy, entrepreneurial, networking, investment-focused',
    ARRAY['networking', 'startup', 'venture capital', 'pitch', 'business', 'funding'],
    ARRAY['Pitch Decks', 'Venture Capital', 'SaaS Metrics', 'Storytelling', 'Financial Modeling', 'Networking'],
    'Student founders, early-stage startup creators, business students, angel investors',
    'beginner',
    'Fundraising preparation, startup founder networking, incubator and accelerator admission',
    'free',
    'Remote',
    '1 evening',
    'Exclusive founder pitch night with top-tier seed VCs and angels. Includes actionable workshops on pitch deck design, valuation, and term sheets. Perfect for entrepreneurial students seeking funding and mentorship.',
    NULL
),

-- Event 5: Sustainable Fashion & AR 3D Runway
(
    'Sustainable Fashion & AR 3D Runway',
    'Explore the intersection of ethical textile innovation and immersive 3D technology. Experience live AR virtual try-on demos in Unity, spatial computing showcases for digital fashion, and sustainable supply chain panels with ethical brand creators.',
    'creative, visionary, immersive, eco-conscious',
    ARRAY['showcase', 'fashion', 'augmented reality', '3D', 'sustainability', 'creative tech'],
    ARRAY['Augmented Reality', '3D Design', 'Unity', 'Blender', 'Sustainable Materials', 'Spatial Design'],
    'Fashion designers, 3D artists, AR/VR developers, sustainability advocates',
    'intermediate',
    'Digital fashion designer, 3D spatial computing artist, ethical brand director',
    '$25-50',
    'London',
    '2 days',
    'Cutting-edge showcase exploring digital fashion, Unity AR virtual fitting, and circular textile design. Combines hands-on 3D workshops with panels on ethical manufacturing and sustainable fashion futures.',
    NULL
),

-- Event 6: Generative Game AI & Procedural Worlds Hack
(
    'Generative Game AI & Procedural Worlds Hack',
    'A 36-hour game jam dedicated to experimental game mechanics, procedural world generation, and LLM-driven NPC behavior. Work solo or in teams to build innovative indie games using Godot, Unreal Engine, or custom WebGL engines. Industry judges from leading indie studios.',
    'experimental, creative coding, playful, intense',
    ARRAY['game jam', 'gaming', 'AI', 'procedural generation', 'graphics', 'creative coding'],
    ARRAY['Game Development', 'C#', 'C++', 'Procedural Generation', 'Shaders', 'Graphics Programming'],
    'Indie game developers, creative coders, graphics engineers, technical artists',
    'intermediate',
    'Indie game publishing, technical artist career, gaming studio recruitment',
    'free',
    'Seattle',
    '36 hours',
    'Intensive game jam challenging creators to build procedural worlds and AI-driven gameplay mechanics. Judged by prominent indie developers with workshops on shader programming and runtime procedural generation.',
    NULL
),

-- Event 7: Climate Tech & Social Impact Accelerator Sprint
(
    'Climate Tech & Social Impact Accelerator Sprint',
    'Collaborative 2-day sprint bringing together environmental scientists, policy analysts, and software engineers to build tech solutions for renewable energy access and carbon footprint verification. Mentorship from non-profit leaders and clean-tech venture funds.',
    'mission-driven, collaborative, analytical, purposeful',
    ARRAY['sprint', 'climate', 'social impact', 'sustainability', 'policy', 'data'],
    ARRAY['Data Analysis', 'Climate Tech', 'ESG Metrics', 'Public Policy', 'Python', 'Impact Assessment'],
    'Environmental science students, social entrepreneurs, data scientists, policy researchers',
    'beginner',
    'Climate tech startup roles, sustainability consulting, non-profit technology leadership',
    'free',
    'Boston',
    '2 days',
    'Mission-driven hack sprint addressing renewable energy distribution and verifiable carbon metrics. Teams collaborate directly with climate scientists and non-profit leaders to build actionable prototypes.',
    NULL
),

-- Event 8: Kubernetes & Cloud Infrastructure Masterclass
(
    'Kubernetes & Cloud Infrastructure Masterclass',
    'An intensive, hands-on production engineering masterclass. Learn how to architect zero-downtime Kubernetes clusters, implement GitOps with ArgoCD, automate multi-cloud infrastructure using Terraform, and optimize observability with Prometheus and Grafana.',
    'rigorous, practical, architecture-driven, deep-dive',
    ARRAY['masterclass', 'devops', 'cloud', 'kubernetes', 'infrastructure', 'sre'],
    ARRAY['Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Linux', 'Observability', 'Go'],
    'DevOps engineers, backend developers, site reliability engineers, systems architects',
    'advanced',
    'Senior DevOps engineer, Cloud Architect, Site Reliability Lead',
    '$150-300',
    'Dublin',
    '2 days',
    'Production-grade cloud architecture workshop covering Kubernetes cluster management, GitOps deployments, and resilient infrastructure-as-code. Designed for engineers scaling high-throughput enterprise systems.',
    NULL
),

-- Event 9: Next.js 15 & Full-Stack AI Application Bootcamp
(
    'Next.js 15 & Full-Stack AI Application Bootcamp',
    'Build and deploy production-ready AI SaaS applications from scratch. Covers React Server Components, streaming UI, vector database integration with pgvector, and LLM orchestration with LangChain and Vercel AI SDK. Includes auth, Stripe billing, and deployment.',
    'practical, builder-oriented, fast-paced, commercial',
    ARRAY['bootcamp', 'fullstack', 'react', 'nextjs', 'typescript', 'ai apps'],
    ARRAY['React', 'Next.js', 'TypeScript', 'Node.js', 'PostgreSQL', 'Tailwind CSS', 'Vector DBs'],
    'Full-stack developers, frontend engineers transitioning to AI, software engineering students',
    'intermediate',
    'Full-stack AI developer, SaaS startup builder, senior frontend engineer',
    '$75-150',
    'San Francisco',
    '3 days',
    'Comprehensive hands-on bootcamp teaching how to architect and ship modern full-stack AI SaaS web apps using Next.js 15, PostgreSQL vector databases, and responsive UI components.',
    NULL
),

-- Event 10: Product Leadership & Growth Metrics Summit
(
    'Product Leadership & Growth Metrics Summit',
    'Learn frameworks for product-led growth, customer retention loops, and data-driven prioritization from VP of Product leaders at top tech companies. Interactive case studies on pricing models, A/B testing at scale, and AI product management.',
    'strategic, executive, analytical, leadership-focused',
    ARRAY['summit', 'product', 'leadership', 'growth', 'analytics', 'strategy'],
    ARRAY['Product Management', 'Growth Marketing', 'Data Analytics', 'A/B Testing', 'User Research', 'Strategy'],
    'Product managers, growth leads, business analysts, aspiring VP of Products',
    'advanced',
    'Senior Product Manager to Director of Product promotion, startup CPO readiness',
    '$100-200',
    'New York',
    '2 days',
    'Executive summit for product managers and growth practitioners focusing on user retention, PLG loops, pricing architecture, and managing AI-powered software products.',
    NULL
);

-- =============================================================================
-- VERIFICATION QUERIES (run these after executing the script)
-- =============================================================================

-- Expected: 8
SELECT COUNT(*) AS user_count FROM users;

-- Expected: 10
SELECT COUNT(*) AS event_count FROM events;

-- Quick sanity check: user profiles
SELECT name, department, location, array_length(interests, 1) AS interest_count
FROM users
ORDER BY created_at;

-- Quick sanity check: events
SELECT title, difficulty_level, location, duration
FROM events
ORDER BY created_at;
