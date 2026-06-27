import { useState } from "react";
import "./RatingStars.css";

const MAX = 5;

// Rating presentation is genuinely undecided product-wise (stars out of 5
// vs. a single composite number vs. tier strings like "Great teammate").
// Stars-out-of-5 per category was picked as the starting point because it's
// the most familiar pattern (Steam reviews, app stores) and composes well
// into a simple numeric average for the aggregate badge — easy to swap for
// a different presentation later without touching the data model
// (ReviewScores is just numbers 1-5 either way).
interface RatingStarsProps {
  value: number;
  onChange?: (value: number) => void;
  size?: "sm" | "md";
  label?: string;
}

export function RatingStars({ value, onChange, size = "md", label }: RatingStarsProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const interactive = !!onChange;
  const display = hovered ?? value;

  return (
    <div className={`rating-stars rating-stars-${size}`} role={interactive ? "radiogroup" : undefined} aria-label={label}>
      {Array.from({ length: MAX }, (_, i) => i + 1).map((star) => (
        <button
          key={star}
          type="button"
          className={`rating-star ${star <= display ? "rating-star-filled" : ""}`}
          disabled={!interactive}
          aria-pressed={interactive ? star === value : undefined}
          onClick={interactive ? () => onChange!(star) : undefined}
          onMouseEnter={interactive ? () => setHovered(star) : undefined}
          onMouseLeave={interactive ? () => setHovered(null) : undefined}
        >
          ★
        </button>
      ))}
      {!interactive && <span className="rating-stars-value faint">{value.toFixed(1)}</span>}
    </div>
  );
}
