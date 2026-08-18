import { REVIEW_CATEGORIES } from "../../types";
import type { ReviewSummary } from "../../types";
import "./ReviewSummaryPanel.css";

// Aggregate of every Review.scores for a player. The big overall number is
// just a flat average across categories for now — easy to revisit (e.g.
// weight toxicity reports more heavily) once there's real review volume to
// look at.
export function ReviewSummaryPanel({ summary }: { summary: ReviewSummary }) {
  if (summary.reviewCount === 0) {
    return (
      <div className="review-summary card">
        <p className="muted">No reviews yet. Be the first teammate to leave one.</p>
      </div>
    );
  }

  return (
    <div className="review-summary card">
      <div className="review-summary-overall">
        <span className="review-summary-overall-number">
          {summary.overallAverage != null ? summary.overallAverage.toFixed(1) : "—"}
        </span>
        <div>
          <div className="review-summary-overall-label">Overall rating</div>
          <div className="faint">
            from {summary.reviewCount} review{summary.reviewCount === 1 ? "" : "s"}
            {summary.overallAverage == null && " (comments only so far)"}
          </div>
        </div>
      </div>

      <div className="review-summary-bars">
        {REVIEW_CATEGORIES.map((category) => {
          const value = summary.averageScores[category.key];
          return (
            <div className="review-summary-bar-row" key={category.key}>
              <span className="review-summary-bar-label">{category.label}</span>
              <div className="review-summary-bar-track">
                <div className="review-summary-bar-fill" style={{ width: `${value != null ? (value / 5) * 100 : 0}%` }} />
              </div>
              <span className="review-summary-bar-value faint">{value != null ? value.toFixed(1) : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
