// Talks only to our own /api/* routes. In dev this is relative and Vite's
// proxy forwards it to server.js (see vite.config.ts). In production the
// client (Vercel) and server (Render) are on different domains, so
// VITE_API_URL — set in the Vercel project's env vars to the Render service
// URL — is prepended instead. The browser never calls riotgames.com
// directly or sees RIOT_API_KEY; server.js is the only thing holding it.
import type { LiveGame, MatchSummary, Review, ReviewScores, RiotId, SummonerProfile, VoteValue } from "../types";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function getJson<T>(url: string): Promise<T> {
  return fetch(API_BASE + url).then(parseJsonOrThrow<T>);
}

function postJson<T>(url: string, payload: unknown): Promise<T> {
  return fetch(API_BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(parseJsonOrThrow<T>);
}

export function fetchAccount(gameName: string, tagLine: string): Promise<{ puuid: string; riotId: RiotId }> {
  return getJson(`/api/account/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
}

export function fetchProfile(
  gameName: string,
  tagLine: string,
): Promise<{ profile: SummonerProfile; matches: MatchSummary[] }> {
  return getJson(`/api/profile/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
}

export function fetchLiveGame(
  gameName: string,
  tagLine: string,
): Promise<{ live: false } | { live: true; game: LiveGame }> {
  return getJson(`/api/live/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
}

// --- Reviews (never Riot — our own DB, see db.js) -------------------------

export function fetchReviewsForTarget(targetPuuid: string, voterKey: string): Promise<Review[]> {
  return getJson(`/api/reviews/${encodeURIComponent(targetPuuid)}?voterKey=${encodeURIComponent(voterKey)}`);
}

// One request for several players' reviews at once — used by the
// dashboard (your last match's teammates) and the live game page (the
// whole lobby) instead of one request per player.
export function fetchReviewsBatch(puuids: string[], voterKey: string): Promise<Record<string, Review[]>> {
  const params = new URLSearchParams({ puuids: puuids.join(","), voterKey });
  return getJson(`/api/reviews/batch?${params.toString()}`);
}

export interface NewReviewPayload {
  id: string;
  targetPuuid: string;
  reviewerKey: string;
  reviewerKind: "verified" | "unverified";
  reviewerGameName?: string;
  reviewerTagLine?: string;
  reviewerAnonymous?: boolean;
  reviewerDisplayName?: string;
  scores: ReviewScores;
  body: string;
  sharedGamesWithTarget: number;
}

export function submitReview(payload: NewReviewPayload): Promise<Review> {
  return postJson("/api/reviews", payload);
}

export function voteOnReview(
  reviewId: string,
  voterKey: string,
  value: VoteValue | null,
): Promise<{ upvotes: number; downvotes: number }> {
  return postJson(`/api/reviews/${encodeURIComponent(reviewId)}/vote`, { voterKey, value });
}
