// Login is now real (Discord/Google OAuth, session cookie — see auth.js
// and hooks/useSession.ts, which fetches GET /api/auth/me). What's left
// here is the stuff that's genuinely fine to keep client-side: remembered
// search history, and the per-browser id unverified (not-logged-in)
// reviewers/voters are identified by. Dedup for reviews and votes is
// enforced server-side by db.js's UNIQUE constraints, keyed off the
// reviewerKey/voterKey this module hands out for unverified visitors — a
// verified voterKey/reviewerKey is derived from the session cookie
// server-side instead (see server.js's resolveViewerKey).

const STORAGE_KEYS = {
  recentSearches: "lolmate.recentSearches.v1",
  unverifiedReviewerId: "lolmate.unverifiedReviewerId.v1",
} as const;

import type { RiotId } from "../types";
import { logout as apiLogout } from "./api";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Session change notifications -----------------------------------------
// useSession() fetches /api/auth/me on mount, which naturally picks up a
// fresh login after the OAuth redirect flow brings the browser back to a
// full page load. Sign-out and completing icon verification, though,
// happen without a page reload — this event tells useSession to refetch
// immediately instead of waiting for the next mount.
export const SESSION_CHANGED_EVENT = "lolmate:session-changed";

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export async function signOut(): Promise<void> {
  await apiLogout().catch(() => {});
  notifySessionChanged();
}

// --- Recent searches (revisit hook) --------------------------------------

const MAX_RECENT_SEARCHES = 8;

export function getRecentSearches(): RiotId[] {
  return readJson<RiotId[]>(STORAGE_KEYS.recentSearches, []);
}

export function addRecentSearch(riotId: RiotId): void {
  const existing = getRecentSearches().filter(
    (r) => !(r.gameName === riotId.gameName && r.tagLine === riotId.tagLine),
  );
  const next = [riotId, ...existing].slice(0, MAX_RECENT_SEARCHES);
  writeJson(STORAGE_KEYS.recentSearches, next);
}

// --- Unverified reviewer identity ----------------------------------------

// A persistent-ish anonymous id, the "cookie" the spec asks about. Generated
// once per browser and reused so the backend can recognize the same
// unverified visitor across visits without requiring an account. This is
// also reused as the voterKey for upvote/downvote dedup when not signed in.
export function getOrCreateUnverifiedReviewerId(): string {
  const existing = localStorage.getItem(STORAGE_KEYS.unverifiedReviewerId);
  if (existing) return existing;
  const id = `anon-${crypto.randomUUID()}`;
  localStorage.setItem(STORAGE_KEYS.unverifiedReviewerId, id);
  return id;
}
