// How recently a reviewer must have shared a game with a target before
// they're allowed to leave a review. Stops drive-by reviews from people who
// never actually played with the person, while still allowing a review
// after just one game together (a raw shared-game-count minimum penalized
// someone who played once this week vs. rewarding someone who played 3
// games with the target six months ago and remembers nothing relevant).
// Exact window is a product call — 1 week felt like a reasonable starting
// point, easy to tune later.
export const REVIEW_ELIGIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Maximum length of a review's written comment. 2000 characters is the
// general review-length ceiling used by most peer-review platforms
// (Google/Yelp-style) — long enough for real detail, short enough to stay
// skimmable. Easy to adjust.
export const REVIEW_BODY_MAX_LENGTH = 2000;
