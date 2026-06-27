import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { ApiError, fetchLiveGame, fetchProfile, fetchReviewsForTarget } from "../../lib/api";
import { computeReviewSummary } from "../../lib/reviewStats";
import { addRecentSearch, getOrCreateUnverifiedReviewerId } from "../../lib/session";
import { profileIconUrl, useDdragonVersion } from "../../lib/ddragon";
import { ChampionAvatar } from "../../components/ChampionAvatar/ChampionAvatar";
import { RankBadge } from "../../components/RankBadge/RankBadge";
import { LoadingState } from "../../components/Spinner/Spinner";
import { MatchHistoryCard } from "../../components/MatchHistoryCard/MatchHistoryCard";
import { ReviewSummaryPanel } from "../../components/ReviewSummaryPanel/ReviewSummaryPanel";
import { ReviewCard } from "../../components/ReviewCard/ReviewCard";
import { ReviewForm } from "../../components/ReviewForm/ReviewForm";
import type { MatchSummary, Review, SummonerProfile } from "../../types";
import "./PlayerProfilePage.css";

// Search result / player profile — the op.gg-style half (rank, win rate,
// top champions, match history come from GET /api/profile/:gameName/:tagLine,
// see server.js) plus our own reviews layer underneath (never from Riot —
// reviews are served from our own Postgres-backed API, see server.js's
// /api/reviews routes and db.js).
export function PlayerProfilePage() {
  const { gameName = "", tagLine = "" } = useParams();
  const session = useSession();
  const ddragonVersion = useDdragonVersion();

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; kind: "not-found" | "rate-limited" | "unknown"; message: string }
    | { status: "ready"; profile: SummonerProfile; matches: MatchSummary[]; isLive: boolean }
  >({ status: "loading" });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    Promise.all([fetchProfile(gameName, tagLine), fetchLiveGame(gameName, tagLine).catch(() => ({ live: false as const }))])
      .then(([{ profile, matches }, liveResult]) => {
        if (cancelled) return;
        setState({ status: "ready", profile, matches, isLive: liveResult.live });
        addRecentSearch(profile.riotId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A 404 really does mean "no such player" — anything else (429
        // rate limit, 5xx, network failure) is a different problem and
        // shouldn't be reported as if the player doesn't exist.
        if (error instanceof ApiError && error.status === 404) {
          setState({
            status: "error",
            kind: "not-found",
            message: `We couldn't find ${gameName}#${tagLine}. Double check the Riot ID and region.`,
          });
        } else if (error instanceof ApiError && error.status === 429) {
          setState({
            status: "error",
            kind: "rate-limited",
            message: error.message,
          });
        } else {
          setState({
            status: "error",
            kind: "unknown",
            message: error instanceof Error ? error.message : "Something went wrong looking that player up.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [gameName, tagLine, retryNonce]);

  const targetPuuid = state.status === "ready" ? state.profile.puuid : null;

  // Separate from the profile/live fetch above so that signing in or out
  // while already viewing a profile re-checks isMine/myVote (which depend
  // on voterKey) without re-fetching profile/match data unnecessarily.
  useEffect(() => {
    if (!targetPuuid) return;
    let cancelled = false;
    const voterKey = session ? session.puuid : getOrCreateUnverifiedReviewerId();
    fetchReviewsForTarget(targetPuuid, voterKey)
      .then((fetched) => {
        if (!cancelled) setReviews(fetched);
      })
      .catch(() => {
        if (!cancelled) setReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [targetPuuid, session?.puuid]);

  if (state.status === "loading") {
    return <LoadingState message={`Loading ${gameName}#${tagLine}'s profile…`} />;
  }

  if (state.status === "error") {
    const heading =
      state.kind === "not-found"
        ? `No player found for ${gameName}#${tagLine}`
        : state.kind === "rate-limited"
          ? "Riot API rate limit hit"
          : "Something went wrong";
    return (
      <div className="profile-not-found card">
        <h2>{heading}</h2>
        <p className="muted">{state.message}</p>
        {state.kind !== "not-found" && (
          <button className="btn btn-primary" onClick={() => setRetryNonce((n) => n + 1)}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const { profile, matches, isLive } = state;
  const summary = computeReviewSummary(reviews);
  const isSelf = session?.puuid === profile.puuid;

  return (
    <div className="profile-page">
      {isLive && (
        <Link
          to={`/live/${encodeURIComponent(profile.riotId.gameName)}/${encodeURIComponent(profile.riotId.tagLine)}`}
          className="profile-live-banner"
        >
          🔴 Currently in a live game — view live match breakdown
        </Link>
      )}

      <header className="card profile-header">
        <img
          className="profile-icon"
          alt=""
          src={profileIconUrl(profile.profileIconId, ddragonVersion)}
        />
        <div className="profile-header-info">
          <h1>
            {profile.riotId.gameName}
            <span className="faint">#{profile.riotId.tagLine}</span>
          </h1>
          <span className="faint">Level {profile.summonerLevel}</span>
        </div>
        <RankBadge rank={profile.soloRank} />
        {!isSelf && (
          <button className="btn btn-primary" onClick={() => setShowReviewForm(true)}>
            Write a review
          </button>
        )}
      </header>

      <section className="profile-stats card">
        <div className="profile-stat">
          <span className="profile-stat-value">{profile.winRate}%</span>
          <span className="faint">Win rate</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-value">{profile.avgKda.toFixed(1)}</span>
          <span className="faint">Avg KDA</span>
        </div>
        <div className="profile-top-champions">
          {profile.topChampions.length === 0 ? (
            <span className="faint">No recent ranked games to summarize champions from.</span>
          ) : (
            profile.topChampions.map((c) => (
              <div className="profile-champion" key={c.championName}>
                <ChampionAvatar championName={c.championName} size={32} />
                <div>
                  <div>{c.championName}</div>
                  <span className="faint">
                    {c.gamesPlayed} games · {Math.round((c.wins / c.gamesPlayed) * 100)}% WR · {c.avgKda.toFixed(1)} KDA
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="profile-section-title">Match history</h2>
        {matches.length === 0 ? (
          <p className="muted">No recent ranked matches found.</p>
        ) : (
          <div className="profile-match-list">
            {matches.map((m) => (
              <MatchHistoryCard key={m.matchId} match={m} focusPuuid={profile.puuid} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="profile-section-title">Reviews</h2>
        <ReviewSummaryPanel summary={summary} />
        <div className="profile-review-list">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      </section>

      {showReviewForm && (
        <ReviewForm
          target={profile}
          targetMatches={matches}
          alreadyReviewed={reviews.some((r) => r.isMine)}
          session={session}
          onClose={() => setShowReviewForm(false)}
          onSubmit={(review) => {
            setReviews((prev) => [review, ...prev]);
            setShowReviewForm(false);
          }}
        />
      )}
    </div>
  );
}
