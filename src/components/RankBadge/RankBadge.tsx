import { rankEmblemUrl } from "../../lib/ddragon";
import "./RankBadge.css";
import type { RankInfo } from "../../types";

const TIER_VAR: Record<string, string> = {
  IRON: "--tier-iron",
  BRONZE: "--tier-bronze",
  SILVER: "--tier-silver",
  GOLD: "--tier-gold",
  PLATINUM: "--tier-platinum",
  EMERALD: "--tier-platinum",
  DIAMOND: "--tier-diamond",
  MASTER: "--tier-master",
  GRANDMASTER: "--tier-master",
  CHALLENGER: "--tier-master",
};

// Sourced from league-v4 entries/by-puuid (see server.js's
// getLeagueEntriesByPuuid/toRankInfo). Riot returns tier/division/LP/wins/
// losses per queue; we only show solo queue here. The crest image isn't
// from Riot's own CDN (Data Dragon only ships rank emblems as a
// downloadable zip, not a hot-linkable URL) — it's CommunityDragon's
// "latest" mirror, which is what most third-party LoL sites use instead.
export function RankBadge({ rank }: { rank?: RankInfo }) {
  if (!rank) {
    return <span className="rank-badge rank-badge-unranked">Unranked</span>;
  }

  const colorVar = TIER_VAR[rank.tier] ?? "--text-dim";
  const winRate = Math.round((rank.wins / Math.max(1, rank.wins + rank.losses)) * 100);

  return (
    <span className="rank-badge" style={{ color: `var(${colorVar})` }}>
      <img
        className="rank-badge-emblem"
        src={rankEmblemUrl(rank.tier)}
        alt=""
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      <span className="rank-badge-text">
        <span className="rank-badge-tier">
          {rank.tier} {rank.division}
        </span>
        <span className="rank-badge-lp faint">{rank.leaguePoints} LP</span>
        <span className="rank-badge-record faint">
          {rank.wins}W {rank.losses}L ({winRate}%)
        </span>
      </span>
    </span>
  );
}
