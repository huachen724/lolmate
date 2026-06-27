import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchLiveGame, fetchReviewsBatch } from "../../lib/api";
import { useSession } from "../../hooks/useSession";
import { getOrCreateUnverifiedReviewerId } from "../../lib/session";
import { computeReviewSummary } from "../../lib/reviewStats";
import { ChampionAvatar } from "../../components/ChampionAvatar/ChampionAvatar";
import { RankBadge } from "../../components/RankBadge/RankBadge";
import { LoadingState } from "../../components/Spinner/Spinner";
import type { LiveGame, LiveGameParticipant, Review } from "../../types";
import "./LiveMatchPage.css";

// porofessor/op.gg-style live game view, sourced from GET
// /api/live/:gameName/:tagLine (server.js -> spectator-v5, enriched with
// league-v4 per participant). The review mini-badge per row is the
// differentiator from a normal stats site — it's our own data (see
// server.js's /api/reviews/batch route), joined in client-side here.
export function LiveMatchPage() {
  const { gameName = "", tagLine = "" } = useParams();
  const session = useSession();
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "not-live" } | { status: "live"; game: LiveGame }
  >({ status: "loading" });
  const [reviewsByPuuid, setReviewsByPuuid] = useState<Record<string, Review[]>>({});

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchLiveGame(gameName, tagLine)
      .then((result) => {
        if (cancelled) return;
        setState(result.live ? { status: "live", game: result.game } : { status: "not-live" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't load that game." });
      });

    return () => {
      cancelled = true;
    };
  }, [gameName, tagLine]);

  useEffect(() => {
    if (state.status !== "live") return;
    const visiblePuuids = state.game.participants.filter((p) => !p.hidden).map((p) => p.puuid);
    if (visiblePuuids.length === 0) return;

    let cancelled = false;
    const voterKey = session ? session.puuid : getOrCreateUnverifiedReviewerId();
    fetchReviewsBatch(visiblePuuids, voterKey)
      .then((byPuuid) => {
        if (!cancelled) setReviewsByPuuid(byPuuid);
      })
      .catch(() => {
        if (!cancelled) setReviewsByPuuid({});
      });
    return () => {
      cancelled = true;
    };
  }, [state.status === "live" ? state.game.gameId : null, session?.puuid]);

  if (state.status === "loading") {
    return <LoadingState message="Checking for an active game…" />;
  }

  if (state.status === "error") {
    return (
      <div className="card live-not-found">
        <h2>Couldn't load this live game</h2>
        <p className="muted">{state.message}</p>
      </div>
    );
  }

  if (state.status === "not-live") {
    return (
      <div className="card live-not-found">
        <h2>
          {gameName}#{tagLine} isn't in a game right now
        </h2>
        <p className="muted">spectator-v5 returned 404 — this player isn't currently in an active game.</p>
      </div>
    );
  }

  const { game } = state;
  const blue = game.participants.filter((p) => p.teamId === 100);
  const red = game.participants.filter((p) => p.teamId === 200);
  const elapsedMin = Math.max(0, Math.round((Date.now() - game.gameStartTimestamp) / 60000));
  const anyHidden = game.participants.some((p) => p.hidden);

  return (
    <div className="live-match">
      <header className="live-match-header">
        <h1>Live Game</h1>
        <span className="tag">{game.queueType}</span>
        <span className="faint">{elapsedMin} min elapsed</span>
      </header>

      {anyHidden && (
        <p className="faint live-match-disclaimer">
          One or more players here have Riot's Streamer Mode enabled, so their identity is hidden
          from this live view (Patch 25.20+ anonymity change) — they'll show up normally once the
          match ends and match-v5 history is available.
        </p>
      )}

      <div className="live-match-teams">
        <TeamColumn label="Blue Team" participants={blue} side="blue" reviewsByPuuid={reviewsByPuuid} />
        <TeamColumn label="Red Team" participants={red} side="red" reviewsByPuuid={reviewsByPuuid} />
      </div>
    </div>
  );
}

function TeamColumn({
  label,
  participants,
  side,
  reviewsByPuuid,
}: {
  label: string;
  participants: LiveGameParticipant[];
  side: "blue" | "red";
  reviewsByPuuid: Record<string, Review[]>;
}) {
  return (
    <div className={`live-team live-team-${side}`}>
      <h2>{label}</h2>
      {participants.map((p) => {
        if (p.hidden) {
          return (
            <div key={p.puuid} className="live-player-row live-player-row-hidden">
              <ChampionAvatar championName={p.championName} />
              <div className="live-player-info">
                <span className="live-player-name faint">Hidden — Streamer Mode</span>
              </div>
            </div>
          );
        }

        const summary = computeReviewSummary(reviewsByPuuid[p.puuid] ?? []);
        return (
          <Link
            key={p.puuid}
            to={`/profile/${encodeURIComponent(p.riotId.gameName)}/${encodeURIComponent(p.riotId.tagLine)}`}
            className="live-player-row"
          >
            <ChampionAvatar championName={p.championName} />
            <div className="live-player-info">
              <span className="live-player-name">
                {p.riotId.gameName}
                <span className="faint">#{p.riotId.tagLine}</span>
              </span>
              <RankBadge rank={p.soloRank} />
            </div>
            <div className="live-player-champs">
              {p.topChampions.slice(0, 2).map((c) => (
                <span className="faint" key={c.championName}>
                  {c.championName} ({Math.round((c.wins / c.gamesPlayed) * 100)}%)
                </span>
              ))}
            </div>
            <div className="live-player-reviews">
              {summary.reviewCount > 0 ? (
                <span className="tag live-review-tag">★ {summary.overallAverage.toFixed(1)} ({summary.reviewCount})</span>
              ) : (
                <span className="faint">No reviews</span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
