import { useEffect, useState } from "react";
import { timeAgo } from "../../lib/time";
import "./RefreshStatus.css";

// A manual refresh button gated behind a cooldown, rather than anything
// auto-refreshing — Riot's dev/personal key tiers are tightly rate limited
// (see server.js), and a page like the dashboard or a player profile can
// fan out to several Riot calls per load. Shared by PlayerProfilePage and
// DashboardPage, both of which pair this with lib/profileCache.ts to avoid
// re-fetching within the cooldown window at all.
export function RefreshStatus({
  fetchedAt,
  cooldownMs,
  onRefresh,
}: {
  fetchedAt: number;
  cooldownMs: number;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const remaining = fetchedAt + cooldownMs - Date.now();
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fetchedAt, cooldownMs]);

  const remainingMs = Math.max(0, fetchedAt + cooldownMs - now);

  if (remainingMs === 0) {
    return (
      <div className="refresh-status-row">
        <button type="button" className="btn btn-ghost refresh-status-btn" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>
    );
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, "0");

  return (
    <div className="refresh-status-row">
      <span className="faint">
        Data as of {timeAgo(fetchedAt)} · next refresh available in {mm}:{ss}
      </span>
    </div>
  );
}
