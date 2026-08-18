import { useState } from "react";
import { REVIEW_CATEGORIES } from "../../types";
import type { Review, VoteValue } from "../../types";
import { useSession } from "../../hooks/useSession";
import { getOrCreateUnverifiedReviewerId } from "../../lib/session";
import { voteOnReview } from "../../lib/api";
import { timeAgo } from "../../lib/time";
import { VerifiedBadge } from "../VerifiedBadge/VerifiedBadge";
import "./ReviewCard.css";

function reviewerLabel(review: Review): { name: string; verified: boolean } {
  if (review.reviewer.kind === "verified") {
    return {
      name: review.reviewer.anonymous ? "Anonymous (verified)" : review.reviewer.riotId.gameName,
      verified: true,
    };
  }
  return { name: review.reviewer.displayName, verified: false };
}

export function ReviewCard({ review }: { review: Review }) {
  const session = useSession();
  const [upvotes, setUpvotes] = useState(review.upvotes);
  const [downvotes, setDownvotes] = useState(review.downvotes);
  const [myVote, setMyVote] = useState<VoteValue | null>(review.myVote ?? null);

  const { name, verified } = reviewerLabel(review);
  const ratedCategories = REVIEW_CATEGORIES.filter((c) => review.scores[c.key] != null);

  // Thumbs up/down dedup: one vote per (reviewId, voterKey), enforced by a
  // unique constraint in the database (see db.js) — voterKey is the
  // signed-in puuid, or the same per-browser cookie id unverified reviewers
  // use. Optimistic update with rollback if the request fails.
  function vote(next: VoteValue) {
    const resolved = myVote === next ? null : next;
    const voterKey = session?.riotPuuid ? session.riotPuuid : getOrCreateUnverifiedReviewerId();

    const prevUp = upvotes;
    const prevDown = downvotes;
    const prevVote = myVote;

    setUpvotes((v) => v + (resolved === 1 ? 1 : 0) - (myVote === 1 ? 1 : 0));
    setDownvotes((v) => v + (resolved === -1 ? 1 : 0) - (myVote === -1 ? 1 : 0));
    setMyVote(resolved);

    voteOnReview(review.id, voterKey, resolved).catch(() => {
      setUpvotes(prevUp);
      setDownvotes(prevDown);
      setMyVote(prevVote);
    });
  }

  return (
    <article className="review-card card">
      <header className="review-card-header">
        <div className="review-card-reviewer">
          <span className="review-card-name">{name}</span>
          {verified && <VerifiedBadge />}
          <span className="tag">{review.sharedGamesWithTarget} games together</span>
        </div>
        <span className="faint">{timeAgo(review.createdAt)}</span>
      </header>

      {ratedCategories.length > 0 ? (
        <div className="review-card-scores">
          {ratedCategories.map((category) => (
            <div className="review-card-score" key={category.key} title={category.hint}>
              <span className="faint">{category.label}</span>
              <strong>{review.scores[category.key]}/5</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint review-card-no-ratings">No category ratings — comment only.</p>
      )}

      <p className="review-card-body">{review.body}</p>

      <footer className="review-card-footer">
        <button
          type="button"
          className={`review-vote-btn ${myVote === 1 ? "review-vote-active-up" : ""}`}
          onClick={() => vote(1)}
          aria-pressed={myVote === 1}
        >
          ▲ {upvotes}
        </button>
        <button
          type="button"
          className={`review-vote-btn ${myVote === -1 ? "review-vote-active-down" : ""}`}
          onClick={() => vote(-1)}
          aria-pressed={myVote === -1}
        >
          ▼ {downvotes}
        </button>
      </footer>
    </article>
  );
}
