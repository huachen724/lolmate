import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { fetchMyReviews, fetchProfile, fetchReviewsBatch } from "../../lib/api";
import { PROFILE_REFRESH_COOLDOWN_MS, readProfileCache, writeProfileCache } from "../../lib/profileCache";
import { REVIEW_ELIGIBILITY_WINDOW_MS } from "../../lib/constants";
import { timeAgo } from "../../lib/time";
import { ChampionAvatar } from "../../components/ChampionAvatar/ChampionAvatar";
import { RefreshStatus } from "../../components/RefreshStatus/RefreshStatus";
import { ReviewForm } from "../../components/ReviewForm/ReviewForm";
import { ReviewCard } from "../../components/ReviewCard/ReviewCard";
import { RiotVerifyModal } from "../../components/RiotVerifyModal/RiotVerifyModal";
import { ReconcileReviewsModal } from "../../components/ReconcileReviewsModal/ReconcileReviewsModal";
import { LoadingState } from "../../components/Spinner/Spinner";
import type { MatchParticipant, MatchSummary, MyReview, Review, RiotId } from "../../types";
import "./DashboardPage.css";

// Home base once signed in. Requires both a login (Discord/Google) *and* a
// linked, icon-verified Riot account (session.riotPuuid) — without the
// latter there's no known puuid to fetch "your" matches for, so that state
// gets a CTA to complete verification instead of the normal dashboard.
export function DashboardPage() {
  const session = useSession();
  const [showVerify, setShowVerify] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; matches: MatchSummary[]; fetchedAt: number }
  >({ status: "loading" });
  const [reviewTarget, setReviewTarget] = useState<{ puuid: string; riotId: RiotId } | null>(null);
  const [reviewsByTeammate, setReviewsByTeammate] = useState<Record<string, Review[]>>({});
  // Same bypass-cache-once pattern as PlayerProfilePage's forceRefresh: a
  // plain nonce dependency can't distinguish "user asked for a real
  // refresh" from "riotGameName/riotTagLine changed", so this ref is what
  // actually tells the fetch effect to skip the cache for one run.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const forceRefetchRef = useRef(false);

  const riotPuuid = session?.riotPuuid ?? null;
  const riotGameName = session?.riotGameName ?? null;
  const riotTagLine = session?.riotTagLine ?? null;

  useEffect(() => {
    if (!riotPuuid || !riotGameName || !riotTagLine) return;
    const bypassCache = forceRefetchRef.current;
    forceRefetchRef.current = false;

    if (!bypassCache) {
      const cached = readProfileCache(riotGameName, riotTagLine);
      if (cached && Date.now() - cached.fetchedAt < PROFILE_REFRESH_COOLDOWN_MS) {
        setState({ status: "ready", matches: cached.matches, fetchedAt: cached.fetchedAt });
        return;
      }
    }

    let cancelled = false;
    setState({ status: "loading" });
    fetchProfile(riotGameName, riotTagLine)
      .then(({ profile, matches }) => {
        if (cancelled) return;
        const fetchedAt = Date.now();
        setState({ status: "ready", matches, fetchedAt });
        // Preserve isLive from an existing cache entry (e.g. one
        // PlayerProfilePage already wrote for this same Riot ID) rather
        // than clobbering it — this page never calls fetchLiveGame itself.
        const existing = readProfileCache(riotGameName, riotTagLine);
        writeProfileCache(riotGameName, riotTagLine, { profile, matches, isLive: existing?.isLive ?? false });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't load your matches." });
      });
    return () => {
      cancelled = true;
    };
  }, [riotPuuid, riotGameName, riotTagLine, refreshNonce]);

  function forceRefresh() {
    forceRefetchRef.current = true;
    setRefreshNonce((n) => n + 1);
  }

  // Every other participant from your most recent match — teammates and
  // opponents alike. Team no longer gates review eligibility (the backend
  // never checked it either; it only requires a shared match within the
  // review window), so both groups get the same "Review" prompt here.
  const others: MatchParticipant[] =
    state.status === "ready" && state.matches[0]
      ? state.matches[0].participants.filter((p) => p.puuid !== riotPuuid)
      : [];
  const selfTeamId =
    state.status === "ready" ? state.matches[0]?.participants.find((p) => p.puuid === riotPuuid)?.teamId : undefined;
  const teammates = others.filter((p) => p.teamId === selfTeamId);
  const opponents = others.filter((p) => p.teamId !== selfTeamId);

  // Fetched once the participant list is known, so the "Reviewed" disabled
  // state on each button reflects reality instead of assuming nobody's
  // been reviewed yet.
  useEffect(() => {
    if (!riotPuuid || others.length === 0) return;
    let cancelled = false;
    fetchReviewsBatch(others.map((t) => t.puuid), riotPuuid)
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
  }, [riotPuuid, state.status === "ready" ? state.matches[0]?.matchId : null]);

  const [myReviews, setMyReviews] = useState<
    { status: "idle" | "loading" } | { status: "ready"; reviews: MyReview[] } | { status: "error"; message: string }
  >({ status: "idle" });
  const [myReviewsSearch, setMyReviewsSearch] = useState("");
  const [myReviewsRange, setMyReviewsRange] = useState<"all" | "7d" | "30d">("all");

  useEffect(() => {
    if (!riotPuuid) return;
    let cancelled = false;
    setMyReviews({ status: "loading" });
    fetchMyReviews()
      .then((reviews) => {
        if (!cancelled) setMyReviews({ status: "ready", reviews });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setMyReviews({ status: "error", message: error instanceof Error ? error.message : "Couldn't load your reviews." });
      });
    return () => {
      cancelled = true;
    };
  }, [riotPuuid]);

  const filteredMyReviews = useMemo(() => {
    if (myReviews.status !== "ready") return [];
    const search = myReviewsSearch.trim().toLowerCase();
    const cutoff =
      myReviewsRange === "7d" ? Date.now() - 7 * 24 * 60 * 60 * 1000 : myReviewsRange === "30d" ? Date.now() - 30 * 24 * 60 * 60 * 1000 : null;
    return myReviews.reviews.filter((r) => {
      if (cutoff !== null && r.createdAt < cutoff) return false;
      if (search && !(r.targetRiotId?.gameName.toLowerCase().includes(search) ?? false)) return false;
      return true;
    });
  }, [myReviews, myReviewsSearch, myReviewsRange]);

  if (session === undefined) {
    return <LoadingState message="Loading…" />;
  }

  if (session === null) {
    return <Navigate to="/" replace />;
  }

  if (!session.riotPuuid) {
    return (
      <div className="dashboard">
        <h1>Welcome, {session.displayName}</h1>
        <div className="card dashboard-verify-prompt">
          <p className="muted">
            Link and verify your Riot account to see your recent matches and review teammates from
            them.
          </p>
          <button className="btn btn-primary" onClick={() => setShowVerify(true)}>
            Verify Riot account
          </button>
        </div>
        {showVerify && (
          <RiotVerifyModal
            onClose={() => setShowVerify(false)}
            onVerified={() => {
              setShowVerify(false);
              setShowReconcile(true);
            }}
          />
        )}
        {showReconcile && <ReconcileReviewsModal onClose={() => setShowReconcile(false)} />}
      </div>
    );
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
          Welcome back, {session.riotGameName}
          <span className="faint">#{session.riotTagLine}</span>
        </h1>
        <RefreshStatus fetchedAt={state.fetchedAt} cooldownMs={PROFILE_REFRESH_COOLDOWN_MS} onRefresh={forceRefresh} />
        <p className="muted">No recent ranked matches found for this account yet.</p>
      </div>
    );
  }

  const self = latestMatch.participants.find((p) => p.puuid === riotPuuid);

  // Every other participant shares this same match, so — unlike
  // ReviewForm's per-target, multi-match eligibility calculation — there's
  // just one eligibility check for the whole card: this specific match's
  // age. Computed up front so the "Review" buttons can be disabled (with a
  // tooltip explaining why) instead of only failing once the modal opens.
  const isMatchReviewable = Date.now() - latestMatch.timestamp <= REVIEW_ELIGIBILITY_WINDOW_MS;
  const matchDisabledReason = isMatchReviewable
    ? undefined
    : `This match was ${timeAgo(latestMatch.timestamp)} — reviews are only allowed within 7 days of playing together.`;

  return (
    <div className="dashboard">
      <h1>
        Welcome back, {session.riotGameName}
        <span className="faint">#{session.riotTagLine}</span>
      </h1>
      <RefreshStatus fetchedAt={state.fetchedAt} cooldownMs={PROFILE_REFRESH_COOLDOWN_MS} onRefresh={forceRefresh} />

      <section className="card dashboard-recent-match">
        <div className="dashboard-recent-match-header">
          <h2>Your most recent match</h2>
          <Link
            className={`btn btn-primary ${!isMatchReviewable ? "btn-disabled" : ""}`}
            to={isMatchReviewable ? `/review/match/${encodeURIComponent(latestMatch.matchId)}` : "#"}
            onClick={(e) => {
              if (!isMatchReviewable) e.preventDefault();
            }}
            aria-disabled={!isMatchReviewable}
            title={matchDisabledReason}
          >
            Review this match
          </Link>
        </div>
        <div className="dashboard-match-summary">
          <span className={self?.win ? "win" : "loss"}>{self?.win ? "Victory" : "Defeat"}</span>
          <span className="faint">{latestMatch.queueType}</span>
          <span className="faint">{Math.round(latestMatch.durationSeconds / 60)} min</span>
        </div>

        <p className="muted">
          Played with {teammates.length} teammate{teammates.length === 1 ? "" : "s"} and against{" "}
          {opponents.length} opponent{opponents.length === 1 ? "" : "s"}. Leave them a review while
          it's fresh — reviews are only allowed if you've played with (or against) them in the past
          week.
        </p>

        {teammates.length > 0 && (
          <>
            <h3 className="dashboard-group-title">Teammates</h3>
            <div className="dashboard-teammates">
              {teammates.map((p) => (
                <ParticipantRow
                  key={p.puuid}
                  participant={p}
                  alreadyReviewed={(reviewsByTeammate[p.puuid] ?? []).some((r) => r.isMine)}
                  disabledReason={matchDisabledReason}
                  onReview={() => setReviewTarget({ puuid: p.puuid, riotId: p.riotId })}
                />
              ))}
            </div>
          </>
        )}

        {opponents.length > 0 && (
          <>
            <h3 className="dashboard-group-title">Opponents</h3>
            <div className="dashboard-teammates">
              {opponents.map((p) => (
                <ParticipantRow
                  key={p.puuid}
                  participant={p}
                  enemy
                  alreadyReviewed={(reviewsByTeammate[p.puuid] ?? []).some((r) => r.isMine)}
                  disabledReason={matchDisabledReason}
                  onReview={() => setReviewTarget({ puuid: p.puuid, riotId: p.riotId })}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card dashboard-my-reviews">
        <h2>My reviews</h2>
        {myReviews.status === "loading" && <p className="muted">Loading your reviews…</p>}
        {myReviews.status === "error" && <p className="muted">{myReviews.message}</p>}
        {myReviews.status === "ready" && (
          <>
            <div className="dashboard-my-reviews-filters">
              <input
                type="search"
                placeholder="Filter by player name…"
                value={myReviewsSearch}
                onChange={(e) => setMyReviewsSearch(e.target.value)}
              />
              <select value={myReviewsRange} onChange={(e) => setMyReviewsRange(e.target.value as "all" | "7d" | "30d")}>
                <option value="all">All time</option>
                <option value="7d">Past 7 days</option>
                <option value="30d">Past 30 days</option>
              </select>
            </div>
            {myReviews.reviews.length === 0 ? (
              <p className="muted">You haven't written any reviews yet.</p>
            ) : filteredMyReviews.length === 0 ? (
              <p className="muted">No reviews match that filter.</p>
            ) : (
              <div className="dashboard-my-reviews-list">
                {filteredMyReviews.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    targetRiotId={review.targetRiotId}
                    onDeleted={(id) =>
                      setMyReviews((prev) =>
                        prev.status === "ready" ? { status: "ready", reviews: prev.reviews.filter((r) => r.id !== id) } : prev,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
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

function ParticipantRow({
  participant,
  enemy = false,
  alreadyReviewed,
  disabledReason,
  onReview,
}: {
  participant: MatchParticipant;
  enemy?: boolean;
  alreadyReviewed: boolean;
  disabledReason?: string;
  onReview: () => void;
}) {
  return (
    <div className="dashboard-teammate-row">
      <ChampionAvatar championName={participant.championName} />
      <div className="dashboard-teammate-info">
        <Link to={`/profile/${encodeURIComponent(participant.riotId.gameName)}/${encodeURIComponent(participant.riotId.tagLine)}`}>
          {participant.riotId.gameName}
          <span className="faint">#{participant.riotId.tagLine}</span>
        </Link>
        <span className="faint">
          {participant.championName} · {participant.kills}/{participant.deaths}/{participant.assists}
          {enemy && (
            <>
              {" · "}
              <span className="tag dashboard-enemy-tag">Enemy</span>
            </>
          )}
        </span>
      </div>
      <button
        className="btn btn-primary"
        disabled={alreadyReviewed || !!disabledReason}
        title={disabledReason}
        onClick={onReview}
      >
        {alreadyReviewed ? "Reviewed" : disabledReason ? "Too old to review" : "Review"}
      </button>
    </div>
  );
}
