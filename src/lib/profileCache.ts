import type { MatchSummary, SummonerProfile } from "../types";

// Riot's dev/personal key tiers are tightly rate limited (see server.js), and
// a profile view already fans out to several Riot calls. Without this, a
// plain browser refresh of a profile page would re-issue all of them —
// this cache lets a refresh replay the same view for free instead, and only
// hits Riot again once PROFILE_REFRESH_COOLDOWN_MS has actually passed. Also
// what fixed the "refresh -> 404" report: that 404 was Vercel's static
// hosting not knowing about client-side routes on a hard reload (see
// vercel.json's SPA rewrite) — this cache is the accompanying rate-limit
// safeguard once refreshing a profile URL actually works.
export const PROFILE_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

const STORAGE_PREFIX = "lolmate.profileCache.v1.";

interface CachedProfile {
  profile: SummonerProfile;
  matches: MatchSummary[];
  isLive: boolean;
  fetchedAt: number;
}

function cacheKey(gameName: string, tagLine: string): string {
  return `${STORAGE_PREFIX}${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

// sessionStorage (not localStorage) — the goal is surviving a same-tab
// refresh, not caching indefinitely across visits, so this clears itself
// out naturally instead of accumulating one entry per player ever looked up.
export function readProfileCache(gameName: string, tagLine: string): CachedProfile | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(gameName, tagLine));
    return raw ? (JSON.parse(raw) as CachedProfile) : null;
  } catch {
    return null;
  }
}

export function writeProfileCache(
  gameName: string,
  tagLine: string,
  data: { profile: SummonerProfile; matches: MatchSummary[]; isLive: boolean },
): void {
  try {
    const entry: CachedProfile = { ...data, fetchedAt: Date.now() };
    sessionStorage.setItem(cacheKey(gameName, tagLine), JSON.stringify(entry));
  } catch {
    // sessionStorage full or unavailable (e.g. private browsing) — just
    // means refreshes always refetch, not worth failing the page over.
  }
}
