import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useSession } from "../../hooks/useSession";
import { fetchProfile, fetchReviewsBatch, submitReview } from "../../lib/api";
import { PROFILE_REFRESH_COOLDOWN_MS, readProfileCache, writeProfileCache } from "../../lib/profileCache";
import { REVIEW_BODY_MAX_LENGTH, REVIEW_ELIGIBILITY_WINDOW_MS } from "../../lib/constants";
import { countSharedGames, countSharedGamesByMode } from "../../lib/reviewStats";
import { timeAgo } from "../../lib/time";
import { ChampionAvatar } from "../../components/ChampionAvatar/ChampionAvatar";
import { RatingStars } from "../../components/RatingStars/RatingStars";
import { RatingSlider } from "../../components/RatingSlider/RatingSlider";
import { LoadingState } from "../../components/Spinner/Spinner";
import { REVIEW_CATEGORIES } from "../../types";
import type { MatchParticipant, MatchSummary, Review, ReviewCategory, ReviewScores } from "../../types";
// Reuses ReviewForm's score-row/field styling and DashboardPage's
// teammate-row/enemy-tag styling rather than redefining them — both are
// plain global classes (this app doesn't use CSS modules), so importing
// them here just makes those selectors available.
import "../../components/ReviewForm/ReviewForm.css";
import "../DashboardPage/DashboardPage.css";
import "./BulkReviewPage.css";

type DraftScores = Record<ReviewCategory, number>;

const emptyScores: DraftScores = {
  micro: 0,
  macro: 0,
  pingingRate: 0,
  aggressivePassive: 0,
  tiltProne: 0,
  teamPlayer: 0,
};

interface RowDraft {
  expanded: boolean;
  scores: DraftScores;
  body: string;
}

const emptyDraft: RowDraft = { expanded: false, scores: emptyScores, body: "" };

type RowResult = { status: "idle" } | { status: "submitting" } | { status: "success" } | { status: "error"; message: string };

function hasContent(draft: RowDraft): boolean {
  return draft.body.trim().length > 0 || REVIEW_CATEGORIES.some((c) => draft.scores[c.key] > 0);
}

