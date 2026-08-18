# lolmate

RateMyProfessor, but for your League of Legends teammates.

**Live at [ratemylolmate.com](https://www.ratemylolmate.com/)**

Search any Riot ID to see their real rank, win rate, top champions, and match
history, then read (or leave) reviews from people who've actually played with
them — map awareness, mechanical skill, teamwork, communication, and
sportsmanship. Reviews also surface live, right inside your current game, so
you know who you're playing with before the match even ends.

## Features

- **Player lookup** — search any `Name#Tag` and get rank, win rate, average
  KDA, top champions, and recent ranked match history, all pulled live from
  the Riot API.
- **Live game view** — while a searched player is in an active game, see
  every participant on both teams (rank, top champions, and their review
  score) sourced from spectator-v5.
- **Peer reviews** — rate a teammate on 5 axes (map awareness, mechanical
  skill, teamwork, communication, sportsmanship) plus a written review.
  Reviews can be upvoted/downvoted and are limited to one per reviewer per
  target.
- **Verified vs. unverified reviewers** — signed-in players review with their
  real Riot identity; anonymous visitors get a persistent per-browser id
  instead, so review/vote de-duplication works either way.
- **Dashboard** — signed-in users land on a dashboard showing their most
  recent match and a one-click prompt to review each teammate from it.

> **Note:** "Sign in with Riot Games" currently resolves whatever Riot ID you
> type via the real account API rather than doing full OAuth — real Riot
> Sign On (RSO) requires a separate approval from Riot beyond a personal API
> key. Everything else (stats, match history, live games, reviews) is real.

## Tech stack

- **Frontend:** React 18 + TypeScript, Vite, React Router
- **Backend:** Express (Node, ESM), talks to the Riot API and Data Dragon
- **Database:** PostgreSQL (`pg`) — stores reviews and votes only; player
  stats always come live from Riot, never cached in the DB
- **Dev tooling:** `concurrently` to run client + server together

## Architecture

```
Browser  --/api-->  Vite dev server (proxy)  -->  Express server.js  -->  Riot API
                                                            |
                                                            +-->  Postgres (reviews/votes)
```

The Riot API key lives only in `server.js`'s environment — the browser never
sees it or calls `riotgames.com` directly. In dev, Vite proxies `/api/*`
requests to the Express server (see `vite.config.ts`).

## Deployment

Production runs on split hosting at [ratemylolmate.com](https://www.ratemylolmate.com/):

- **Frontend** — the Vite build (`src/`) is deployed to **Vercel**, serving
  the static site at the custom domain.
- **Backend** — `server.js` runs as a **Render** web service, with a Render
  Postgres instance backing `DATABASE_URL` for reviews/votes.

Since frontend and backend live on separate hosts in production (unlike the
local dev proxy in `vite.config.ts`), the frontend calls the Render API URL
directly instead of a relative `/api/*` path — set that as an environment
variable in the Vercel project. The Render service needs `RIOT_API_KEY`,
`RIOT_PLATFORM`, `RIOT_REGION`, and `DATABASE_URL` configured in its
environment, same as local `.env`.

## Getting started

### Prerequisites

- Node.js 18+
- A PostgreSQL database (local or hosted)
- A Riot Games API key ([developer.riotgames.com](https://developer.riotgames.com))

### Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env file and fill in your values:

   ```bash
   cp .env.example .env
   ```

   ```
   RIOT_API_KEY=your-riot-api-key-here
   RIOT_PLATFORM=na1        # summoner-v4 / league-v4 / spectator-v5
   RIOT_REGION=americas     # account-v1 / match-v5 — must match the platform (see table below)
   DATABASE_URL=postgres://user:password@localhost:5432/lolmate
   PORT=51791
   ```

   Platform → region mapping:

   | Platform                      | Region     |
   | ------------------------------ | ---------- |
   | na1, br1, la1, la2, oc1        | americas   |
   | euw1, eun1, ru, tr1             | europe     |
   | kr, jp1                        | asia       |

   Riot dev keys expire every 24 hours — grab a fresh one if requests start
   failing with 401/403.

3. Run the app (client + server together):

   ```bash
   npm run dev
   ```

   The server creates its own tables on first boot (see `db.js`), so no
   separate migration step is needed beyond having an empty database that
   `DATABASE_URL` can reach.

4. Open [http://localhost:5174](http://localhost:5174).

### Scripts

| Command           | Description                                    |
| ------------------ | ----------------------------------------------- |
| `npm run dev`      | Run client (Vite) and server (Express) together |
| `npm run client`   | Run the Vite dev server only                    |
| `npm run server`   | Run the Express API server only                 |
| `npm run build`    | Type-check and build the frontend for production |
| `npm run preview`  | Preview the production build locally            |
| `npm run typecheck`| Type-check without emitting                     |
| `npm start`        | Run the Express server (production entry point) |

## Project structure

```
server.js                  Express API — Riot API calls, review endpoints
db.js                      Postgres connection + schema/migrations
src/
  pages/                   LandingPage, DashboardPage, PlayerProfilePage, LiveMatchPage
  components/               Shared UI (search bar, review form/cards, rank badge, etc.)
  lib/                      API client, Data Dragon helpers, session/local-storage helpers
  types/                    Shared TypeScript types
```

## API rate limits

Riot's dev/personal key tiers are rate limited (~20 req/sec, 100 req/2min). A
single live-game lookup can fan out to ~20 Riot calls (one per participant
for account + rank lookups), so the server funnels all Riot calls through a
small concurrency limiter (`server.js`) instead of firing them all at once.
