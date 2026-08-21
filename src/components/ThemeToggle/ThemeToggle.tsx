import { useTheme } from "../../hooks/useTheme";
import "./ThemeToggle.css";

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <circle cx="10" cy="10" r="4" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="10" y1="1" x2="10" y2="3" />
        <line x1="10" y1="17" x2="10" y2="19" />
        <line x1="1" y1="10" x2="3" y2="10" />
        <line x1="17" y1="10" x2="19" y2="10" />
        <line x1="3.5" y1="3.5" x2="4.9" y2="4.9" />
        <line x1="15.1" y1="15.1" x2="16.5" y2="16.5" />
        <line x1="3.5" y1="16.5" x2="4.9" y2="15.1" />
        <line x1="15.1" y1="4.9" x2="16.5" y2="3.5" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M17 12.5A7.5 7.5 0 0 1 7.5 3 7.5 7.5 0 1 0 17 12.5z" />
    </svg>
  );
}

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const nextLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button type="button" className="btn btn-ghost theme-toggle" onClick={toggle} aria-label={nextLabel} title={nextLabel}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
