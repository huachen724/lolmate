// Minimum number of games a reviewer must have shared with a target before
// they're allowed to leave a review. Stops drive-by reviews from people who
// never actually played with the person. Exact threshold is a product call —
// 3 felt like a reasonable starting point, easy to tune later.
export const MIN_SHARED_GAMES_TO_REVIEW = 3;