// Review everyone from one match (allies and enemies alike) in a single
// pass instead of opening ReviewForm nine separate times. Scoped to the
// signed-in, Riot-verified user reviewing their own match — same gate
// DashboardPage already applies — so the reviewer's identity is always
// the session's verified one; no unverified/typed-Riot-ID path here (that
// stays on the single-review flow via ReviewForm on PlayerProfilePage).
export function BulkReviewPage() {
  const { matchId = "" } = useParams();
  const session = useSession();

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; matches: MatchSummary[]; match: MatchSummary }
  >({ status: "loading" });

  const riotPuuid = session?.riotPuuid ?? null;
  const riotGameName = session?.riotGameName ?? null;
  const riotTagLine = session?.riotTagLine ?? null;

  useEffect(() => {
    if (!riotGameName || !riotTagLine) return;
    let cancelled = false;
    setState({ status: "loading" });

    const cached = readProfileCache(riotGameName, riotTagLine);
    const load =
      cached && Date.now() - cached.fetchedAt < PROFILE_REFRESH_COOLDOWN_MS
        ? Promise.resolve({ profile: cached.profile, matches: cached.matches })
        : fetchProfile(riotGameName, riotTagLine).then((result) => {
            writeProfileCache(riotGameName, riotTagLine, { ...result, isLive: cached?.isLive ?? false });
            return result;
          });

    load
      .then(({ matches }) => {
        if (cancelled) return;
        const match = matches.find((m) => m.matchId === matchId);
        if (!match) {
          setState({ status: "error", message: "Couldn't find that match in your recent match history." });
          return;
        }
        setState({ status: "ready", matches, match });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Couldn't load that match." });
      });

    return () => {
      cancelled = true;
    };
  }, [riotGameName, riotTagLine, matchId]);

  const [reviewsByTarget, setReviewsByTarget] = useState<Record<string, Review[]>>({});
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [rowResults, setRowResults] = useState<Record<string, RowResult>>({});
  const [submitting, setSubmitting] = useState(false);

  const matchIdReady = state.status === "ready" ? state.match.matchId : null;
  const others: MatchParticipant[] =
    state.status === "ready" ? state.match.participants.filter((p) => p.puuid !== riotPuuid) : [];
  const selfTeamId =
    state.status === "ready" ? state.match.participants.find((p) => p.puuid === riotPuuid)?.teamId : undefined;
  const teammates = others.filter((p) => p.teamId === selfTeamId);
  const opponents = others.filter((p) => p.teamId !== selfTeamId);

  useEffect(() => {
    if (!riotPuuid || !matchIdReady || others.length === 0) return;
    let cancelled = false;
    fetchReviewsBatch(others.map((p) => p.puuid), riotPuuid)
      .then((byPuuid) => {
        if (!cancelled) setReviewsByTarget(byPuuid);
      })
      .catch(() => {
        if (!cancelled) setReviewsByTarget({});
      });
    return () => {
      cancelled = true;
    };
    // others is derived fresh each render — keying on the match id it came
    // from avoids re-fetching on every render.
  }, [riotPuuid, matchIdReady]);

  function getRow(puuid: string): RowDraft {
    return rows[puuid] ?? emptyDraft;
  }

  function toggleRow(puuid: string) {
    setRows((prev) => ({ ...prev, [puuid]: { ...getRow(puuid), expanded: !getRow(puuid).expanded } }));
  }

  function setRowScore(puuid: string, category: ReviewCategory, value: number) {
    setRows((prev) => {
      const row = getRow(puuid);
      return { ...prev, [puuid]: { ...row, scores: { ...row.scores, [category]: value } } };
    });
  }

  function setRowBody(puuid: string, body: string) {
    setRows((prev) => ({ ...prev, [puuid]: { ...getRow(puuid), body: body.slice(0, REVIEW_BODY_MAX_LENGTH) } }));
  }

  async function handleSubmitAll() {
    if (state.status !== "ready" || !riotPuuid) return;
    const { matches } = state;

    const targets = others.filter((p) => {
      const already = (reviewsByTarget[p.puuid] ?? []).some((r) => r.isMine);
      return !already && hasContent(getRow(p.puuid));
    });
    if (targets.length === 0) return;

    setSubmitting(true);
    setRowResults((prev) => {
      const next = { ...prev };
      for (const p of targets) next[p.puuid] = { status: "submitting" };
      return next;
    });

    const results = await Promise.allSettled(
      targets.map(async (p) => {
        const row = getRow(p.puuid);
        const submittedScores: ReviewScores = REVIEW_CATEGORIES.reduce((acc, c) => {
          acc[c.key] = row.scores[c.key] > 0 ? row.scores[c.key] : null;
          return acc;
        }, {} as ReviewScores);
        const review = await submitReview({
          id: `rev-${crypto.randomUUID()}`,
          targetPuuid: p.puuid,
          reviewerKind: "verified",
          scores: submittedScores,
          body: row.body.trim(),
          sharedGamesWithTarget: countSharedGames(matches, p.puuid, riotPuuid),
          sharedGamesByMode: countSharedGamesByMode(matches, p.puuid, riotPuuid),
        });
        return { puuid: p.puuid, review };
      }),
    );

    setRowResults((prev) => {
      const next = { ...prev };
      results.forEach((result, i) => {
        const puuid = targets[i].puuid;
        next[puuid] =
          result.status === "fulfilled"
            ? { status: "success" }
            : { status: "error", message: result.reason instanceof Error ? result.reason.message : "Failed to submit." };
      });
      return next;
    });

    setReviewsByTarget((prev) => {
      const next = { ...prev };
      results.forEach((result) => {
        if (result.status === "fulfilled") {
          const { puuid, review } = result.value;
          next[puuid] = [review, ...(next[puuid] ?? [])];
        }
      });
      return next;
    });

    setSubmitting(false);
  }

  if (session === undefined) {
    return <LoadingState message="Loading…" />;
  }
  if (session === null) {
    return <Navigate to="/" replace />;
  }
  if (!session.riotPuuid) {
    return (
      <div className="bulk-review-page">
        <p className="muted">Verify your Riot account from the dashboard before reviewing a match.</p>
        <Link className="btn btn-primary" to="/dashboard">
          Go to dashboard
        </Link>
      </div>
    );
  }
  if (state.status === "loading") {
    return <LoadingState message="Loading match…" />;
  }
  if (state.status === "error") {
    return (
      <div className="bulk-review-page">
        <p className="muted">{state.message}</p>
        <Link className="btn btn-primary" to="/dashboard">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { match } = state;
  const isEligible = Date.now() - match.timestamp <= REVIEW_ELIGIBILITY_WINDOW_MS;
  const self = match.participants.find((p) => p.puuid === riotPuuid);

  const submittableCount = others.filter((p) => {
    const already = (reviewsByTarget[p.puuid] ?? []).some((r) => r.isMine);
    return !already && hasContent(getRow(p.puuid));
  }).length;

  return (
    <div className="bulk-review-page">
      <header className="bulk-review-header">
        <h1>Review this match</h1>
        <div className="dashboard-match-summary">
          <span className={self?.win ? "win" : "loss"}>{self?.win ? "Victory" : "Defeat"}</span>
          <span className="faint">{match.queueType}</span>
          <span className="faint">{Math.round(match.durationSeconds / 60)} min</span>
          <span className="faint">{timeAgo(match.timestamp)}</span>
        </div>
      </header>

      {!isEligible ? (
        <p className="muted">
          This match was {timeAgo(match.timestamp)} — reviews are only allowed within 7 days of playing
          together, so this match can no longer be reviewed.
        </p>
      ) : (
        <>
          <p className="muted">
            Rate and comment on as many players as you'd like — you don't have to review everyone. Only
            rows with a comment or at least one rating get submitted.
          </p>

          {teammates.length > 0 && (
            <section>
              <h2 className="bulk-review-group-title">Teammates</h2>
              <div className="bulk-review-rows">
                {teammates.map((p) => (
                  <ParticipantReviewRow
                    key={p.puuid}
                    participant={p}
                    alreadyReviewed={(reviewsByTarget[p.puuid] ?? []).some((r) => r.isMine)}
                    draft={getRow(p.puuid)}
                    result={rowResults[p.puuid] ?? { status: "idle" }}
                    onToggle={() => toggleRow(p.puuid)}
                    onScoreChange={(category, value) => setRowScore(p.puuid, category, value)}
                    onBodyChange={(body) => setRowBody(p.puuid, body)}
                  />
                ))}
              </div>
            </section>
          )}

          {opponents.length > 0 && (
            <section>
              <h2 className="bulk-review-group-title">Opponents</h2>
              <div className="bulk-review-rows">
                {opponents.map((p) => (
                  <ParticipantReviewRow
                    key={p.puuid}
                    participant={p}
                    enemy
                    alreadyReviewed={(reviewsByTarget[p.puuid] ?? []).some((r) => r.isMine)}
                    draft={getRow(p.puuid)}
                    result={rowResults[p.puuid] ?? { status: "idle" }}
                    onToggle={() => toggleRow(p.puuid)}
                    onScoreChange={(category, value) => setRowScore(p.puuid, category, value)}
                    onBodyChange={(body) => setRowBody(p.puuid, body)}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="bulk-review-submit-bar">
            <span className="faint">
              {submittableCount === 0
                ? "Add a comment or rating to at least one player to submit."
                : `${submittableCount} review${submittableCount === 1 ? "" : "s"} ready to submit.`}
            </span>
            <button className="btn btn-primary" disabled={submittableCount === 0 || submitting} onClick={handleSubmitAll}>
              {submitting ? "Submitting…" : "Submit reviews"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ParticipantReviewRow({
  participant,
  enemy = false,
  alreadyReviewed,
  draft,
  result,
  onToggle,
  onScoreChange,
  onBodyChange,
}: {
  participant: MatchParticipant;
  enemy?: boolean;
  alreadyReviewed: boolean;
  draft: RowDraft;
  result: RowResult;
  onToggle: () => void;
  onScoreChange: (category: ReviewCategory, value: number) => void;
  onBodyChange: (body: string) => void;
}) {
  const submitted = result.status === "success";
  const locked = alreadyReviewed || submitted;

  return (
    <div className="bulk-review-row card">
      <button type="button" className="bulk-review-row-header" onClick={onToggle} disabled={locked}>
        <ChampionAvatar championName={participant.championName} />
        <div className="dashboard-teammate-info">
          <span>
            {participant.riotId.gameName}
            <span className="faint">#{participant.riotId.tagLine}</span>
          </span>
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
        <span className="faint bulk-review-row-status">
          {alreadyReviewed ? "Already reviewed" : submitted ? "Submitted ✓" : draft.expanded ? "▲" : "▼"}
        </span>
      </button>

      {draft.expanded && !locked && (
        <div className="bulk-review-row-body">
          <div className="review-form-scores">
            {REVIEW_CATEGORIES.map((category) => (
              <div className="review-form-score-row" key={category.key}>
                <div>
                  <div className="review-form-score-label">{category.label}</div>
                  <div className="faint review-form-score-hint">{category.hint}</div>
                </div>
                {category.inputType === "stars" ? (
                  <RatingStars
                    value={draft.scores[category.key]}
                    onChange={(v) => onScoreChange(category.key, v === draft.scores[category.key] ? 0 : v)}
                    label={category.label}
                  />
                ) : (
                  <RatingSlider
                    value={draft.scores[category.key]}
                    onChange={(v) => onScoreChange(category.key, v)}
                    lowLabel={category.lowLabel}
                    highLabel={category.highLabel}
                    label={category.label}
                  />
                )}
              </div>
            ))}
          </div>

          <label className="review-form-field">
            Comment (optional if you've rated at least one category above)
            <textarea value={draft.body} onChange={(e) => onBodyChange(e.target.value)} rows={3} />
            <span className="faint review-form-counter">{REVIEW_BODY_MAX_LENGTH - draft.body.length} characters remaining</span>
          </label>

          {result.status === "error" && <p className="review-form-submit-error">{result.message}</p>}
        </div>
      )}
    </div>
  );
}
