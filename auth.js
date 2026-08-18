import crypto from "node:crypto";
import dotenv from "dotenv";

// ESM static imports are hoisted before server.js's own dotenv.config()
// call runs (same reasoning as db.js) — this module needs to load its own
// env vars since the OAuth config below reads process.env at import time.
dotenv.config();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 51791}`;
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5174";

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

// --- Provider config --------------------------------------------------
// Each provider is "configured" only once both its client id and secret
// are set. GET /api/status reports this so the frontend can hide a
// provider's sign-in button entirely rather than offering a login that'll
// just fail — lets Discord and Google be wired up independently/gradually.

export const authProviders = {
  discord: {
    configured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
    redirectUri: `${BACKEND_URL}/api/auth/discord/callback`,
  },
  google: {
    configured: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    redirectUri: `${BACKEND_URL}/api/auth/google/callback`,
  },
};

export function discordAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: authProviders.discord.redirectUri,
    response_type: "code",
    scope: "identify",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

export async function exchangeDiscordCode(code) {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: authProviders.discord.redirectUri,
  });
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) throw new Error(`Discord token exchange failed: ${response.status}`);
  return response.json();
}

export async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Discord user fetch failed: ${response.status}`);
  const data = await response.json();
  const avatarUrl = data.avatar
    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${data.avatar.startsWith("a_") ? "gif" : "png"}`
    : null;
  return { id: data.id, displayName: data.global_name || data.username, avatarUrl, email: data.email ?? null };
}

export function googleAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: authProviders.google.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: authProviders.google.redirectUri,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`);
  return response.json();
}

export async function fetchGoogleUser(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google user fetch failed: ${response.status}`);
  const data = await response.json();
  return { id: data.sub, displayName: data.name || data.email, avatarUrl: data.picture ?? null, email: data.email ?? null };
}

// --- Session cookie -----------------------------------------------------
// Hand-rolled signed cookie (base64url payload + HMAC-SHA256 signature)
// instead of a sessions table or a jsonwebtoken/express-session dependency
// — Render runs this as a single long-lived process, not serverless, so a
// stateless signed cookie is simplest and there's no store to keep in sync.
// The cookie only holds the user id; everything else (riot_puuid etc.) is
// looked up fresh from the DB per request, so completing icon verification
// takes effect immediately without needing to reissue the cookie.

const SESSION_COOKIE = "lolmate_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_COOKIE = "lolmate_oauth_state";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function requireSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET in environment.");
  return secret;
}

function sign(payload) {
  return crypto.createHmac("sha256", requireSecret()).update(payload).digest("base64url");
}

function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_MAX_AGE_MS })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }

  const actual = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length || !crypto.timingSafeEqual(actual, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

// Vercel (frontend) and Render (backend) are different domains in
// production, so the session cookie is cross-site there and needs
// SameSite=None; Secure. In dev, the frontend calls /api/* through Vite's
// proxy (see vite.config.ts), which makes those fetches same-origin from
// the browser's perspective — but the OAuth start/callback are full page
// navigations straight to the backend's own port, so dev cookies still
// need to work cross-port; SameSite=Lax over http is what allows that
// without requiring HTTPS locally.
function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: isProduction() ? "none" : "lax",
    maxAge: maxAgeMs,
    path: "/",
  };
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, createSessionToken(userId), cookieOptions(SESSION_MAX_AGE_MS));
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(0));
}

// Returns the logged-in user's id, or null if there's no valid session.
export function getUserIdFromRequest(req) {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

// Express middleware — 401s before the route handler runs if not signed in.
export function requireAuth(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: "Sign in first." });
  req.userId = userId;
  next();
}

// --- OAuth CSRF state -----------------------------------------------------
// A random value round-tripped through the provider's redirect_uri and
// compared against this cookie on callback, so a forged callback request
// (missing the cookie a real redirect would carry) gets rejected.

export function randomState() {
  return crypto.randomBytes(16).toString("hex");
}

export function setOAuthState(res, state) {
  res.cookie(OAUTH_STATE_COOKIE, state, cookieOptions(OAUTH_STATE_MAX_AGE_MS));
}

export function getOAuthStateFromRequest(req) {
  return readCookie(req, OAUTH_STATE_COOKIE);
}

export function clearOAuthState(res) {
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions(0));
}
