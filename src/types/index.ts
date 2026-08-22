// Shared domain types for the UI. Shapes mirror what server.js normalizes
// Riot's responses into (see GET /api/profile and /api/live there).

export type PlatformRegion =
  | "na1"
  | "euw1"
  | "eun1"
  | "kr"
  | "jp1"
  | "oc1"
  | "br1"
  | "la1"
  | "la2"
  | "ru"
  | "tr1";

// Riot ID, the gameName#tagLine pair that replaced summoner names as the
// player-facing identifier (account-v1).
export interface RiotId {
  gameName: string;
  tagLine: string;
}

export interface RankInfo {
  queueType: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
  tier: string; // e.g. "GOLD", "DIAMOND"
  division: string; // "I" - "IV"
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface ChampionStat {
  championName: string;
  gamesPlayed: number;
  wins: number;
  avgKda: number;
}

export interface SummonerProfile {
  puuid: string;
  riotId: RiotId;
  region: PlatformRegion;
  profileIconId: number;
  summonerLevel: number;
  soloRank?: RankInfo;
  winRate: number; // 0-100, recent N games
  avgKda: number;
  topChampions: ChampionStat[];
  isLive: boolean;
}

export interface MatchParticipant {
  puuid: string;
  riotId: RiotId;
  championName: string;
  teamId: 100 | 200;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
}

export interface MatchSummary {
  matchId: string;
  // Riot's numeric queue id (match-v5's info.queueId) — queueType below is
  // already the resolved display label (see server.js's labelForQueue),
  // this is only here so the client can group shared games by mode itself
  // (see lib/reviewStats.ts's countSharedGamesByMode) without re-deriving
  // the label from scratch.
  queueId: number;
  queueType: string;
  durationSeconds: number;
  timestamp: number; // epoch ms
  participants: MatchParticipant[];
}

export interface LiveGameParticipant {
  puuid: string;
  riotId: RiotId;
  championName: string;
  teamId: 100 | 200;
  soloRank?: RankInfo;
  winRate: number;
  topChampions: ChampionStat[];
  reviewSummary?: ReviewSummary;
  // True when Riot's Streamer Mode anonymity (Patch 25.20+) scrubbed this
  // participant's identity from spectator-v5 — riotId above is a
  // placeholder, not a real account.
  hidden?: boolean;
}

export interface LiveGame {
  gameId: string;
  queueType: string;
  gameStartTimestamp: number;
  participants: LiveGameParticipant[];
}

// --- Reviews -----------------------------------------------------------

// One axis a reviewer rates. Kept as a fixed list (rather than free-form
// tags) so aggregate scoring stays comparable across reviews.
export type ReviewCategory =
  | "mapAwareness"
  | "mechanicalSkill"
  | "teamwork"
  | "communication"
  | "sportsmanship";

export const REVIEW_CATEGORIES: { key: ReviewCategory; label: string; hint: string }[] = [
  { key: "mapAwareness", label: "Map Awareness", hint: "Wards, rotations, tracking missing enemies" },
  { key: "mechanicalSkill", label: "Mechanics", hint: "Combos, kiting, dodging skillshots" },
  { key: "teamwork", label: "Teamwork", hint: "Grouping, objective focus, peeling for allies" },
  { key: "communication", label: "Communication", hint: "Calling targets, useful pings/chat" },
  { key: "sportsmanship", label: "Sportsmanship", hint: "Tilt-resistance, no int-feeding or flame" },
];

// Each category is 1-5, or null if the reviewer chose not to rate it —
// only the written comment is required, star ratings are optional per
// category (see ReviewForm).
export type ReviewScores = Record<ReviewCategory, number | null>

// Either a verified Riot-authenticated reviewer, or an unverified one who
// just typed a display name. Dedup (one review per reviewer per target) is
// enforced server-side now (see db.js's UNIQUE constraint), keyed off
// whichever identity made the review: a verified reviewer's puuid, or an
// unverified reviewer's per-browser cookie id. Still only as strong as that
// identity — an unverified reviewer who clears localStorage gets a new
// cookie id and can review again; there's no way around that without real
// accounts.
export type ReviewerIdentity =
  | { kind: "verified"; puuid: string; riotId: RiotId; anonymous: boolean }
  | { kind: "unverified"; unverifiedId: string; displayName: string };

export interface Review {
  id: string;
  targetPuuid: string;
  reviewer: ReviewerIdentity;
  scores: ReviewScores;
  body: string;
  createdAt: number; // epoch ms
  // Set once the review has been edited (or overridden — see
  // ReviewHistoryEntry) at least once; null otherwise.
  editedAt?: number | null;
  upvotes: number;
  downvotes: number;
  // Games the reviewer has shared with the target at time of writing —
  // reviews are only allowed while they've played together within
  // REVIEW_ELIGIBILITY_WINDOW_MS (see lib/constants.ts).
  sharedGamesWithTarget: number;
  // Per-mode breakdown of sharedGamesWithTarget, e.g. { "Ranked Solo/Duo":
  // 2, "ARAM": 1} — a submission-time snapshot like the count itself, so
  // reviews written before this field existed just have an empty object.
  sharedGamesByMode: Record<string, number>;
  // Computed server-side relative to whichever reviewerKey/voterKey the
  // request was made with — never derived from other people's keys, which
  // are never sent to the client at all (see server.js's rowToReview).
  myVote?: VoteValue | null;
  isMine?: boolean;
}

// A prior version of a review's reviewer-facing fields, captured right
// before an edit or an impersonation-override replaced it (see PUT
// /api/reviews/:id and POST /api/reviews's override path in server.js).
// `reviewer` here is display-only — no puuid/unverifiedId, since past
// authorship is only shown as a name, not something to act on.
export interface ReviewHistoryEntry {
  id: string;
  reviewer: { kind: "verified"; riotId: RiotId } | { kind: "unverified"; displayName: string };
  scores: ReviewScores;
  body: string;
  sharedGamesWithTarget: number;
  sharedGamesByMode: Record<string, number>;
  archivedAt: number; // epoch ms
}

// An unverified review claiming to be the just-verified user's exact
// puuid, surfaced by GET /api/verify/unverified-reviews for the post-
// verification reconciliation flow (see components/ReconcileReviewsModal).
// targetRiotId can be null if that account's Riot ID couldn't be resolved
// (e.g. a transient Riot API failure) — still shown, just without a name.
export interface UnverifiedReviewCandidate {
  id: string;
  targetRiotId: RiotId | null;
  displayName: string;
  body: string;
  scores: ReviewScores;
  sharedGamesWithTarget: number;
  createdAt: number; // epoch ms
}

export interface ReviewSummary {
  // Per-category average, or null if nobody has rated that category yet.
  averageScores: Record<ReviewCategory, number | null>;
  overallAverage: number | null;
  reviewCount: number;
}

export type VoteValue = 1 | -1;

// --- Accounts (Discord/Google login + Riot ownership verification) -------

// Logged in via Discord or Google (see server.js's /api/auth/* routes and
// auth.js). riotPuuid/riotGameName/riotTagLine stay null until the account
// owner completes the profile-icon ownership challenge (see
// components/RiotVerifyModal) — only once that's done can this identity
// post reviews as "verified" (enforced server-side, never trusted from the
// client — see POST /api/reviews).
export interface AuthUser {
  id: string;
  provider: "discord" | "google";
  displayName: string;
  avatarUrl: string | null;
  riotPuuid: string | null;
  riotGameName: string | null;
  riotTagLine: string | null;
  riotVerifiedAt: number | null; // epoch ms
}
