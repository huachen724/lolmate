import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool, runMigrations } from "./db.js";
import {
  authProviders,
  FRONTEND_URL,
  clearOAuthState,
  clearSessionCookie,
  discordAuthorizeUrl,
  exchangeDiscordCode,
  exchangeGoogleCode,
  fetchDiscordUser,
  fetchGoogleUser,
  getOAuthStateFromRequest,
  getUserIdFromRequest,
  googleAuthorizeUrl,
  randomState,
  requireAuth,
  setOAuthState,
  setSessionCookie,
} from "./auth.js";

dotenv.config();

const app = express();
// Vercel (frontend) and Render (backend) are different origins in
// production, so this can't be the wildcard `cors()` default once session
// cookies are involved — `credentials: true` requires an explicit origin,
// and the browser only sends/accepts the session cookie cross-site with
// both sides agreeing to it (see auth.js's cookieOptions).
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const PLATFORM = process.env.RIOT_PLATFORM || "na1";
const MAX_RECENT_MATCHES = 10;
const MAX_CONCURRENT_RIOT_CALLS = 5;
// Candidate icons for the profile-icon ownership challenge (see POST
// /api/verify/start) — must be icons every account has unlocked, so a
// legitimate owner can always switch to whichever one gets picked. IDs
// 0-28 are League's original "default" icon set from the pre-level-30-
// rework leveling system, commonly documented as available to every
// account regardless of level or region. Worth spot-checking against a
// couple of real accounts (ideally a low-level/newer one) before fully
// relying on this in production — swap anything that turns out gated.
const ICON_CHALLENGE_POOL = Array.from({ length: 29 }, (_, i) => i);
// Riot's summoner-v4 endpoint (which profileIconId comes from) can lag
// several minutes behind an in-client icon change — the client updates
// its own display instantly, but the API reads from a backend store that
// syncs asynchronously. A 2-minute window (the original spec) turned out
// too tight in practice: real verification attempts were failing with a
// stable, non-matching icon that only later caught up to the actual
// client-side change. 10 minutes gives that lag room without leaving the
// challenge open indefinitely.
const ICON_CHALLENGE_WINDOW_MS = 10 * 60 * 1000;

if (!RIOT_API_KEY) {
  console.error("Missing RIOT_API_KEY in environment.");
}

// Same platform/region mapping as league/server.js.
const regionMap = {
  americas: ["na1", "br1", "la1", "la2", "oc1"],
  europe: ["euw1", "eun1", "ru", "tr1"],
  asia: ["kr", "jp1"],
};

function getMatchRegion(platform) {
  for (const [matchRegion, platforms] of Object.entries(regionMap)) {
    if (platforms.includes(platform)) return matchRegion;
  }
  return "americas";
}

const REGION = process.env.RIOT_REGION || getMatchRegion(PLATFORM);

console.log(`[SERVER] API Key loaded: ${RIOT_API_KEY ? "YES" : "NO"}`);
console.log(`[SERVER] Platform: ${PLATFORM}, Region: ${REGION}`);

// Riot's dev/personal key tiers are rate limited (roughly 20 req/1s,
// 100 req/2min). A single live-game lookup can fan out to ~20 calls (one
// per participant for account + league lookups), so every Riot call is
// funneled through this small concurrency cap instead of firing 20 at once.
function createLimiter(max) {
  let active = 0;
  const queue = [];
  function runNext() {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active--;
        runNext();
      });
  }
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
}

const limitRiotCall = createLimiter(MAX_CONCURRENT_RIOT_CALLS);

class RiotApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function riotFetch(url) {
  return limitRiotCall(async () => {
    const response = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new RiotApiError(
        response.status,
        `Riot API ${response.status} ${response.statusText} for ${url}${body ? `: ${body}` : ""}`,
      );
    }
    return response.json();
  });
}

// --- Riot endpoints ------------------------------------------------------
// Regional routing (account-v1, match-v5) vs. platform routing (everything
// else) — see README/.env.example for the region<->platform mapping.

function getAccountByRiotId(gameName, tagLine) {
  return riotFetch(
    `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
}

function getAccountByPuuid(puuid) {
  return riotFetch(
    `https://${REGION}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
  );
}

function getSummonerByPuuid(puuid) {
  return riotFetch(
    `https://${PLATFORM}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
  );
}

function getLeagueEntriesByPuuid(puuid) {
  return riotFetch(
    `https://${PLATFORM}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
  );
}

function getMatchIdsByPuuid(puuid, count) {
  return riotFetch(
    `https://${REGION}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${count}`,
  );
}

function getMatchById(matchId) {
  return riotFetch(`https://${REGION}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
}

function getActiveGameByPuuid(puuid) {
  return riotFetch(
    `https://${PLATFORM}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`,
  );
}

// Data Dragon (no API key needed) — spectator-v5 only gives numeric
// championId, unlike match-v5 which already includes championName.
// Mapping to champ.id (not champ.name): Data Dragon's champion square
// icons are filed under the id string (e.g. "MonkeyKing", "DrMundo"), not
// the display name ("Wukong", "Dr. Mundo") — and match-v5's championName
// is already in this id form, so this keeps championName consistent
// (and icon-URL-able) everywhere in the app, not just for live games.
let championIdToName = {};

