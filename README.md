# AI-Powered Event Intelligence & Recommendation System

> **Zero-shot semantic event matching** — instantly connect new events to the right users without any historical interaction data.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React 18, Tailwind CSS v4, shadcn/ui |
| Backend | Node.js 18+, Express.js 4.x |
| Vector DB | PostgreSQL + pgvector |
| AI/Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| AI/Extraction | OpenAI `gpt-4o-mini` |

---

## Project Structure

```
HACKGURU/
├── db/
│   └── setup.sql          ← Phase 1: Schema + mock users + seed events
├── backend/               ← Phase 2: Express API, ingestion, matcher
├── frontend/              ← Phase 3: Next.js dashboard UI
├── .env.example           ← Copy to .env and fill in values
└── README.md
```

---

## Phase 1: PostgreSQL + pgvector Setup (Windows)

Follow these steps **in order** before running `setup.sql`.

---

### Step 1: Install PostgreSQL 16 on Windows

1. Download the installer from: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
   - Choose **PostgreSQL 16** for Windows x86-64
2. Run the installer:
   - Keep the default installation directory
   - **Stack Builder is optional** — you can skip it for now
   - Set a **superuser password** for the `postgres` user (save this — you'll need it)
   - Default port: `5432` ✅
3. After installation, open **pgAdmin 4** (installed alongside PostgreSQL) to verify it's running.

---

### Step 2: Install pgvector Extension

pgvector must be installed as a PostgreSQL extension. On Windows, the easiest method is via **Stack Builder** or manual DLL copy.

#### Option A: Stack Builder (Recommended)
1. Open **Stack Builder** (search in Start Menu)
2. Select your PostgreSQL 16 installation
3. Under **Database Drivers → Add-ons**, find **pgvector** and install it

#### Option B: Manual Install (if Stack Builder fails)
1. Download the pre-built Windows binary from: https://github.com/pgvector/pgvector/releases
   - Download `pgvector-pg16-windows-x64.zip` (or similar)
2. Extract and copy:
   - `vector.dll` → `C:\Program Files\PostgreSQL\16\lib\`
   - `vector.control` → `C:\Program Files\PostgreSQL\16\share\extension\`
   - `vector--*.sql` files → `C:\Program Files\PostgreSQL\16\share\extension\`
3. Restart PostgreSQL service:
   ```powershell
   Restart-Service -Name postgresql-x64-16
   ```

#### Verify pgvector is available
Open **psql** or pgAdmin and run:
```sql
SELECT * FROM pg_available_extensions WHERE name = 'vector';
```
You should see one row returned.

---

### Step 3: Create the Database

Open a terminal and run:

```powershell
# Connect as postgres superuser
psql -U postgres -h localhost

# Inside psql, create the database:
CREATE DATABASE event_recsys;
\q
```

---

### Step 4: Run the Setup Script

```powershell
# From the HACKGURU root directory:
psql -U postgres -h localhost -d event_recsys -f db/setup.sql
```

You should see output ending with verification query results.

---

### Step 5: Verify

```powershell
psql -U postgres -h localhost -d event_recsys -c "SELECT COUNT(*) AS user_count FROM users;"
```

Expected output:
```
 user_count
------------
          8
(1 row)
```

```powershell
psql -U postgres -h localhost -d event_recsys -c "SELECT COUNT(*) AS event_count FROM events;"
```

Expected output:
```
 event_count
-------------
           2
(1 row)
```

---

### Step 6: Configure Environment

```powershell
# Copy the example env file
Copy-Item .env.example .env

# Open .env and fill in:
# DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/event_recsys
# OPENAI_API_KEY=sk-your_actual_key_here
```

---

## Phase 1 Checklist

- [ ] PostgreSQL 16 installed and running
- [ ] pgvector extension installed
- [ ] `event_recsys` database created
- [ ] `db/setup.sql` executed successfully
- [ ] `SELECT COUNT(*) FROM users;` returns **8**
- [ ] `SELECT COUNT(*) FROM events;` returns **2**
- [ ] `.env` configured with `DATABASE_URL` and `OPENAI_API_KEY`

Once all boxes are checked → **Proceed to Phase 2** (backend ingestion engine + zero-shot matcher)

---

## Mock User Profiles (Phase 1 Seed Data)

| # | Name | Department | Location | Focus |
|---|------|-----------|----------|-------|
| 1 | Alex Chen | Computer Science | San Francisco | AI/ML, LLM startups |
| 2 | Maya Patel | Design | New York | UX/UI, Web3, Design Systems |
| 3 | Jordan Smith | Business | Remote | Entrepreneurship, VC |
| 4 | Casey Nguyen | Computer Science | Seattle | Game Dev, Procedural Generation |
| 5 | Sophia Garcia | Design | London | Sustainable Fashion, AR |
| 6 | Rahul Verma | Computer Science | Bangalore | Blockchain, ZK Proofs |
| 7 | Emma Johnson | Business | Boston | ESG, Social Impact, Nonprofits |
| 8 | Liam O'Brien | Computer Science | Dublin | DevOps, Cloud, Platform Engineering |

---

## Troubleshooting

**`psql` not found in terminal:**
Add PostgreSQL bin to PATH:
```powershell
$env:Path += ";C:\Program Files\PostgreSQL\16\bin"
```

**`CREATE EXTENSION vector` fails:**
pgvector DLLs are not in the right place. Re-check Step 2 above.

**Password authentication failed:**
Ensure you're using the password set during PostgreSQL installation for the `postgres` user.

**Port 5432 already in use:**
Another PostgreSQL instance may be running. Check with:
```powershell
netstat -ano | findstr :5432
```
