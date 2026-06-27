import { REVIEW_CATEGORIES } from "../types";
import type { MatchSummary, Review, ReviewScores, ReviewSummary } from "../types";

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

export function computeReviewSummary(reviews: Review[]): ReviewSummary {
  if (reviews.length === 0) {
    const zeroed = REVIEW_CATEGORIES.reduce((acc, c) => {
      acc[c.key] = 0;
      return acc;
    }, {} as ReviewScores);
    return { averageScores: zeroed, overallAverage: 0, reviewCount: 0 };
  }

  const totals = REVIEW_CATEGORIES.reduce((acc, c) => {
    acc[c.key] = 0;
    return acc;
  }, {} as ReviewScores);

  for (const review of reviews) {
    for (const category of REVIEW_CATEGORIES) {
      totals[category.key] += review.scores[category.key];
    }
  }

  const averageScores = REVIEW_CATEGORIES.reduce((acc, c) => {
    acc[c.key] = totals[c.key] / reviews.length;
    return acc;
  }, {} as ReviewScores);

  const overallAverage =
    Object.values(averageScores).reduce((sum, v) => sum + v, 0) / REVIEW_CATEGORIES.length;

  return { averageScores, overallAverage, reviewCount: reviews.length };
}
