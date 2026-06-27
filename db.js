import pg from "pg";
import dotenv from "dotenv";

// ESM static imports are hoisted and evaluated before any of server.js's
// own top-level code, including its dotenv.config() call — so this module
// needs to load its own env vars rather than rely on the importer having
// done it first by the time this runs.
dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Reviews are the one thing in this app that never come from Riot — this
// is the actual source of truth for them (replaces the old localStorage
// version in src/lib/reviewStore.ts).
//
// reviewer_key is whichever identity made the review: a verified
// reviewer's puuid, or an unverified reviewer's per-browser cookie id (see
// lib/session.ts's getOrCreateUnverifiedReviewerId). The UNIQUE constraint
// on (target_puuid, reviewer_key) is what actually enforces "one review
// per reviewer per target" now — server.js's POST /api/reviews just lets
// that constraint reject duplicates (23505) rather than re-implementing
// the check. It's still only as strong as that identity: an unverified
// reviewer who clears localStorage gets a new reviewer_key and can review
// again — there's no way around that without real accounts.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  target_puuid text NOT NULL,
  reviewer_key text NOT NULL,
  reviewer_kind text NOT NULL CHECK (reviewer_kind IN ('verified', 'unverified')),
  reviewer_game_name text,
  reviewer_tag_line text,
  reviewer_anonymous boolean NOT NULL DEFAULT false,
  reviewer_display_name text,
  map_awareness smallint NOT NULL CHECK (map_awareness BETWEEN 1 AND 5),
  mechanical_skill smallint NOT NULL CHECK (mechanical_skill BETWEEN 1 AND 5),
  teamwork smallint NOT NULL CHECK (teamwork BETWEEN 1 AND 5),
  communication smallint NOT NULL CHECK (communication BETWEEN 1 AND 5),
  sportsmanship smallint NOT NULL CHECK (sportsmanship BETWEEN 1 AND 5),
  body text NOT NULL,
  shared_games_with_target int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_puuid, reviewer_key)
);

CREATE INDEX IF NOT EXISTS reviews_target_puuid_idx ON reviews (target_puuid);

CREATE TABLE IF NOT EXISTS review_votes (
  review_id text NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  voter_key text NOT NULL,
  value smallint NOT NULL CHECK (value IN (1, -1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, voter_key)
);
`;

export async function runMigrations() {
  await pool.query(SCHEMA);
  console.log("[SERVER] Database schema ready");
}