async function loadChampionData() {
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((r) => r.json());
  const latest = versions[0];
  const champions = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`,
  ).then((r) => r.json());
  championIdToName = Object.fromEntries(
    Object.values(champions.data).map((champ) => [Number(champ.key), champ.id]),
  );
  console.log(`[SERVER] Loaded ${Object.keys(championIdToName).length} champions from Data Dragon ${latest}`);
}

loadChampionData().catch((error) => console.error("[SERVER] Failed to load Data Dragon champion data:", error));
runMigrations().catch((error) => console.error("[SERVER] Failed to run DB migrations:", error));

// --- Helpers to shape Riot responses into what the frontend expects -----

function toRankInfo(leagueEntry) {
  if (!leagueEntry) return undefined;
  return {
    queueType: leagueEntry.queueType,
    tier: leagueEntry.tier,
    division: leagueEntry.rank,
    leaguePoints: leagueEntry.leaguePoints,
    wins: leagueEntry.wins,
    losses: leagueEntry.losses,
  };
}

function toMatchSummary(matchId, match) {
  const info = match.info;
  return {
    matchId,
    queueType: info.gameMode === "CLASSIC" ? "Ranked/Normal" : info.gameMode,
    durationSeconds: info.gameDuration,
    timestamp: info.gameStartTimestamp,
    participants: info.participants.map((p) => ({
      puuid: p.puuid,
      riotId: { gameName: p.riotIdGameName || p.summonerName || "Unknown", tagLine: p.riotIdTagline || "" },
      championName: p.championName,
      teamId: p.teamId,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      win: p.win,
    })),
  };
}

function summarizeChampions(matches, puuid) {
  const byChampion = new Map();
  for (const match of matches) {
    const self = match.participants.find((p) => p.puuid === puuid);
    if (!self) continue;
    const entry = byChampion.get(self.championName) || { championName: self.championName, gamesPlayed: 0, wins: 0, kdaSum: 0 };
    entry.gamesPlayed += 1;
    entry.wins += self.win ? 1 : 0;
    entry.kdaSum += self.deaths === 0 ? self.kills + self.assists : (self.kills + self.assists) / self.deaths;
    byChampion.set(self.championName, entry);
  }
  return [...byChampion.values()]
    .map((c) => ({ championName: c.championName, gamesPlayed: c.gamesPlayed, wins: c.wins, avgKda: c.kdaSum / c.gamesPlayed }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 3);
}

function summarizeOverall(matches, puuid) {
  let wins = 0;
  let kdaSum = 0;
  let count = 0;
  for (const match of matches) {
    const self = match.participants.find((p) => p.puuid === puuid);
    if (!self) continue;
    count += 1;
    wins += self.win ? 1 : 0;
    kdaSum += self.deaths === 0 ? self.kills + self.assists : (self.kills + self.assists) / self.deaths;
  }
  return {
    winRate: count === 0 ? 0 : Math.round((wins / count) * 100),
    avgKda: count === 0 ? 0 : Number((kdaSum / count).toFixed(1)),
  };
}

// --- Accounts (Discord/Google login + Riot ownership verification) --------

async function upsertUser({ provider, providerUserId, displayName, avatarUrl, email }) {
  const id = `${provider}:${providerUserId}`;
  const { rows } = await pool.query(
    `INSERT INTO users (id, provider, provider_user_id, display_name, avatar_url, email)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (provider, provider_user_id)
     DO UPDATE SET display_name = EXCLUDED.display_name, avatar_url = EXCLUDED.avatar_url, email = EXCLUDED.email
     RETURNING *`,
    [id, provider, providerUserId, displayName, avatarUrl, email],
  );
  return rows[0];
}

async function findUserById(userId) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  return rows[0] ?? null;
}

function toPublicUser(row) {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    riotPuuid: row.riot_puuid,
    riotGameName: row.riot_game_name,
    riotTagLine: row.riot_tag_line,
    riotVerifiedAt: row.riot_verified_at ? new Date(row.riot_verified_at).getTime() : null,
  };
}

// Reviews/votes below should trust the session cookie over whatever a
// client claims once one is available — falls back to the client-supplied
// key for the (still-anonymous) unverified reviewer path.
async function resolveViewerKey(req, suppliedKey) {
  const userId = getUserIdFromRequest(req);
  if (userId) {
    const user = await findUserById(userId);
    if (user?.riot_puuid) return user.riot_puuid;
  }
  return suppliedKey || "";
}

app.get("/api/auth/discord", (_req, res) => {
  if (!authProviders.discord.configured) return res.status(503).send("Discord sign-in isn't configured yet.");
  const state = randomState();
  setOAuthState(res, state);
  res.redirect(discordAuthorizeUrl(state));
});

app.get("/api/auth/discord/callback", async (req, res) => {
  const expectedState = getOAuthStateFromRequest(req);
  clearOAuthState(res);
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== expectedState) {
      return res.redirect(`${FRONTEND_URL}/?authError=discord`);
    }
    const token = await exchangeDiscordCode(code);
    const discordUser = await fetchDiscordUser(token.access_token);
    const user = await upsertUser({
      provider: "discord",
      providerUserId: discordUser.id,
      displayName: discordUser.displayName,
      avatarUrl: discordUser.avatarUrl,
      email: discordUser.email,
    });
    setSessionCookie(res, user.id);
    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (error) {
    console.error("[AUTH] Discord callback failed:", error);
    res.redirect(`${FRONTEND_URL}/?authError=discord`);
  }
});

app.get("/api/auth/google", (_req, res) => {
  if (!authProviders.google.configured) return res.status(503).send("Google sign-in isn't configured yet.");
  const state = randomState();
  setOAuthState(res, state);
  res.redirect(googleAuthorizeUrl(state));
});

app.get("/api/auth/google/callback", async (req, res) => {
  const expectedState = getOAuthStateFromRequest(req);
  clearOAuthState(res);
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== expectedState) {
      return res.redirect(`${FRONTEND_URL}/?authError=google`);
    }
    const token = await exchangeGoogleCode(code);
    const googleUser = await fetchGoogleUser(token.access_token);
    const user = await upsertUser({
      provider: "google",
      providerUserId: googleUser.id,
      displayName: googleUser.displayName,
      avatarUrl: googleUser.avatarUrl,
      email: googleUser.email,
    });
    setSessionCookie(res, user.id);
    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (error) {
    console.error("[AUTH] Google callback failed:", error);
    res.redirect(`${FRONTEND_URL}/?authError=google`);
  }
});

app.get("/api/auth/me", async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.json({ user: null });
  const user = await findUserById(userId);
  res.json({ user: user ? toPublicUser(user) : null });
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Profile-icon ownership challenge (see README for the full flow). Riot
// deprecated the old in-client "third-party verification code" endpoint,
// so this is the standard replacement most third-party sites use: prove
// you control the account by briefly switching its summoner icon to a
// specific one we pick, which only the real account owner can do.
app.post("/api/verify/start", requireAuth, async (req, res) => {
  if (!RIOT_API_KEY) return res.status(500).json({ error: "Server not configured with RIOT_API_KEY." });
  const { gameName, tagLine } = req.body || {};
  if (!gameName || !tagLine) return res.status(400).json({ error: "gameName and tagLine are required." });

  try {
    const account = await getAccountByRiotId(gameName, tagLine);

    // Check upfront whether this Riot account is already claimed —
    // otherwise someone would go through the entire icon-switching flow
    // only to be rejected at the very end (see the UNIQUE constraint on
    // users.riot_puuid, enforced again below as a backstop against races).
    const { rows: existingRows } = await pool.query("SELECT id FROM users WHERE riot_puuid = $1", [account.puuid]);
    const existingOwner = existingRows[0];
    if (existingOwner) {
      return res.status(409).json({
        error:
          existingOwner.id === req.userId
            ? "You've already verified this Riot account."
            : "This Riot account is already verified and linked to a different login.",
      });
    }

    const summoner = await getSummonerByPuuid(account.puuid);
    // Exclude their current icon so the challenge always requires an
    // actual change — otherwise a bystander who happens to already have
    // that icon set would trivially "pass" without doing anything.
    const candidates = ICON_CHALLENGE_POOL.filter((iconId) => iconId !== summoner.profileIconId);
    const challengeIconId = candidates[Math.floor(Math.random() * candidates.length)];
    const expiresAt = new Date(Date.now() + ICON_CHALLENGE_WINDOW_MS);

    await pool.query(
      `INSERT INTO icon_verification_challenges (user_id, puuid, game_name, tag_line, challenge_icon_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         puuid = EXCLUDED.puuid, game_name = EXCLUDED.game_name, tag_line = EXCLUDED.tag_line,
         challenge_icon_id = EXCLUDED.challenge_icon_id, expires_at = EXCLUDED.expires_at`,
      [req.userId, account.puuid, account.gameName, account.tagLine, challengeIconId, expiresAt],
    );

    res.json({
      puuid: account.puuid,
      riotId: { gameName: account.gameName, tagLine: account.tagLine },
      challengeIconId,
      expiresAt: expiresAt.getTime(),
    });
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

app.post("/api/verify/check", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM icon_verification_challenges WHERE user_id = $1", [req.userId]);
    const challenge = rows[0];
    if (!challenge) return res.status(400).json({ error: "No active verification challenge — start a new one." });
    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await pool.query("DELETE FROM icon_verification_challenges WHERE user_id = $1", [req.userId]);
      return res.status(400).json({ error: "That challenge expired — start a new one." });
    }

    const summoner = await getSummonerByPuuid(challenge.puuid);
    if (summoner.profileIconId !== challenge.challenge_icon_id) {
      // Temporary diagnostic — remove once icon verification is confirmed
      // reliable in production. Not sensitive: puuid is already the
      // reviewer's own public identity, and icon ids are just integers.
      console.log(
        `[VERIFY] Icon mismatch for user ${req.userId} (puuid ${challenge.puuid}): expected ${challenge.challenge_icon_id} (${typeof challenge.challenge_icon_id}), got ${summoner.profileIconId} (${typeof summoner.profileIconId})`,
      );
      return res.json({ verified: false });
    }

    await pool.query("DELETE FROM icon_verification_challenges WHERE user_id = $1", [req.userId]);
    try {
      await pool.query(
        `UPDATE users SET riot_puuid = $1, riot_game_name = $2, riot_tag_line = $3, riot_verified_at = now()
         WHERE id = $4`,
        [challenge.puuid, challenge.game_name, challenge.tag_line, req.userId],
      );
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "That Riot account is already linked to a different login." });
      }
      throw error;
    }

    res.json({ verified: true, riotId: { gameName: challenge.game_name, tagLine: challenge.tag_line } });
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

// Every non-deleted unverified review claiming this now-verified user's
// exact puuid, across every target — shown right after verification so
// they can reclaim reviews that are genuinely theirs (written before they
// verified) and reject ones that aren't (someone else's impersonation).
app.get("/api/verify/unverified-reviews", requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user?.riot_puuid) {
      return res.status(400).json({ error: "Complete Riot account verification first." });
    }

    const { rows } = await pool.query(
      `SELECT * FROM reviews
       WHERE reviewer_kind = 'unverified' AND reviewer_claimed_puuid = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [user.riot_puuid],
    );

    const candidates = await Promise.all(
      rows.map(async (row) => {
        const account = await getAccountByPuuid(row.target_puuid).catch(() => null);
        return {
          id: row.id,
          targetRiotId: account ? { gameName: account.gameName, tagLine: account.tagLine } : null,
          displayName: row.reviewer_display_name,
          body: row.body,
          scores: {
            mapAwareness: row.map_awareness,
            mechanicalSkill: row.mechanical_skill,
            teamwork: row.teamwork,
            communication: row.communication,
            sportsmanship: row.sportsmanship,
          },
          sharedGamesWithTarget: row.shared_games_with_target,
          createdAt: new Date(row.created_at).getTime(),
        };
      }),
    );

    res.json(candidates);
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

// Body: { confirmedReviewIds: string[] }. Re-derives the true candidate set
// itself (same query as above) rather than trusting the client's list
// beyond *which* of those real candidates got confirmed — a confirmed one
// converts to verified in place (votes/id/created_at kept, prior state
// archived like any other edit); anything else in the candidate set that
// wasn't confirmed is understood as "not mine" and soft-deleted, per the
// explicit confirm-by-exception design (see components/ReconcileReviewsModal).
app.post("/api/verify/reconcile-reviews", requireAuth, async (req, res) => {
  const { confirmedReviewIds } = req.body || {};
  if (!Array.isArray(confirmedReviewIds)) {
    return res.status(400).json({ error: "confirmedReviewIds must be an array." });
  }

  try {
    const user = await findUserById(req.userId);
    if (!user?.riot_puuid) {
      return res.status(400).json({ error: "Complete Riot account verification first." });
    }

    const { rows: candidates } = await pool.query(
      `SELECT * FROM reviews
       WHERE reviewer_kind = 'unverified' AND reviewer_claimed_puuid = $1 AND deleted_at IS NULL`,
      [user.riot_puuid],
    );

    const confirmedSet = new Set(confirmedReviewIds.filter((id) => typeof id === "string"));
    let confirmed = 0;
    let rejected = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      if (!confirmedSet.has(candidate.id)) {
        await pool.query("UPDATE reviews SET deleted_at = now() WHERE id = $1", [candidate.id]);
        rejected += 1;
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await archiveReviewVersion(client, candidate);
        await client.query(
          `UPDATE reviews SET
             reviewer_kind = 'verified', reviewer_key = $1, reviewer_game_name = $2, reviewer_tag_line = $3,
             reviewer_display_name = NULL, reviewer_claimed_puuid = NULL, edited_at = now()
           WHERE id = $4`,
          [user.riot_puuid, user.riot_game_name, user.riot_tag_line, candidate.id],
        );
        await client.query("COMMIT");
        confirmed += 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        // A genuine conflict (this user already has a separate verified
        // review of the same target, e.g. from the override path) — skip
        // it rather than failing the whole batch.
        if (error.code === "23505") {
          skipped += 1;
        } else {
          throw error;
        }
      } finally {
        client.release();
      }
    }

    res.json({ confirmed, rejected, skipped });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to reconcile reviews." });
  }
});

