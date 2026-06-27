// Mocks two things a real backend + cookies would normally handle: Riot
// sign-in state, and "remembered visitor" search history. Dedup for
// reviews and votes used to live here too (client-side, trivially
// bypassed) — that's now enforced server-side by db.js's UNIQUE
// constraints, keyed off the reviewerKey/voterKey this module still hands
// out below for unverified visitors.

const STORAGE_KEYS = {
  riotSession: "lolmate.session.v1",
  recentSearches: "lolmate.recentSearches.v1",
  unverifiedReviewerId: "lolmate.unverifiedReviewerId.v1",
} as const;

import type { RiotId } from "../types";

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

// --- Riot sign-in (mock) -------------------------------------------------

export interface RiotSession {
  puuid: string;
  riotId: RiotId;
}

// Real flow: redirect to Riot Sign On at
//   https://auth.riotgames.com/authorize?client_id=...&redirect_uri=...&response_type=code&scope=openid
// then exchange the code server-side for tokens and call account-v1
// (/riot/account/v1/accounts/me) to resolve the signed-in player's PUUID.
// We don't have a backend yet, so this just flips a localStorage flag.
export function getSession(): RiotSession | null {
  return readJson<RiotSession | null>(STORAGE_KEYS.riotSession, null);
}

// localStorage writes don't trigger re-renders, and the native "storage"
// event only fires in *other* tabs, not the one that made the change. This
// event lets components like Navbar react immediately to sign-in/out
// happening elsewhere on the page (see hooks/useSession.ts).
export const SESSION_CHANGED_EVENT = "lolmate:session-changed";

function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function mockSignIn(session: RiotSession): void {
  writeJson(STORAGE_KEYS.riotSession, session);
  notifySessionChanged();
}

export function signOut(): void {
  localStorage.removeItem(STORAGE_KEYS.riotSession);
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
