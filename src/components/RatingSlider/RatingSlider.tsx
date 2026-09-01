import "./RatingSlider.css";

// Companion to RatingStars for "spectrum" categories (aggressive/passive,
// tilt-resistance, plays with team) that don't have a single "better"
// direction — same underlying 0-5 value and 0-as-unrated sentinel as
// RatingStars, just presented as a position between two named poles
// instead of a quality score.
interface RatingSliderProps {
  value: number;
  onChange?: (value: number) => void;
  lowLabel: string;
  highLabel: string;
  label?: string;
}

export function RatingSlider({ value, onChange, lowLabel, highLabel, label }: RatingSliderProps) {
  const interactive = !!onChange;

  return (
    <div className="rating-slider" aria-label={label}>
      <div className="rating-slider-track-row">
        <span className="faint rating-slider-pole">{lowLabel}</span>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={value}
          disabled={!interactive}
          onChange={interactive ? (e) => onChange!(Number(e.target.value)) : undefined}
          className={`rating-slider-input ${value === 0 ? "rating-slider-unrated" : ""}`}
          aria-label={label}
        />
        <span className="faint rating-slider-pole">{highLabel}</span>
      </div>
      <div className="rating-slider-status faint">
        {value === 0 ? (
          "Not rated"
        ) : (
          <>
            {value}/5
            {interactive && (
              <button type="button" className="rating-slider-clear" onClick={() => onChange!(0)}>
                Clear
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
