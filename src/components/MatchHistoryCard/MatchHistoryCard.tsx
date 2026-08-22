import { Link } from "react-router-dom";
import { ChampionAvatar } from "../ChampionAvatar/ChampionAvatar";
import type { MatchSummary } from "../../types";
import "./MatchHistoryCard.css";

function timeAgo(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// One row of match-v5 data (see server.js's toMatchSummary): champion,
// result, KDA, duration, and the rest of the lobby so a viewer can jump
// straight into reviewing someone they recognize from this game.
export function MatchHistoryCard({ match, focusPuuid }: { match: MatchSummary; focusPuuid: string }) {
  const self = match.participants.find((p) => p.puuid === focusPuuid);
  if (!self) return null;
  const teammates = match.participants.filter((p) => p.puuid !== focusPuuid && p.teamId === self.teamId);
  const enemies = match.participants.filter((p) => p.teamId !== self.teamId);
  const kda = self.deaths === 0 ? "Perfect" : ((self.kills + self.assists) / self.deaths).toFixed(1);

  return (
    <div className={`match-history-card ${self.win ? "match-win" : "match-loss"}`}>
      <div className="match-result-stripe" />
      <ChampionAvatar championName={self.championName} size={44} />

      <div className="match-history-main">
        <div className="match-history-row">
          <span className={self.win ? "win" : "loss"}>{self.win ? "Victory" : "Defeat"}</span>
          <span className="faint">{match.queueType}</span>
          <span className="faint">{timeAgo(match.timestamp)}</span>
        </div>
        <div className="match-history-row">
          <strong>{self.championName}</strong>
          <span className="muted">
            {self.kills} / {self.deaths} / {self.assists}
          </span>
          <span className="faint">{kda} KDA</span>
          <span className="faint">{Math.round(match.durationSeconds / 60)}m</span>
        </div>
      </div>

      <div className="match-history-others">
        <div className="match-history-team-row">
          {teammates.map((p) => (
            <Link
              key={p.puuid}
              to={`/profile/${encodeURIComponent(p.riotId.gameName)}/${encodeURIComponent(p.riotId.tagLine)}`}
              className="match-history-chip"
              title={`${p.riotId.gameName}#${p.riotId.tagLine} — ${p.championName}`}
            >
              {p.riotId.gameName}
            </Link>
          ))}
        </div>
        <div className="match-history-team-row">
          {enemies.map((p) => (
            <Link
              key={p.puuid}
              to={`/profile/${encodeURIComponent(p.riotId.gameName)}/${encodeURIComponent(p.riotId.tagLine)}`}
              className="match-history-chip match-history-chip-enemy"
              title={`${p.riotId.gameName}#${p.riotId.tagLine} — ${p.championName}`}
            >
              {p.riotId.gameName}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
