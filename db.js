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
// Score columns are nullable — star ratings are optional per category (only
// the written `body` is required). A `CHECK (col BETWEEN 1 AND 5)`
// constraint already permits NULL on its own (a CHECK expression that
// evaluates to NULL, rather than false, isn't a violation in Postgres), so
// dropping NOT NULL below is the only schema change needed for that.
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
  map_awareness smallint CHECK (map_awareness BETWEEN 1 AND 5),
  mechanical_skill smallint CHECK (mechanical_skill BETWEEN 1 AND 5),
  teamwork smallint CHECK (teamwork BETWEEN 1 AND 5),
  communication smallint CHECK (communication BETWEEN 1 AND 5),
  sportsmanship smallint CHECK (sportsmanship BETWEEN 1 AND 5),
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

// `CREATE TABLE IF NOT EXISTS` above only shapes a *new* database — it's a
// no-op against the `reviews` table that's already deployed in production
// with NOT NULL score columns. These ALTERs bring an existing table in
// line with the schema above; DROP NOT NULL is itself a no-op if a column
// is already nullable, so this is safe to run on every boot.
const MIGRATIONS = `
ALTER TABLE reviews ALTER COLUMN map_awareness DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN mechanical_skill DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN teamwork DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN communication DROP NOT NULL;
ALTER TABLE reviews ALTER COLUMN sportsmanship DROP NOT NULL;
`;

export async function runMigrations() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
  console.log("[SERVER] Database schema ready");
}
