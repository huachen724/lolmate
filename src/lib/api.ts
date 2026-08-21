// Talks only to our own /api/* routes. In dev this is relative and Vite's
// proxy forwards it to server.js (see vite.config.ts). In production the
// client (Vercel) and server (Render) are on different domains, so
// VITE_API_URL — set in the Vercel project's env vars to the Render service
// URL — is prepended instead. The browser never calls riotgames.com
// directly or sees RIOT_API_KEY; server.js is the only thing holding it.
import type {
  AuthUser,
  LiveGame,
  MatchSummary,
  Review,
  ReviewHistoryEntry,
  ReviewScores,
  RiotId,
  SummonerProfile,
  VoteValue,
} from "../types";

export const API_BASE = import.meta.env.VITE_API_URL ?? "";

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

// `credentials: "include"` on every call — needed so the session cookie
// (set on the Render domain, see auth.js) rides along on cross-origin
// fetches from the Vercel-hosted frontend. Harmless in dev, where /api/*
// goes through Vite's same-origin proxy anyway.
function getJson<T>(url: string): Promise<T> {
  return fetch(API_BASE + url, { credentials: "include" }).then(parseJsonOrThrow<T>);
}

function postJson<T>(url: string, payload: unknown): Promise<T> {
  return fetch(API_BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  }).then(parseJsonOrThrow<T>);
}

function putJson<T>(url: string, payload: unknown): Promise<T> {
  return fetch(API_BASE + url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
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
  reviewerKind: "verified" | "unverified";
  // Required for "unverified" (the per-browser cookie id); ignored for
  // "verified" — the server derives that identity from the session cookie
  // instead, see server.js's POST /api/reviews.
  reviewerKey?: string;
  reviewerAnonymous?: boolean;
  reviewerDisplayName?: string;
  // Unverified path only — the puuid resolved from the Riot ID typed for
  // eligibility, tracked server-side so a later-verified real account
  // holder can reclaim/override a review impersonating them.
  reviewerClaimedPuuid?: string;
  scores: ReviewScores;
  body: string;
  sharedGamesWithTarget: number;
}

// `overrodeExistingReview` is set when this submission replaced an
// existing unverified review of the same target that claimed to be this
// (now verified) reviewer's exact Riot account — see server.js's POST
// /api/reviews override path.
export function submitReview(payload: NewReviewPayload): Promise<Review & { overrodeExistingReview?: boolean }> {
  return postJson("/api/reviews", payload);
}

export interface ReviewUpdatePayload {
  reviewerKey?: string; // unverified path only, same as NewReviewPayload
  reviewerAnonymous?: boolean;
  scores: ReviewScores;
  body: string;
  sharedGamesWithTarget: number;
}

export function updateReview(reviewId: string, payload: ReviewUpdatePayload): Promise<Review> {
  return putJson(`/api/reviews/${encodeURIComponent(reviewId)}`, payload);
}

export function fetchReviewHistory(reviewId: string): Promise<ReviewHistoryEntry[]> {
  return getJson(`/api/reviews/${encodeURIComponent(reviewId)}/history`);
}

export function voteOnReview(
  reviewId: string,
  voterKey: string,
  value: VoteValue | null,
): Promise<{ upvotes: number; downvotes: number }> {
  return postJson(`/api/reviews/${encodeURIComponent(reviewId)}/vote`, { voterKey, value });
}

// reviewerKey only matters for the unverified path (a verified deleter is
// resolved from the session cookie server-side, same as everywhere else —
// see server.js's resolveViewerKey) — passed as a query param since DELETE
// requests conventionally don't carry a body.
export function deleteReview(reviewId: string, reviewerKey: string): Promise<{ ok: boolean }> {
  const params = new URLSearchParams({ reviewerKey });
  return fetch(`${API_BASE}/api/reviews/${encodeURIComponent(reviewId)}?${params.toString()}`, {
    method: "DELETE",
    credentials: "include",
  }).then(parseJsonOrThrow<{ ok: boolean }>);
}

// --- Accounts (Discord/Google login + Riot ownership verification) -------

export function fetchStatus(): Promise<{ hasApiKey: boolean; platform: string; region: string; discordAuth: boolean; googleAuth: boolean }> {
  return getJson("/api/status");
}

export function fetchMe(): Promise<{ user: AuthUser | null }> {
  return getJson("/api/auth/me");
}

export function logout(): Promise<{ ok: boolean }> {
  return postJson("/api/auth/logout", {});
}

export interface VerificationChallenge {
  puuid: string;
  riotId: RiotId;
  challengeIconId: number;
  expiresAt: number; // epoch ms
}

export function startIconVerification(gameName: string, tagLine: string): Promise<VerificationChallenge> {
  return postJson("/api/verify/start", { gameName, tagLine });
}

export function checkIconVerification(): Promise<{ verified: boolean; riotId?: RiotId }> {
  return postJson("/api/verify/check", {});
}
