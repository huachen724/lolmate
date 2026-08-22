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
  the Riot API. A profile you've already viewed replays from a short-lived
  cache on refresh instead of re-hitting Riot every time (see
  [API rate limits](#api-rate-limits)).
- **Live game view** — while a searched player is in an active game, see
  every participant on both teams (rank, top champions, and their review
  score) sourced from spectator-v5. Participants with Riot's Streamer Mode
  enabled show as anonymized "Hidden" rows instead of a real identity,
  matching what spectator-v5 itself returns for them.
- **Peer reviews** — a written comment (up to 2000 characters) plus optional
  1-5 star ratings across 5 axes (map awareness, mechanical skill, teamwork,
  communication, sportsmanship) — rate whichever categories you want, or
  none at all. Reviews can be upvoted/downvoted and are limited to one per
  reviewer per target, and only allowed if you've played with that person
  within the past week.
- **Edit, delete, and view review history** — the reviewer who wrote a
  review (and only them) can edit or soft-delete it later; a deleted review
  disappears from the UI but the row is kept, and an edited review shows an
  "(edited)" label that expands to every earlier version (see
  [Review lifecycle & integrity](#review-lifecycle--integrity)).
- **Real account verification** — sign in with Discord or Google, then prove
  you actually own the Riot account you want to review under via a
  profile-icon ownership challenge (see
  [Accounts & Riot verification](#accounts--riot-verification)). Reviewers
  who skip this still get an unverified/anonymous path, identified by a
  per-browser id instead.
- **Anonymous-review integrity** — an unverified review tracks the Riot
  identity it claimed at submission time, so once that account signs in and
  verifies, LolMate can reconcile the two: reviews impersonating a real
  account get overridden or cleaned up automatically instead of sticking
  around under someone else's name forever (see
  [Review lifecycle & integrity](#review-lifecycle--integrity)).
- **Dashboard** — once your Riot account is verified, land on a dashboard
  showing your most recent match and a one-click prompt to review each
  teammate *or opponent* from it — eligibility is based on having shared a
  match, not which side someone was on.
- **Light/dark mode** — a manual toggle in the navbar overrides your OS
  preference; the choice is remembered per-browser and applied before first
  paint (no flash of the wrong theme).

## Tech stack

- **Frontend:** React 18 + TypeScript, Vite, React Router
- **Backend:** Express (Node, ESM), talks to the Riot API, Data Dragon,
  Discord/Google OAuth
- **Database:** PostgreSQL (`pg`) — stores reviews, votes, and accounts;
  player stats always come live from Riot, never cached in the DB
- **Dev tooling:** `concurrently` to run client + server together

## Architecture

```
Browser  --/api-->  Vite dev server (proxy)  -->  Express server.js  -->  Riot API / Data Dragon
                                                            |         \
                                                            |          --> Discord / Google OAuth
                                                            +-->  Postgres (reviews, votes, accounts)
```

The Riot API key lives only in `server.js`'s environment — the browser never
sees it or calls `riotgames.com` directly. In dev, Vite proxies `/api/*`
requests to the Express server (see `vite.config.ts`). Login uses a signed,
httpOnly session cookie (see `auth.js`) rather than a token the frontend
handles directly.

## Accounts & Riot verification

Signing in (`auth.js`, `server.js`'s `/api/auth/*` routes) is real Discord or
Google OAuth — whichever provider(s) have client credentials configured (see
env vars below); a provider's button only appears once it's actually set up.
That login by itself just proves who you are on Discord/Google, though — it
doesn't yet say anything about which Riot account is yours.

To post a review as **verified**, an account also has to complete a
**profile-icon ownership challenge** (`/api/verify/start`,
`/api/verify/check`, `components/RiotVerifyModal`):

1. Enter your Riot ID. The server resolves it and picks a random challenge
   icon from a pool of default icons every account has unlocked, with a
   10-minute expiration — summoner-v4 (where the check reads the current
   icon from) can lag a few minutes behind an in-client change, so the
   window needs enough slack for that to catch up.
2. In the League client, switch your summoner icon to the one shown.
3. Click **Verify** — the server re-checks your current icon via
   summoner-v4. A match permanently links that `puuid` to your logged-in
   account (`users.riot_puuid`, unique — one Riot account can't be claimed
   by two different logins). If it doesn't match yet, just wait a bit and
   click **Verify** again — the same challenge stays valid until it expires.

This replaces the old Riot Sign On (RSO) plan: RSO needs a separate approval
from Riot beyond a personal API key, and Riot has since retired the simpler
in-client "third-party verification code" flow this pattern used to use
instead. `reviewerKind: "verified"` is never trusted from the client — the
server always derives it from the session cookie plus `users.riot_puuid`
(see `POST /api/reviews`), so there's no way to spoof a verified review
without actually completing the challenge. Skipping sign-in/verification
entirely still works via the unverified path (a typed Riot ID for shared-game
eligibility, plus a self-chosen display name, deduped by a per-browser id).

## Review lifecycle & integrity

- **Soft delete** — `DELETE /api/reviews/:id` sets `reviews.deleted_at`
  instead of removing the row; every read query filters it out
  (`WHERE deleted_at IS NULL`). Ownership is checked server-side the same
  way as everywhere else: a verified reviewer's identity comes from the
  session cookie, an unverified one from a per-browser id they supply.
- **Edit with history** — `PUT /api/reviews/:id` updates a review in place
  (same ownership check) and snapshots the prior reviewer-facing fields into
  `review_edit_history` first, so `GET /api/reviews/:id/history` can show
  every earlier version. Editing sets `edited_at`, which is what drives the
  "(edited)" affordance in `ReviewCard`.
- **Claimed-identity tracking** — an unverified reviewer types a Riot ID to
  prove shared-game eligibility, but that identity is never actually
  verified. LolMate now persists it (`reviews.reviewer_claimed_puuid`) and
  enforces at most one unverified review per claimed identity per target
  (a partial unique index), closing the "clear localStorage, review the
  same person again under someone else's name" loophole.
- **Impersonation override** — if a verified reviewer submits or edits a
  review of a target who already has an unverified review claiming their
  exact `puuid`, that row is updated in place (content and authorship
  change; `id`, `created_at`, and votes are preserved) rather than creating
  a duplicate. The submitter sees a one-time notice explaining what
  happened.
- **Post-verification reconciliation** — right after completing Riot
  ownership verification, `ReconcileReviewsModal` fetches every unverified
  review claiming the now-verified `puuid`
  (`GET /api/verify/unverified-reviews`) and lets the user pick which ones
  are actually theirs. Checkboxes default **unchecked**; confirming
  (`POST /api/verify/reconcile-reviews`) converts the checked ones to
  verified in place and soft-deletes the rest. "Skip for now" closes
  without deciding anything — nothing is destructive by default.
- **Rate limiting** — unverified submissions are capped at one per two
  minutes per reviewer key (`UNVERIFIED_SUBMIT_COOLDOWN_MS` in `server.js`).
  Verified submissions are exempt — they're already gated behind real OAuth
  plus Riot ownership verification.

## Deployment

Production runs on split hosting at [ratemylolmate.com](https://www.ratemylolmate.com/):

- **Frontend** — the Vite build (`src/`) is deployed to **Vercel**, serving
  the static site at the custom domain.
- **Backend** — `server.js` runs as a **Render** web service, with a Render
  Postgres instance backing `DATABASE_URL` for reviews/votes.

Since frontend and backend live on separate hosts in production (unlike the
local dev proxy in `vite.config.ts`), the frontend calls the Render API URL
directly instead of a relative `/api/*` path — set that as an environment
variable in the Vercel project (`VITE_API_URL`). The Render service needs
every variable from `.env.example` configured in its environment, same as
local `.env` — notably `FRONTEND_URL` set to the production Vercel URL and
`NODE_ENV=production` (switches the session cookie to
`SameSite=None; Secure`, required for a cross-domain cookie to survive a
frontend-to-backend fetch at all). Discord/Google credentials and
`SESSION_SECRET` are only needed once you want sign-in live; the rest of the
site works without them.

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

   At minimum, set `RIOT_API_KEY` and `DATABASE_URL` — see `.env.example`
   for the full list and what each one does. `DISCORD_CLIENT_ID` /
   `GOOGLE_CLIENT_ID` (and their secrets) are optional: leave them blank and
   everything works except sign-in, whose buttons just won't appear (see
   [Accounts & Riot verification](#accounts--riot-verification) for how to
   register those).

   Platform → region mapping (`RIOT_PLATFORM` / `RIOT_REGION`):

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
server.js                  Express API — Riot API calls, auth routes, review endpoints
auth.js                    OAuth (Discord/Google) + signed session cookie helpers
db.js                      Postgres connection + schema/migrations
src/
  pages/                   LandingPage, DashboardPage, PlayerProfilePage, LiveMatchPage
  components/               Shared UI:
                              ReviewForm/ReviewCard    write, edit, delete, vote, view history
                              ReconcileReviewsModal     post-verification claimed-review triage
                              SignInModal/RiotVerifyModal  OAuth sign-in, icon ownership challenge
                              ThemeToggle               light/dark mode switch
                              SearchBar, MatchHistoryCard, RankBadge, ChampionAvatar, etc.
  lib/                      API client, Data Dragon helpers, session/theme/local-storage helpers
  hooks/                    useSession (GET /api/auth/me), useTheme (light/dark mode)
  types/                    Shared TypeScript types
```

## API rate limits

Riot's dev/personal key tiers are rate limited (~20 req/sec, 100 req/2min). A
single live-game lookup can fan out to ~20 Riot calls (one per participant
for account + rank lookups), so the server funnels all Riot calls through a
small concurrency limiter (`server.js`) instead of firing them all at once.
