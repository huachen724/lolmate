import { REVIEW_CATEGORIES } from "../types";
import type { MatchSummary, Review, ReviewCategory, ReviewSummary } from "../types";

// Number of matches in `matches` where BOTH puuids appear. Checking both
// (rather than assuming the list is "puuidA's matches" so puuidA trivially
// appears in every entry) means this gives the right answer whichever
// side's already-fetched match list you happen to be holding — the
// target's (PlayerProfilePage) or the signed-in viewer's own
// (DashboardPage, reviewing a teammate from your own match history).
export function countSharedGames(matches: MatchSummary[], puuidA: string, puuidB: string): number {
  return matches.filter(
    (m) => m.participants.some((p) => p.puuid === puuidA) && m.participants.some((p) => p.puuid === puuidB),
  ).length;
}

// Epoch ms of the most recent match in `matches` where both puuids appear,
// or null if they've never shared one in this (recent-history-limited)
// list. Drives the time-based review eligibility window — see ReviewForm
// and lib/constants.ts's REVIEW_ELIGIBILITY_WINDOW_MS.
export function mostRecentSharedGameTimestamp(matches: MatchSummary[], puuidA: string, puuidB: string): number | null {
  const shared = matches.filter(
    (m) => m.participants.some((p) => p.puuid === puuidA) && m.participants.some((p) => p.puuid === puuidB),
  );
  if (shared.length === 0) return null;
  return Math.max(...shared.map((m) => m.timestamp));
}

// Averages only over reviews that actually rated a given category — a
// reviewer who left stars blank (see ReviewForm) shouldn't drag that
// category's average toward 0, they just didn't weigh in on it.
export function computeReviewSummary(reviews: Review[]): ReviewSummary {
  const sums: Record<ReviewCategory, number> = {} as Record<ReviewCategory, number>;
  const counts: Record<ReviewCategory, number> = {} as Record<ReviewCategory, number>;
  for (const c of REVIEW_CATEGORIES) {
    sums[c.key] = 0;
    counts[c.key] = 0;
  }

  for (const review of reviews) {
    for (const category of REVIEW_CATEGORIES) {
      const value = review.scores[category.key];
      if (value == null) continue;
      sums[category.key] += value;
      counts[category.key] += 1;
    }
  }

  const averageScores = REVIEW_CATEGORIES.reduce(
    (acc, c) => {
      acc[c.key] = counts[c.key] > 0 ? sums[c.key] / counts[c.key] : null;
      return acc;
    },
    {} as Record<ReviewCategory, number | null>,
  );

  const ratedCategories = REVIEW_CATEGORIES.filter((c) => averageScores[c.key] != null);
  const overallAverage =
    ratedCategories.length > 0
      ? ratedCategories.reduce((sum, c) => sum + (averageScores[c.key] as number), 0) / ratedCategories.length
      : null;

  return { averageScores, overallAverage, reviewCount: reviews.length };
}