// --- Reviews (our data, never Riot's) -------------------------------------

// `voterKey` is the requester's own identity (puuid if signed in, otherwise
// their per-browser unverified cookie id) — used to compute `isMine` and
// `myVote` per row without ever exposing *other* people's reviewer_key or
// who voted on what. See db.js for the schema/dedup rationale.
function rowToReview(row) {
  return {
    id: row.id,
    targetPuuid: row.target_puuid,
    reviewer:
      row.reviewer_kind === "verified"
        ? {
            kind: "verified",
            puuid: row.reviewer_key,
            riotId: { gameName: row.reviewer_game_name, tagLine: row.reviewer_tag_line },
            anonymous: row.reviewer_anonymous,
          }
        : { kind: "unverified", unverifiedId: row.reviewer_key, displayName: row.reviewer_display_name },
    scores: {
      mapAwareness: row.map_awareness,
      mechanicalSkill: row.mechanical_skill,
      teamwork: row.teamwork,
      communication: row.communication,
      sportsmanship: row.sportsmanship,
    },
    body: row.body,
    createdAt: new Date(row.created_at).getTime(),
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : null,
    upvotes: Number(row.upvotes ?? 0),
    downvotes: Number(row.downvotes ?? 0),
    sharedGamesWithTarget: row.shared_games_with_target,
    myVote: row.my_vote ?? null,
    isMine: row.is_mine ?? false,
  };
}

