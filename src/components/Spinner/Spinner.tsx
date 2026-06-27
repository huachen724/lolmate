import "./Spinner.css";

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

// Full-section loading placeholder for the three pages that fan out to
// several Riot API calls (profile, dashboard, live game) — those can take
// a couple seconds, so this is what stands in for "the app isn't frozen."
export function LoadingState({ message }: { message: string }) {
  return (
    <div className="loading-state">
      <Spinner size={28} />
      <p className="muted">{message}</p>
    </div>
  );
}
