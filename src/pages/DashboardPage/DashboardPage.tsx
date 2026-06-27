import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { fetchProfile, fetchReviewsBatch } from "../../lib/api";
import { ChampionAvatar } from "../../components/ChampionAvatar/ChampionAvatar";
import { ReviewForm } from "../../components/ReviewForm/ReviewForm";
import { LoadingState } from "../../components/Spinner/Spinner";
import type { MatchParticipant, MatchSummary, Review, RiotId } from "../../types";
import "./DashboardPage.css";

// Home base once signed in. Real RSO wouldn't need anything more than the
// puuid already in session; the match-v5 lookup below (via
// GET /api/profile/:gameName/:tagLine, see server.js) is the same one a
// profile page uses, just pointed at your own Riot ID.
export function DashboardPage() {
  const session = useSession();
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; matches: MatchSummary[] }
  >({ status: "loading" });
  const [reviewTarget, setReviewTarget] = useState<{ puuid: string; riotId: RiotId } | null>(null);
  const [reviewsByTeammate, setReviewsByTeammate] = useState<Record<string, Review[]>>({});

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchProfile(session.riotId.gameName, session.riotId.tagLine)
      .then(({ matches }) => {
        if (!cancelled) setState({ status: "ready", matches });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't load your matches." });
      });
    return () => {
      cancelled = true;
    };
  }, [session?.puuid]);

  const teammates: MatchParticipant[] =
    state.status === "ready" && state.matches[0]
      ? state.matches[0].participants.filter(
          (p) => p.puuid !== session?.puuid && p.teamId === state.matches[0].participants.find((s) => s.puuid === session?.puuid)?.teamId,
        )
      : [];

  // Fetched once the teammate list is known, so the "Reviewed" disabled
  // state on each button reflects reality instead of assuming nobody's
  // been reviewed yet.
  useEffect(() => {
    if (!session || teammates.length === 0) return;
    let cancelled = false;
    fetchReviewsBatch(teammates.map((t) => t.puuid), session.puuid)
      .then((byPuuid) => {
        if (!cancelled) setReviewsByTeammate(byPuuid);
      })
      .catch(() => {
        if (!cancelled) setReviewsByTeammate({});
      });
    return () => {
      cancelled = true;
    };
    // teammates is derived fresh each render from `state`; comparing by the
    // match id it came from avoids re-fetching on every render.
  }, [session?.puuid, state.status === "ready" ? state.matches[0]?.matchId : null]);

  if (!session) {
    return <Navigate to="/" replace />;
  }

  if (state.status === "loading") {
    return <LoadingState message="Loading your recent matches…" />;
  }

  if (state.status === "error") {
    return <p className="muted">{state.message}</p>;
  }

  const { matches } = state;
  const latestMatch = matches[0];

  if (!latestMatch) {
    return (
      <div className="dashboard">
        <h1>
          Welcome back, {session.riotId.gameName}
          <span className="faint">#{session.riotId.tagLine}</span>
        </h1>
        <p className="muted">No recent ranked matches found for this account yet.</p>
      </div>
    );
  }

  const self = latestMatch.participants.find((p) => p.puuid === session.puuid);

  return (
    <div className="dashboard">
      <h1>
        Welcome back, {session.riotId.gameName}
        <span className="faint">#{session.riotId.tagLine}</span>
      </h1>

      <section className="card dashboard-recent-match">
        <h2>Your most recent match</h2>
        <div className="dashboard-match-summary">
          <span className={self?.win ? "win" : "loss"}>{self?.win ? "Victory" : "Defeat"}</span>
          <span className="faint">{latestMatch.queueType}</span>
          <span className="faint">{Math.round(latestMatch.durationSeconds / 60)} min</span>
        </div>

        <p className="muted">
          Played with {teammates.length} teammate{teammates.length === 1 ? "" : "s"}. Leave them a
          review while it's fresh — reviews are only allowed once you've shared enough games with
          someone.
        </p>

        <div className="dashboard-teammates">
          {teammates.map((teammate) => {
            const alreadyReviewed = (reviewsByTeammate[teammate.puuid] ?? []).some((r) => r.isMine);
            return (
              <div className="dashboard-teammate-row" key={teammate.puuid}>
                <ChampionAvatar championName={teammate.championName} />
                <div className="dashboard-teammate-info">
                  <Link
                    to={`/profile/${encodeURIComponent(teammate.riotId.gameName)}/${encodeURIComponent(teammate.riotId.tagLine)}`}
                  >
                    {teammate.riotId.gameName}
                    <span className="faint">#{teammate.riotId.tagLine}</span>
                  </Link>
                  <span className="faint">
                    {teammate.championName} · {teammate.kills}/{teammate.deaths}/{teammate.assists}
                  </span>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={alreadyReviewed}
                  onClick={() => setReviewTarget({ puuid: teammate.puuid, riotId: teammate.riotId })}
                >
                  {alreadyReviewed ? "Reviewed" : "Review"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {reviewTarget && (
        <ReviewForm
          target={reviewTarget}
          targetMatches={matches}
          alreadyReviewed={(reviewsByTeammate[reviewTarget.puuid] ?? []).some((r) => r.isMine)}
          session={session}
          onClose={() => setReviewTarget(null)}
          onSubmit={(review) => {
            setReviewsByTeammate((prev) => ({
              ...prev,
              [reviewTarget.puuid]: [review, ...(prev[reviewTarget.puuid] ?? [])],
            }));
            setReviewTarget(null);
          }}
        />
      )}
    </div>
  );
}