function historyRowToEntry(row) {
  return {
    id: row.id,
    reviewer:
      row.reviewer_kind === "verified"
        ? { kind: "verified", riotId: { gameName: row.reviewer_game_name, tagLine: row.reviewer_tag_line } }
        : { kind: "unverified", displayName: row.reviewer_display_name },
    scores: {
      mapAwareness: row.map_awareness,
      mechanicalSkill: row.mechanical_skill,
      teamwork: row.teamwork,
      communication: row.communication,
      sportsmanship: row.sportsmanship,
    },
    body: row.body,
    sharedGamesWithTarget: row.shared_games_with_target,
    archivedAt: new Date(row.archived_at).getTime(),
  };
}

// Snapshots a review's current reviewer-facing state into review_edit_history
// before an edit or override overwrites it — shared by PUT /api/reviews/:id
// and the impersonation-override path in POST /api/reviews.
async function archiveReviewVersion(client, reviewRow) {
  await client.query(
    `INSERT INTO review_edit_history (
       id, review_id, reviewer_kind, reviewer_key, reviewer_game_name, reviewer_tag_line,
       reviewer_display_name, body, map_awareness, mechanical_skill, teamwork,
       communication, sportsmanship, shared_games_with_target
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      `hist-${crypto.randomUUID()}`,
      reviewRow.id,
      reviewRow.reviewer_kind,
      reviewRow.reviewer_key,
      reviewRow.reviewer_game_name,
      reviewRow.reviewer_tag_line,
      reviewRow.reviewer_display_name,
      reviewRow.body,
      reviewRow.map_awareness,
      reviewRow.mechanical_skill,
      reviewRow.teamwork,
      reviewRow.communication,
      reviewRow.sportsmanship,
      reviewRow.shared_games_with_target,
    ],
  );
}

async function queryReviews(targetPuuids, voterKey) {
  const { rows } = await pool.query(
    `SELECT r.*,
       COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
       COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes,
       MAX(CASE WHEN v.voter_key = $2 THEN v.value END) AS my_vote,
       (r.reviewer_key = $2) AS is_mine
     FROM reviews r
     LEFT JOIN review_votes v ON v.review_id = r.id
     WHERE r.target_puuid = ANY($1::text[]) AND r.deleted_at IS NULL
     GROUP BY r.id
     ORDER BY r.created_at DESC`,
    [targetPuuids, voterKey ?? ""],
  );
  return rows;
}

// --- Routes ---------------------------------------------------------------

app.get("/api/status", (_req, res) => {
  res.json({
    hasApiKey: !!RIOT_API_KEY,
    platform: PLATFORM,
    region: REGION,
    discordAuth: authProviders.discord.configured,
    googleAuth: authProviders.google.configured,
  });
});

// Resolves a Riot ID to its account + puuid. Used by the unverified review
// flow (to look up a typed reviewer Riot ID for eligibility) — the signed-
// in path resolves its own Riot ID server-side as part of icon
// verification (see POST /api/verify/start) instead of calling this.
app.get("/api/account/:gameName/:tagLine", async (req, res) => {
  if (!RIOT_API_KEY) return res.status(500).json({ error: "Server not configured with RIOT_API_KEY." });
  try {
    const account = await getAccountByRiotId(req.params.gameName, req.params.tagLine);
    res.json({ puuid: account.puuid, riotId: { gameName: account.gameName, tagLine: account.tagLine } });
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

// Full profile + recent match history for a Riot ID. Powers the player
// profile page and (by passing the signed-in user's own Riot ID) the
// dashboard's "your most recent match" card.
app.get("/api/profile/:gameName/:tagLine", async (req, res) => {
  if (!RIOT_API_KEY) return res.status(500).json({ error: "Server not configured with RIOT_API_KEY." });
  try {
    const account = await getAccountByRiotId(req.params.gameName, req.params.tagLine);
    const puuid = account.puuid;

    const [summoner, leagueEntries, matchIds] = await Promise.all([
      getSummonerByPuuid(puuid),
      getLeagueEntriesByPuuid(puuid).catch(() => []),
      getMatchIdsByPuuid(puuid, MAX_RECENT_MATCHES).catch(() => []),
    ]);

    const rawMatches = await Promise.all(
      matchIds.map((matchId) => getMatchById(matchId).then((match) => toMatchSummary(matchId, match)).catch(() => null)),
    );
    const matches = rawMatches.filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);

    const soloEntry = leagueEntries.find((entry) => entry.queueType === "RANKED_SOLO_5x5");
    const overall = summarizeOverall(matches, puuid);

    res.json({
      profile: {
        puuid,
        riotId: { gameName: account.gameName, tagLine: account.tagLine },
        region: PLATFORM,
        profileIconId: summoner.profileIconId,
        summonerLevel: summoner.summonerLevel,
        soloRank: toRankInfo(soloEntry),
        winRate: overall.winRate,
        avgKda: overall.avgKda,
        topChampions: summarizeChampions(matches, puuid),
        isLive: false, // resolved separately via /api/live, not bundled here to avoid an extra spectator call on every profile view
      },
      matches,
    });
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

// Live (in-progress) game for a Riot ID, enriched with rank per
// participant. Returns `{ live: false }` (not an error) when the player
// isn't currently in a game — spectator-v5 itself 404s for that case.
app.get("/api/live/:gameName/:tagLine", async (req, res) => {
  if (!RIOT_API_KEY) return res.status(500).json({ error: "Server not configured with RIOT_API_KEY." });
  try {
    const account = await getAccountByRiotId(req.params.gameName, req.params.tagLine);
    const activeGame = await getActiveGameByPuuid(account.puuid).catch((error) => {
      if (error instanceof RiotApiError && error.status === 404) return null;
      throw error;
    });

    if (!activeGame) {
      return res.json({ live: false });
    }

    const participants = await Promise.all(
      activeGame.participants.map(async (p) => {
        // Streamer Mode (Patch 25.20+) makes Riot scrub identity for that
        // participant — account-v1 by-puuid 403/404s for them. Surface that
        // as a `hidden` row instead of letting the whole request fail.
        const [accountResult, leagueResult] = await Promise.all([
          getAccountByPuuid(p.puuid).catch(() => null),
          getLeagueEntriesByPuuid(p.puuid).catch(() => []),
        ]);

        const soloEntry = leagueResult.find?.((entry) => entry.queueType === "RANKED_SOLO_5x5");

        if (!accountResult) {
          return { puuid: p.puuid, riotId: { gameName: "Hidden", tagLine: "????" }, championName: championIdToName[p.championId] || `Champion ${p.championId}`, teamId: p.teamId, winRate: 0, topChampions: [], hidden: true };
        }

        return {
          puuid: p.puuid,
          riotId: { gameName: accountResult.gameName, tagLine: accountResult.tagLine },
          championName: championIdToName[p.championId] || `Champion ${p.championId}`,
          teamId: p.teamId,
          soloRank: toRankInfo(soloEntry),
          winRate: soloEntry ? Math.round((soloEntry.wins / Math.max(1, soloEntry.wins + soloEntry.losses)) * 100) : 0,
          topChampions: [],
        };
      }),
    );

    res.json({
      live: true,
      game: {
        gameId: String(activeGame.gameId),
        queueType: activeGame.gameMode,
        gameStartTimestamp: activeGame.gameStartTime,
        participants,
      },
    });
  } catch (error) {
    respondWithRiotError(res, error);
  }
});

// Batch form for the dashboard (teammates from your last match) and the
// live game page (everyone in the lobby) — avoids one request per player.
// Registered before /api/reviews/:targetPuuid: Express matches routes in
// registration order, and the param route would otherwise swallow
// "/api/reviews/batch" by treating "batch" as a targetPuuid value.
app.get("/api/reviews/batch", async (req, res) => {
  const puuids = String(req.query.puuids || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (puuids.length === 0) return res.json({});

  try {
    const voterKey = await resolveViewerKey(req, req.query.voterKey);
    const rows = await queryReviews(puuids, voterKey);
    const byTarget = {};
    for (const puuid of puuids) byTarget[puuid] = [];
    for (const row of rows) {
      byTarget[row.target_puuid] ??= [];
      byTarget[row.target_puuid].push(rowToReview(row));
    }
    res.json(byTarget);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load reviews." });
  }
});

// List reviews for one target, e.g. the profile page.
app.get("/api/reviews/:targetPuuid", async (req, res) => {
  try {
    const voterKey = await resolveViewerKey(req, req.query.voterKey);
    const rows = await queryReviews([req.params.targetPuuid], voterKey);
    res.json(rows.map(rowToReview));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load reviews." });
  }
});

// A verified reviewer never has to wait out this cooldown (they've already
// cleared a much higher bar: real OAuth login + proven Riot ownership).
// This exists specifically for the unverified path, where the only cost of
// spamming many different targets is knowing (or scraping, since teammate
// names are public) a real Riot ID from each match — the claimed-puuid
// system below stops re-claiming *one* identity, but says nothing about
// submission volume.
const UNVERIFIED_SUBMIT_COOLDOWN_MS = 2 * 60 * 1000;

app.post("/api/reviews", async (req, res) => {
  const {
    id,
    targetPuuid,
    reviewerKind,
    reviewerAnonymous,
    reviewerDisplayName,
    reviewerClaimedPuuid,
    scores,
    body,
    sharedGamesWithTarget,
  } = req.body || {};

  // Star ratings are optional (see db.js) — only the written body is
  // required. `scores` itself may be omitted entirely; any category left
  // out is stored as NULL.
  if (!id || !targetPuuid || !reviewerKind || !body || !body.trim()) {
    return res.status(400).json({ error: "Missing required review fields." });
  }

  // The "verified" identity is never taken from the client — it's derived
  // from the session cookie, so nobody can post as verified just by
  // sending the right JSON. Requires both a real login *and* a completed
  // icon-ownership challenge (riot_puuid set); logged in without that
  // yet isn't enough. Unverified reviewers keep supplying their own
  // per-browser cookie id, same as before — that path was never claiming
  // real identity to begin with.
  let reviewerKey;
  let reviewerGameName = null;
  let reviewerTagLine = null;
  let anonymous = false;
  let claimedPuuid = null;

  if (reviewerKind === "verified") {
    const userId = getUserIdFromRequest(req);
    const user = userId ? await findUserById(userId) : null;
    if (!user || !user.riot_puuid) {
      return res.status(403).json({ error: "Sign in and complete Riot account verification before posting as verified." });
    }
    reviewerKey = user.riot_puuid;
    reviewerGameName = user.riot_game_name;
    reviewerTagLine = user.riot_tag_line;
    anonymous = !!reviewerAnonymous;
  } else if (reviewerKind === "unverified") {
    reviewerKey = req.body?.reviewerKey;
    if (!reviewerKey) return res.status(400).json({ error: "Missing reviewerKey." });
    claimedPuuid = reviewerClaimedPuuid || null;
  } else {
    return res.status(400).json({ error: "Invalid reviewerKind." });
  }

  const s = scores || {};

  try {
    // Own prior review of this target already exists (whether from before
    // or via a fresh identity) — editing is the path for that now, not a
    // second row. Checked explicitly (rather than just letting the unique
    // constraint 23505) so the error message can point at the right fix.
    const { rows: ownRows } = await pool.query(
      "SELECT id FROM reviews WHERE target_puuid = $1 AND reviewer_key = $2 AND deleted_at IS NULL",
      [targetPuuid, reviewerKey],
    );
    if (ownRows[0]) {
      return res.status(409).json({ error: "You've already reviewed this player — edit your existing review instead." });
    }

    // Impersonation-correction path: a verified reviewer's real identity
    // matches what an existing *unverified* review of this same target
    // claimed to be — very possibly someone else typing their Riot ID to
    // pass the eligibility check. The real owner's submission replaces it
    // in place (content + authorship), keeping the row's id/votes/
    // created_at, rather than existing alongside a fraudulent duplicate.
    if (reviewerKind === "verified") {
      const { rows: claimRows } = await pool.query(
        `SELECT * FROM reviews
         WHERE target_puuid = $1 AND reviewer_kind = 'unverified' AND reviewer_claimed_puuid = $2 AND deleted_at IS NULL`,
        [targetPuuid, reviewerKey],
      );
      const claimed = claimRows[0];
      if (claimed) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await archiveReviewVersion(client, claimed);
          const { rows } = await client.query(
            `UPDATE reviews SET
               reviewer_kind = 'verified', reviewer_key = $1, reviewer_game_name = $2, reviewer_tag_line = $3,
               reviewer_anonymous = $4, reviewer_display_name = NULL, reviewer_claimed_puuid = NULL,
               body = $5, map_awareness = $6, mechanical_skill = $7, teamwork = $8, communication = $9,
               sportsmanship = $10, shared_games_with_target = $11, edited_at = now()
             WHERE id = $12
             RETURNING *`,
            [
              reviewerKey,
              reviewerGameName,
              reviewerTagLine,
              anonymous,
              body,
              s.mapAwareness ?? null,
              s.mechanicalSkill ?? null,
              s.teamwork ?? null,
              s.communication ?? null,
              s.sportsmanship ?? null,
              sharedGamesWithTarget ?? 0,
              claimed.id,
            ],
          );
          await client.query("COMMIT");
          return res.status(200).json({
            ...rowToReview({ ...rows[0], upvotes: 0, downvotes: 0, my_vote: null, is_mine: true }),
            overrodeExistingReview: true,
          });
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      }
    }

    if (reviewerKind === "unverified") {
      const { rows: recentRows } = await pool.query(
        "SELECT created_at FROM reviews WHERE reviewer_key = $1 ORDER BY created_at DESC LIMIT 1",
        [reviewerKey],
      );
      const last = recentRows[0];
      if (last && Date.now() - new Date(last.created_at).getTime() < UNVERIFIED_SUBMIT_COOLDOWN_MS) {
        return res.status(429).json({ error: "You're submitting reviews too quickly — please wait a bit and try again." });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO reviews (
         id, target_puuid, reviewer_key, reviewer_kind, reviewer_game_name, reviewer_tag_line,
         reviewer_anonymous, reviewer_display_name, reviewer_claimed_puuid, map_awareness, mechanical_skill,
         teamwork, communication, sportsmanship, body, shared_games_with_target
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        id,
        targetPuuid,
        reviewerKey,
        reviewerKind,
        reviewerGameName,
        reviewerTagLine,
        anonymous,
        reviewerKind === "unverified" ? (reviewerDisplayName ?? null) : null,
        claimedPuuid,
        s.mapAwareness ?? null,
        s.mechanicalSkill ?? null,
        s.teamwork ?? null,
        s.communication ?? null,
        s.sportsmanship ?? null,
        body,
        sharedGamesWithTarget ?? 0,
      ],
    );
    res.status(201).json(rowToReview({ ...rows[0], upvotes: 0, downvotes: 0, my_vote: null, is_mine: true }));
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error:
          error.constraint === "reviews_unverified_claimed_puuid_idx"
            ? "Someone claiming this same Riot ID has already reviewed this player."
            : "You've already reviewed this player.",
      });
    }
    console.error(error);
    res.status(500).json({ error: "Failed to save review." });
  }
});

// Edits the reviewer's own review in place rather than creating a second
// row — the (target_puuid, reviewer_key) unique constraint stays a real
// "one review per pair" rule, it just becomes updatable instead of
// permanent. The prior state is archived to review_edit_history first so
// "view previous version" has something to show.
app.put("/api/reviews/:id", async (req, res) => {
  const { scores, body, sharedGamesWithTarget, reviewerAnonymous } = req.body || {};
  if (!body || !body.trim()) {
    return res.status(400).json({ error: "Review body is required." });
  }

  const voterKey = await resolveViewerKey(req, req.body?.reviewerKey);
  if (!voterKey) return res.status(400).json({ error: "Missing reviewerKey." });

  const s = scores || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      "SELECT * FROM reviews WHERE id = $1 AND reviewer_key = $2 AND deleted_at IS NULL FOR UPDATE",
      [req.params.id, voterKey],
    );
    const existing = existingRows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Review not found, deleted, or not yours to edit." });
    }

    await archiveReviewVersion(client, existing);

    const { rows } = await client.query(
      `UPDATE reviews SET
         body = $1, map_awareness = $2, mechanical_skill = $3, teamwork = $4,
         communication = $5, sportsmanship = $6, shared_games_with_target = $7,
         reviewer_anonymous = CASE WHEN reviewer_kind = 'verified' THEN $8 ELSE reviewer_anonymous END,
         edited_at = now()
       WHERE id = $9
       RETURNING *`,
      [
        body,
        s.mapAwareness ?? null,
        s.mechanicalSkill ?? null,
        s.teamwork ?? null,
        s.communication ?? null,
        s.sportsmanship ?? null,
        sharedGamesWithTarget ?? existing.shared_games_with_target,
        !!reviewerAnonymous,
        req.params.id,
      ],
    );

    await client.query("COMMIT");

    const { rows: voteRows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
         COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes,
         MAX(CASE WHEN voter_key = $2 THEN value END) AS my_vote
       FROM review_votes WHERE review_id = $1`,
      [req.params.id, voterKey],
    );

    res.json(rowToReview({ ...rows[0], ...voteRows[0], is_mine: true }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error);
    res.status(500).json({ error: "Failed to update review." });
  } finally {
    client.release();
  }
});

