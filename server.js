import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool, runMigrations } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const PLATFORM = process.env.RIOT_PLATFORM || "na1";
const MAX_RECENT_MATCHES = 10;
const MAX_CONCURRENT_RIOT_CALLS = 5;

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
    upvotes: Number(row.upvotes ?? 0),
    downvotes: Number(row.downvotes ?? 0),
    sharedGamesWithTarget: row.shared_games_with_target,
    myVote: row.my_vote ?? null,
    isMine: row.is_mine ?? false,
  };
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
     WHERE r.target_puuid = ANY($1::text[])
     GROUP BY r.id
     ORDER BY r.created_at DESC`,
    [targetPuuids, voterKey ?? ""],
  );
  return rows;
}

// --- Routes ---------------------------------------------------------------

app.get("/api/status", (_req, res) => {
  res.json({ hasApiKey: !!RIOT_API_KEY, platform: PLATFORM, region: REGION });
});

// Resolves a Riot ID to its account + puuid. Used by the frontend both for
// the "sign in with your Riot ID" mock-auth prompt and the unverified
// review flow (to look up a typed reviewer Riot ID for eligibility).
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
    const rows = await queryReviews(puuids, req.query.voterKey);
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
    const rows = await queryReviews([req.params.targetPuuid], req.query.voterKey);
    res.json(rows.map(rowToReview));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load reviews." });
  }
});

app.post("/api/reviews", async (req, res) => {
  const {
    id,
    targetPuuid,
    reviewerKey,
    reviewerKind,
    reviewerGameName,
    reviewerTagLine,
    reviewerAnonymous,
    reviewerDisplayName,
    scores,
    body,
    sharedGamesWithTarget,
  } = req.body || {};

  if (!id || !targetPuuid || !reviewerKey || !reviewerKind || !scores || !body) {
    return res.status(400).json({ error: "Missing required review fields." });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews (
         id, target_puuid, reviewer_key, reviewer_kind, reviewer_game_name, reviewer_tag_line,
         reviewer_anonymous, reviewer_display_name, map_awareness, mechanical_skill, teamwork,
         communication, sportsmanship, body, shared_games_with_target
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        id,
        targetPuuid,
        reviewerKey,
        reviewerKind,
        reviewerGameName ?? null,
        reviewerTagLine ?? null,
        !!reviewerAnonymous,
        reviewerDisplayName ?? null,
        scores.mapAwareness,
        scores.mechanicalSkill,
        scores.teamwork,
        scores.communication,
        scores.sportsmanship,
        body,
        sharedGamesWithTarget ?? 0,
      ],
    );
    res.status(201).json(rowToReview({ ...rows[0], upvotes: 0, downvotes: 0, my_vote: null, is_mine: true }));
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "You've already reviewed this player." });
    }
    console.error(error);
    res.status(500).json({ error: "Failed to save review." });
  }
});

app.post("/api/reviews/:id/vote", async (req, res) => {
  const { voterKey, value } = req.body || {};
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
