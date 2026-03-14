# 📡 RepRadar

> Your Reputation. Monitored. Analyzed. Protected.

RepRadar is a full-stack reputation management SaaS that pulls Google reviews via Outscraper, runs AI analysis via Claude, and gives business owners a single dark-themed dashboard to monitor sentiment, respond to reviews, spy on competitors, and surface actionable insights.

---

## Features

| Page | What it does |
|------|-------------|
| **Dashboard** | Fetches up to 200 Google reviews, shows reputation score, sentiment breakdown, keyword cloud, and AI-generated category tabs with a full filter bar |
| **Review Responder** | Paste or auto-load a negative review; Claude drafts a professional reply you can copy |
| **Competitor Spy** | Search competing businesses by name, pull their Google reviews, compare ratings side-by-side |
| **AI Insights** | Claude reads your reviews and returns 4–6 prioritised, actionable business insights |
| **Alert Settings** | Configure notification preferences for new reviews |

### Dashboard — Review Categories

- AI clusters all reviews into named categories (e.g. "Haircut Quality", "Staff Attitude")
- Each category card shows emoji, verdict badge (Strength / Needs Improvement / Critical Issue), sentiment bar, review count, and a one-liner quote
- Clicking a tab filters the review list to that category
- **Filter bar** between tabs and list: sentiment pills · date range · star rating · sort order · free-text search
- Active filter count badge + "Clear filters" shortcut
- "Load 10 more" pagination; count label updates with active filter info

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v3 |
| Charts | Recharts |
| State | Zustand |
| Auth & DB | Supabase (Postgres + Auth) |
| AI | Anthropic Claude (`claude-sonnet-4-6`) via `@anthropic-ai/sdk` |
| Reviews | Outscraper Google Reviews API |
| Hosting | Vercel (frontend + serverless API functions) |

---

## Project Structure

```
review-responder/
├── api/                        # Vercel serverless functions
│   ├── _lib/
│   │   └── shared.js           # Anthropic client singleton + review extraction helpers
│   ├── analyze-reviews.js      # POST /api/analyze-reviews — sentiment + reputation score
│   ├── generate-categories.js  # POST /api/generate-categories — AI category clustering
│   ├── generate-insights.js    # POST /api/generate-insights — actionable business insights
│   ├── generate-response.js    # POST /api/generate-response — draft reply to a review
│   ├── outscraper-reviews.js   # POST /api/outscraper-reviews — fetch Google reviews (2×100)
│   ├── outscraper-search.js    # POST /api/outscraper-search — search businesses by name
│   ├── google-places.js        # POST /api/google-places — place lookup helper
│   └── health.js               # GET /api/health — uptime check
│
├── src/
│   ├── context/
│   │   └── AuthContext.tsx     # Supabase auth provider + useAuth hook
│   ├── lib/
│   │   ├── supabase.ts         # Supabase client + DB types (Business, Review, Competitor)
│   │   └── localCache.ts       # localStorage cache helpers (TTL-based, per-business)
│   ├── pages/
│   │   ├── Dashboard.tsx       # Main dashboard — reviews, categories, stats
│   │   ├── ReviewResponder.tsx # AI reply drafter
│   │   ├── CompetitorSpy.tsx   # Competitor search + comparison
│   │   ├── AIInsights.tsx      # AI-generated business insights
│   │   ├── AlertSettings.tsx   # Alert configuration
│   │   ├── Onboarding.tsx      # First-run business setup
│   │   ├── AddBusiness.tsx     # Add additional businesses
│   │   └── auth/               # Login, Signup, ForgotPassword
│   ├── store/
│   │   └── appStore.ts         # Zustand global store (reviews, categories, active business)
│   ├── App.tsx                 # Root layout — sidebar, top bar, page routing
│   └── main.tsx                # React entry point
│
├── vercel.json                 # Build config + function timeouts
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com/)
- An [Outscraper API key](https://outscraper.com)

### 1. Clone and install

```bash
git clone https://github.com/ranatalhaasfar/RepRadar.git
cd RepRadar
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

```env
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase (public keys — safe to expose to browser)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Outscraper
OUTSCRAPER_API_KEY=your-outscraper-key

PORT=3001
```

### 3. Supabase schema

Run the following in the Supabase SQL editor:

```sql
-- Businesses
create table businesses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  type text not null,
  location text not null,
  place_id text,
  full_address text,
  google_rating numeric,
  total_reviews integer default 0,
  reputation_score integer,
  keywords text[],
  analyzed_at timestamptz,
  reviews_fetched_at timestamptz,
  created_at timestamptz default now()
);

-- Reviews
create table reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  user_id uuid references auth.users not null,
  review_text text not null default '',
  reviewer_name text not null default 'Anonymous',
  rating integer,
  sentiment text check (sentiment in ('positive','negative','neutral')),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- Categories (AI-generated)
create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  name text not null,
  emoji text,
  review_count integer default 0,
  sentiment_score numeric,
  verdict text,
  example_snippets text[],
  review_indices integer[] default '{}',
  created_at timestamptz default now()
);

-- Competitors
create table competitors (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  name text not null,
  location text,
  place_id text,
  full_address text,
  google_rating numeric,
  total_reviews integer,
  reviews_fetched_at timestamptz,
  created_at timestamptz default now()
);

-- Insights
create table insights (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses not null,
  data jsonb,
  created_at timestamptz default now()
);
```

Enable Row Level Security and add policies so users can only access their own rows.

### 4. Run locally

```bash
npm run dev
```

This starts Vite (frontend) and the local Express API server concurrently. The app opens at `http://localhost:5173`.

---

## Deployment (Vercel)

1. Push to GitHub
2. Import the repo in [Vercel](https://vercel.com)
3. Add all environment variables in the Vercel project settings
4. Deploy — Vercel auto-detects Vite and serves the `api/` folder as serverless functions

Function timeouts are configured in `vercel.json`:
- `outscraper-reviews` — 300s (fetches two batches of 100 reviews)
- `outscraper-search` — 60s
- Other AI functions — 30s

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/outscraper-reviews` | Fetch up to 200 Google reviews for a place |
| `POST` | `/api/outscraper-search` | Search businesses by name/location |
| `POST` | `/api/analyze-reviews` | Sentiment analysis + reputation score (Claude) |
| `POST` | `/api/generate-categories` | Cluster reviews into named categories (Claude) |
| `POST` | `/api/generate-insights` | Actionable business insights (Claude) |
| `POST` | `/api/generate-response` | Draft a reply to a negative review (Claude) |
| `POST` | `/api/google-places` | Google place detail lookup |

---

## Caching Strategy

RepRadar uses a three-layer cache to minimise API calls:

1. **Zustand in-memory** — instant re-renders within a session
2. **localStorage (TTL-based)** — survives page refreshes, scoped per business
3. **Supabase** — permanent storage, loaded on first visit or cache miss

---

## License

MIT