// Public (like reviews themselves) — lets anyone viewing a review see it's
// been edited and what it used to say, not just the reviewer.
app.get("/api/reviews/:id/history", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM review_edit_history WHERE review_id = $1 ORDER BY archived_at DESC",
      [req.params.id],
    );
    res.json(rows.map(historyRowToEntry));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load review history." });
  }
});

app.post("/api/reviews/:id/vote", async (req, res) => {
  const { value } = req.body || {};
  const voterKey = await resolveViewerKey(req, req.body?.voterKey);
  if (!voterKey) return res.status(400).json({ error: "Missing voterKey." });
  if (value !== 1 && value !== -1 && value !== null) {
    return res.status(400).json({ error: "value must be 1, -1, or null." });
  }

  try {
    if (value === null) {
      await pool.query("DELETE FROM review_votes WHERE review_id = $1 AND voter_key = $2", [req.params.id, voterKey]);
    } else {
      await pool.query(
        `INSERT INTO review_votes (review_id, voter_key, value) VALUES ($1, $2, $3)
         ON CONFLICT (review_id, voter_key) DO UPDATE SET value = EXCLUDED.value, created_at = now()`,
        [req.params.id, voterKey, value],
      );
    }

    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
         COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
       FROM review_votes WHERE review_id = $1`,
      [req.params.id],
    );
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save vote." });
  }
});

// Soft delete — the row stays (and review_votes stays untouched via FK),
// just hidden from every read path via queryReviews's `deleted_at IS NULL`
// filter. Ownership is checked the same way "isMine" is computed for reads:
// the requester's resolved identity (session puuid if verified, else the
// client-supplied unverified cookie id) must equal the row's reviewer_key.
app.delete("/api/reviews/:id", async (req, res) => {
  const voterKey = await resolveViewerKey(req, req.body?.reviewerKey ?? req.query.reviewerKey);
  if (!voterKey) return res.status(400).json({ error: "Missing reviewerKey." });

  try {
    const { rows } = await pool.query(
      `UPDATE reviews SET deleted_at = now()
       WHERE id = $1 AND reviewer_key = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, voterKey],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Review not found, already deleted, or not yours to delete." });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete review." });
  }
});

function respondWithRiotError(res, error) {
  if (error instanceof RiotApiError) {
    res.status(error.status >= 400 && error.status < 500 ? error.status : 502).json({ error: error.message });
    return;
  }
  console.error(error);
  res.status(502).json({ error: error instanceof Error ? error.message : "Unexpected error" });
}

const PORT = process.env.PORT || 51791;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
