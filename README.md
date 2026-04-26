# æthena — your self-learning AI co-scientist

> From a one-line hypothesis to a runnable, lab-grade experiment plan — and a model that gets sharper for your team with every correction.

An AI co-scientist that transforms a one-line hypothesis into a lab-grade experimental plan, including protocols, materials, budget, timeline, and collaborator recommendations. The system improves with every team correction through a per-team few-shot feedback loop, allowing it to adapt to each lab’s standards without fine-tuning, retraining infrastructure, or added model operations overhead.

---

## Table of contents

- [What it does](#what-it-does)
- [Why this is more than a GPT wrapper](#why-this-is-more-than-a-gpt-wrapper)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack](#tech-stack)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database schema](#database-schema)
- [API surface](#api-surface)
- [Self-learning loop — how it actually works](#self-learning-loop--how-it-actually-works)
- [Two-stage literature QC](#two-stage-literature-qc)
- [Provider-agnostic LLM layer](#provider-agnostic-llm-layer)
- [Auth model](#auth-model)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Demo walkthrough](#demo-walkthrough)
- [Roadmap](#roadmap)
- [Acknowledgements](#acknowledgements)

---

## What it does

A scientist types a one-line hypothesis. æthena returns:

1. **A literature verdict** — `not_found` / `similar_work_exists` / `exact_match_found` — with the three references that most contradict or support the hypothesis. Two-stage retrieval: pgvector cosine search against an indexed corpus first, with a Semantic Scholar live fallback when local hits fall below the novelty threshold.
2. **A full operational plan**:
   - Numbered protocol with rationale, duration, materials per step, equipment per step, assumed skills, and QC checks gating each step.
   - Materials list with verified supplier links (every link routes through Google "I'm Feeling Lucky" so it never 404s).
   - Line-item budget with category breakdown and a contingency line.
   - Week-by-week timeline with phase dependencies.
   - Staffing with named people and FTE percentages.
   - Validation plan with primary endpoint, statistics, decision criteria, and risks.
3. **Collaborator matching** — extracts the specific protocols and assays in your plan, fans out parallel Semantic Scholar `author/search` calls, ranks by methodological overlap, and drafts a formal academic outreach email per match (one-click `mailto:` to your mail client).
4. **Equipment sourcing** — equipment grouped by building and embedded Google Maps so a scientist can plan one visit per location.
5. **Multi-format export** — PDF (branded palette), DOCX, LaTeX, Markdown.
6. **A profile view** — every correction the model has learned, with per-row delete (soft-delete via `accepted=false` so few-shot retrieval skips it but history is preserved).

---

## Why this is more than a GPT wrapper

Three things, in order of importance:

**1. Per-team self-learning loop with no fine-tuning.** Every accepted correction is stored in Postgres tagged with the user's `team_id`, retrieved at generation time as a concrete BEFORE/AFTER few-shot example, and folded into the system prompt. The planner cache key includes a `_feedback_stamp` (count + latest correction timestamp) so any new correction busts the cache automatically. Switching cost grows linearly with adoption — five corrections in, your lab's plans are recognizably yours.

**2. Two-stage literature defense.** The novelty check isn't a citation dump. It's a calibrated verdict (`not_found` / `similar_work_exists` / `exact_match_found`) plus the three references that most contradict or support the hypothesis. Local pgvector hits ground the model in curated prior art; live Semantic Scholar fills gaps with embedding-based re-ranking that blends semantic similarity, S2 ranking, and keyword overlap. This is the artifact a PI defends in grant review.

**3. Provider-agnostic LLM layer.** Gemini 2.5 Flash/Pro by default (free tier sufficient for a full demo run); OpenAI GPT-4.1 / 4.1-mini as a hot-swappable failover via a single `LLM_PROVIDER` env var. Same abstraction handles structured generation, free-form text, and embeddings. Embedding dimensions match across providers via Matryoshka truncation so the corpus doesn't need re-indexing on a swap.

---

## Architecture at a glance

```
                 ┌─────────────────────────────────────────────────────┐
                 │                Vite + React + TS                   │
                 │      (Vercel)        — aethena.vercel.app         │
                 └──────────────────────────┬──────────────────────────┘
                                            │  HTTPS, JWT bearer
                                            ▼
                 ┌─────────────────────────────────────────────────────┐
                 │                  FastAPI (Python 3.13)             │
                 │      (Railway)       — aethena-production.*        │
                 │                                                     │
                 │   /auth/*    /qc/*    /plan    /feedback           │
                 │   /refine    /collaborators    /equipment-sourcing │
                 │   /draft-outreach-email    /me/preferences         │
                 │   /history    /plan/{id}/export                    │
                 └────┬─────────────┬──────────────┬───────────────────┘
                      │             │              │
                      ▼             ▼              ▼
            ┌──────────────┐ ┌─────────────┐ ┌──────────────────┐
            │   Postgres   │ │  Gemini API │ │ Semantic Scholar │
            │  + pgvector  │ │   (default) │ │ paper/author     │
            │              │ │             │ │  search          │
            │ • users      │ │ + OpenAI    │ │                  │
            │ • teams      │ │   fallback  │ │                  │
            │ • plans      │ └─────────────┘ └──────────────────┘
            │ • queries    │
            │ • feedback   │
            │ • corpus_    │
            │   chunks     │
            │   (vec 768)  │
            └──────────────┘
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript | Fast HMR, type safety, no Next.js overhead since we don't need SSR |
| UI | shadcn/ui + Tailwind CSS | Component primitives + token-driven design |
| Routing | React Router v6 | Client-side SPA routing with `vercel.json` rewrites |
| Backend | FastAPI (Python 3.13) | Pydantic-based request validation, async-friendly, OpenAPI for free |
| Vector DB | Postgres + pgvector | One database for relational + retrieval; ivfflat cosine index |
| LLM (default) | Gemini 2.5 Flash + Pro, `gemini-embedding-001` (768d) | Free-tier headroom for demo; structured-output support |
| LLM (fallback) | OpenAI GPT-4.1 / 4.1-mini, `text-embedding-3-small` (1536d) | Higher rate limits at Tier 1 for production |
| Literature | Semantic Scholar Graph API (`paper/search`, `author/search`) | Free, broad coverage, no auth required for demo |
| Auth | bcrypt + PyJWT | Standard email/password with JWT bearer tokens |
| PDF export | `xhtml2pdf` (pure Python) | No system Cairo / Pango dependency — deploys cleanly on Railway |
| DOCX / LaTeX | pandoc (when available) + `python-docx` fallback | |
| Frontend hosting | Vercel | Auto-deploy from `main`, edge CDN |
| Backend hosting | Railway with `railpack.json` | Idempotent migrations on startup |

---

## Local setup

### Prerequisites

- Node.js 20+
- Python 3.13
- Postgres 15+ with the `pgvector` extension enabled
- A Gemini API key (free tier works) or OpenAI API key
- (Optional) Semantic Scholar API key — public access works without one but with stricter rate limits

### Backend

```bash
cd hacknation-merged
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt
```

Create `.env` at the repo root:

```env
LLM_PROVIDER=gemini
GEMINI_KEY=...
OPENAI_KEY=...                                  # optional fallback
SEMANTIC_SCHOLAR_KEY=...                        # optional, raises rate limits
DATABASE_URL=postgresql+psycopg://scientist:scientist@localhost:5432/scientist
NOVELTY_THRESHOLD=0.72
DEMO_MODE=false
JWT_SECRET=$(openssl rand -hex 32)              # any 32+ char string
JWT_TTL_DAYS=30
```

Initialize the schema once (the backend also runs idempotent migrations on startup, so this is the canonical full schema):

```bash
psql $DATABASE_URL -f api/db/init.sql
```

Run the API:

```bash
python -m uvicorn api.main:app --reload --port 8765
```

Health check: `curl http://localhost:8765/health` → `{"status":"ok",...}`.

### Frontend

```bash
npm install
echo 'VITE_API_BASE=http://localhost:8765' > .env.local
npm run dev
```

Frontend at `http://localhost:8080`.

---

## Environment variables

### Backend (`api/settings.py`)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `gemini` or `openai` |
| `GEMINI_KEY` | _empty_ | Required when `LLM_PROVIDER=gemini` |
| `OPENAI_KEY` | _empty_ | Required when `LLM_PROVIDER=openai`; also used as fallback in QC paths |
| `GEMINI_MODEL_PRO` | `gemini-2.5-pro` | Heavy structured-output calls |
| `GEMINI_MODEL_FLASH` | `gemini-2.5-flash` | Default text + structured |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | Matryoshka-truncated to 768d |
| `OPENAI_MODEL_PRO` | `gpt-4.1` | |
| `OPENAI_MODEL_FLASH` | `gpt-4.1-mini` | |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 1536d |
| `DATABASE_URL` | local-dev value | **Must include `+psycopg`** scheme hint for SQLAlchemy 2.0 |
| `NOVELTY_THRESHOLD` | `0.72` | Below this similarity, QC falls back to live Semantic Scholar |
| `DEMO_MODE` | `false` | When `true`, QC and planner serve cached fixtures for speed |
| `SEMANTIC_SCHOLAR_KEY` | _empty_ | Optional; raises S2 rate limits |
| `JWT_SECRET` | _dev placeholder_ | **Required** in production; `openssl rand -hex 32` |
| `JWT_TTL_DAYS` | `30` | Bearer token lifetime |

### Frontend (`src/lib/api-base.ts`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE` | `http://localhost:8765` | Public URL of the FastAPI backend; baked into the bundle at build time |

---

## Database schema

The full schema lives in [`api/db/init.sql`](api/db/init.sql). Highlights:

- **`users`** — `email` unique, `password_hash` (bcrypt), `team_id` FK, profile fields (`role`, `research_type`, `institution`, `onboarded`).
- **`teams`** — opaque ID; one team per registered user. The unit of self-learning isolation.
- **`plans`** + **`queries`** — every generated plan is persisted along with the originating question, depth, and team_id.
- **`feedback`** — every accepted correction. The `domain` column (added by an `ALTER TABLE` migration on startup) lets the few-shot retrieval scope by experiment domain. Soft-delete via `accepted=false`.
- **`corpus_chunks`** — local pgvector index (768-dim embeddings, ivfflat cosine), populated by the optional ingestion job in `api/ingest`.
- **`query_uploads`** — file uploads attached to a query (parsed text + summary).

The backend runs `CREATE TABLE IF NOT EXISTS users (...)` and `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS domain text` on every startup so deploys are zero-touch.

---

## API surface

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Email + password; returns `{token, user}` |
| POST | `/auth/login` | Email + password; returns `{token, user}` |
| GET | `/auth/me` | Returns the authenticated user (JWT bearer required) |
| PUT | `/auth/profile` | Update role / research_type / institution; marks `onboarded=true` |
| POST | `/qc` | Default literature check (pgvector → S2 fallback) |
| POST | `/qc/with-source` | User-supplied source for grounding |
| POST | `/qc/broad` | Ungrounded LLM verdict for breadth |
| POST | `/plan` | Generate a full ExperimentPlan; persists query + plan rows |
| POST | `/feedback` | Submit a correction; LLM reviews + stores |
| POST | `/refine` | Re-write a single section of an existing plan |
| GET | `/plan/{id}` | Load a saved plan |
| GET | `/plan/{id}/export?format=pdf\|docx\|tex\|md` | Multi-format export |
| GET | `/history?limit=20` | Recent plans for the team |
| POST | `/collaborators` | Find researchers with hands-on experience in the plan's protocols |
| POST | `/equipment-sourcing` | Map equipment to local facilities |
| POST | `/draft-outreach-email` | Formal academic outreach draft for a collaborator |
| POST | `/parse-uploads` | PDF / text upload → summary |
| GET | `/me/preferences` | List the team's accepted feedback rows (what the model has learned) |
| DELETE | `/me/preferences/{id}` | Soft-delete a learned preference (`accepted=false`) |

Every endpoint requiring authentication accepts `Authorization: Bearer <jwt>`. Public endpoints work for anonymous callers when `team_id=00000000-…-0001` (the seeded demo team).

---

## Self-learning loop — how it actually works

The loop is implemented across three files:

1. **`api/main.py:228` — `/feedback` endpoint.** When a user submits a correction, it's stored in the `feedback` table tagged with `team_id`, `domain`, `section`, `before`, `after`, and `freeform_note`. An LLM `review_feedback` call labels each row `accepted: true | false` (defaulting to `accepted=true` on review failure — better to learn than lose feedback).

2. **`api/agents/planner.py:153` — `_team_examples()`.** On the next plan generation, this query retrieves up to 5 accepted feedback rows for the team scoped by `domain`, falling back to the last 3 across all domains if no domain match. The retrieved corrections become a `THIS TEAM HAS PREVIOUSLY CORRECTED SIMILAR PLANS` block prepended to the planner's system prompt.

3. **`api/agents/planner.py:276` — cache key.** The planner cache key includes a `_feedback_stamp(team_id)` value (count + latest correction timestamp). Any new correction shifts the stamp, busts the cache, and forces re-generation with the updated prompt — automatically.

The result: a scientist regenerating after a correction sees `team_examples_applied: N` in the response payload, where N is the number of prior corrections folded into this generation. The frontend renders that as a `★ N prior corrections applied` badge in the plan header.

**Per-team isolation.** All feedback queries are scoped by `team_id`, enforced at the SQL level via foreign-key constraints. Corrections never leak between labs.

**Soft-delete.** The Profile page's per-row "Remove" button issues `DELETE /me/preferences/{id}`, which sets `accepted=false`. Few-shot retrieval skips that row but the history is preserved — reversible without a destructive operation.

---

## Two-stage literature QC

Implemented in [`api/agents/qc.py`](api/agents/qc.py).

**Stage 1 — local pgvector.** `retriever.search_corpus(question, k=8)` performs cosine similarity against `corpus_chunks.embedding` (768-dim, ivfflat-indexed). If the top hit's similarity ≥ `NOVELTY_THRESHOLD` (default 0.72), we call the verdict LLM with those hits and return.

**Stage 2 — Semantic Scholar live fallback.** If the local index returns nothing useful, `_semantic_scholar_fallback` fires. It:

1. Generates 2–4 search queries from the hypothesis (handles common rephrasings via deterministic keyword extraction; LLM-augmented when available).
2. Calls `paper/search` per query in parallel.
3. Re-ranks the merged set via `_score_records_with_embeddings`, blending semantic similarity (65%), S2 ranking (25%), and keyword overlap (10%).
4. Hands the top 8 to the verdict LLM.

The verdict LLM returns one of three calibrated statuses with a `novelty_score` between 0 (exact match) and 1 (totally novel) and the indices of the three most relevant references.

If both stages fail (S2 timeout, embedding failure), a deterministic `_heuristic_verdict` fallback ensures the UI is never empty.

---

## Provider-agnostic LLM layer

[`api/llm.py`](api/llm.py) defines three functions used by every agent:

- `generate_text(prompt, system, model, provider) -> str`
- `generate_structured(prompt, response_schema, system, model, provider) -> dict`
- `embed(texts) -> list[list[float]]`

The active provider is selected at call time via the optional `provider=` argument or by `settings.LLM_PROVIDER`. Some QC paths hard-prefer OpenAI when `OPENAI_KEY` is set (tighter rate limits, more stable structured output under load); the planner uses Gemini by default (cheaper at our scale).

**Embedding dimension parity.** The corpus column is `vector(768)`. Gemini's `gemini-embedding-001` is Matryoshka-truncated at 768 via `output_dimensionality`. OpenAI's `text-embedding-3-small` defaults to 1536 — to swap providers without re-indexing the corpus, request 768 via the `dimensions` parameter (one-line change in `_openai_embed`).

---

## Auth model

- **Registration** (`POST /auth/register`): bcrypt-hashes the password (12 rounds), creates a `users` row plus a fresh `teams` row, returns a JWT signed with HS256.
- **Login** (`POST /auth/login`): bcrypt-verifies, issues a fresh JWT.
- **JWT payload**: `{sub: user_id, team_id, email, iat, exp}`. Default TTL 30 days.
- **Bearer token**: every authenticated frontend call includes `Authorization: Bearer <token>` (set in `src/lib/api.ts:authHeaders()`).
- **Per-team isolation**: every persisted row (queries, plans, feedback) carries `team_id` with a foreign-key reference to `teams`. Few-shot retrieval scopes by team_id, enforced at the SQL level.
- **Profile**: `PUT /auth/profile` updates role / research_type / institution and marks `onboarded=true`. The institution field biases collaborator suggestions toward the user's geographic / institutional cluster.

---

## Deployment

### Frontend (Vercel)

- Connect the GitHub repo to Vercel.
- Framework Preset: **Vite**
- Output Directory: `dist`
- Root Directory: repo root
- Environment variables:
  - `VITE_API_BASE` = your Railway public URL (e.g. `https://aethena-production.up.railway.app`)
- A `vercel.json` at the repo root rewrites all unknown paths to `/index.html` so React Router's client-side routes (`/app`, `/profile`, `/onboarding`) survive page refreshes.

### Backend (Railway)

- Connect the GitHub repo. Railway auto-detects via [`railpack.json`](railpack.json), which:
  - Pins Python 3.13.
  - Copies the full repo into the install layer (so `api/requirements.txt` is visible).
  - Creates a venv at `/app/.venv` and installs dependencies into it.
  - Runs `/app/.venv/bin/python -m uvicorn api.main:app --host 0.0.0.0 --port $PORT`.
- Provision a Postgres add-on; copy its connection string.
- Set environment variables on the FastAPI service:
  - `DATABASE_URL=postgresql+psycopg://...` (must include `+psycopg`)
  - `GEMINI_KEY` / `OPENAI_KEY` / `SEMANTIC_SCHOLAR_KEY`
  - `JWT_SECRET`, `LLM_PROVIDER`, `NOVELTY_THRESHOLD`, etc.
- Run [`api/db/init.sql`](api/db/init.sql) in the Postgres Data tab once. Subsequent deploys handle additive migrations on startup.

The frontend's CORS allowlist (`api/main.py:38`) already includes `https://aethena.vercel.app`. Add additional origins there before deploying preview environments.

---

## Project structure

```
hacknation-merged/
├── api/                          # FastAPI backend
│   ├── main.py                   # All endpoints
│   ├── auth.py                   # bcrypt + JWT, users table migration
│   ├── settings.py               # pydantic-settings, env-driven
│   ├── llm.py                    # provider-agnostic LLM + embedding interface
│   ├── cache.py                  # content-hashed response cache
│   ├── agents/
│   │   ├── qc.py                 # two-stage literature check
│   │   ├── planner.py            # plan generation + self-learning few-shot
│   │   ├── refiner.py            # /feedback + /refine + LLM-based feedback review
│   │   ├── collaborators.py      # skill extraction → S2 author/search → ranking
│   │   ├── outreach.py           # academic email draft
│   │   ├── equipment_sourcing.py # local facility lookup
│   │   ├── parse_uploads.py      # PDF/text → summary
│   │   ├── exporter.py           # plan → MD → PDF/DOCX/LaTeX
│   │   └── supplier_links.py     # canonical supplier URL table
│   ├── rag/
│   │   ├── retriever.py          # pgvector cosine search
│   │   ├── s2_client.py          # Semantic Scholar HTTP wrapper
│   │   └── pdf_extract.py        # PyMuPDF text extraction
│   ├── schemas/                  # Pydantic request/response models
│   ├── db/
│   │   └── init.sql              # canonical schema (run once on a fresh DB)
│   ├── fixtures/                 # demo-mode cached responses
│   └── requirements.txt
├── src/                          # Vite + React frontend
│   ├── pages/
│   │   ├── Landing.tsx
│   │   ├── Login.tsx             # register + sign-in
│   │   ├── Onboarding.tsx        # role / research_type / institution
│   │   ├── Profile.tsx           # learned preferences with delete
│   │   ├── Index.tsx             # main hypothesis → plan workflow
│   │   └── Reviews.tsx           # past plans
│   ├── components/
│   │   ├── HypothesisInput.tsx
│   │   ├── LiteratureQc.tsx
│   │   ├── PlanView.tsx          # tabbed plan view + regenerate
│   │   ├── CollaboratorsPanel.tsx
│   │   ├── EquipmentPanel.tsx
│   │   ├── BudgetDonut.tsx
│   │   ├── ConstructionTimeline.tsx
│   │   ├── DepthModal.tsx
│   │   ├── InlineFeedback.tsx
│   │   ├── MaterialsSchedule.tsx
│   │   ├── SiteHeader.tsx
│   │   └── ui/                   # shadcn/ui primitives
│   ├── lib/
│   │   ├── api.ts                # frontend API client + adapter layer
│   │   ├── api-base.ts           # VITE_API_BASE resolver
│   │   ├── auth.ts               # JWT bearer + localStorage
│   │   ├── scientist-types.ts    # frontend-side types
│   │   └── scientist-utils.ts
│   └── App.tsx                   # router
├── public/
├── railpack.json                 # Railway build config
├── vercel.json                   # SPA fallback
├── package.json
├── vite.config.ts
└── README.md
```

---

## Demo walkthrough

The fastest path to seeing self-learning in action:

1. **Register** at `/register` (email + 8+ char password). Land on `/onboarding`, fill role/research-type/institution.
2. **Type a hypothesis** at `/app`. The "Try an example" cards fill the textarea with a known-good prompt.
3. **Run the literature check.** A verdict + three references render. Click **Continue → Regular** to generate a full plan.
4. **Review the plan** across tabs: Overview → Protocol → Timeline → Materials → Equipment → Budget → Validation → Collaborators → References.
5. **Submit a correction.** Use the per-step edit pencil in Protocol, or any tab's "Rate, comment or annotate this section" panel. **Use the "What it should be (optional)" field** for the correction — that's the BEFORE/AFTER signal the few-shot loop trains on. (Freeform notes alone work, but concrete corrections work better.)
6. **Click Regenerate** in the plan header. The new response shows `team_examples_applied: 1` (or higher) and a `★ N prior corrections applied` badge appears at the top.
7. **Visit `/profile`** — you'll see the correction listed under "What the model has learned." Click Remove to soft-delete it; the next generation will skip it.

---

## Roadmap

- **Real ingestion pipeline.** Bulk-ingest a curated corpus into `corpus_chunks` so the local pgvector index isn't empty for new deploys (currently the S2 fallback handles all real queries).
- **Streaming plan generation.** Server-sent events so users see protocol → materials → budget appear progressively rather than waiting for the full JSON.
- **Multi-user teams.** Today each user has their own `team_id`. A `team_members` table would let labs share corrections across a PI + their grad students explicitly.
- **Plan diffing.** When a regenerated plan applies prior corrections, surface a side-by-side diff highlighting which sections changed and which corrections drove the change.
- **Cost tracking.** Persist token usage per plan and surface a per-team monthly spend view.
- **Real OAuth providers.** Email + password is the MVP; Google / Microsoft / institutional SSO is the production path.
- **Vector index re-embedding hook.** Allow swapping LLM provider mid-flight by re-embedding the corpus async; today switching providers requires a one-time backfill.

---

## Acknowledgements

- Built for the **Hacknation MIT × Fulcrum Science** challenge.
- Five scientist interviews informed the planner prompt, the schema, and the design rules baked into the system prompt — thank you to the working scientists who shared what generic AI tools always get wrong.
- The Lovable team for the initial UI scaffold; the design tokens and core component shape come from there.
- Semantic Scholar for free, generous literature access.

---

## License

MIT.
