// Origami Command Center — Netlify Identity edge gate (invite-only, STANDALONE).
//
// Individual-account access enforced at the EDGE. This is a single standalone
// site (no media partner): Identity (GoTrue) is enabled here and tokens are
// validated against this site's OWN origin. No cross-domain SSO / no IDENTITY_HOST.
//
// Unauthenticated page loads are REWRITTEN to /login.html (not 302d) so the
// URL #fragment (invite_token / recovery_token / confirmation_token) survives.
//
// The shared cookie is still scoped to Domain=directagents.com when reached via
// a *.directagents.com host, but this site only verifies it against itself.
//
// Env vars:
//   IDENTITY_JWT_SECRET (optional) — verify HS256 locally, no network call
//   DA_REFRESH_KEY      (optional) — server-to-server cron refresh bypass

const COOKIE_NAME = 'nf_jwt';
const LOGIN_PATH = '/login';
const LOGIN_FILE = '/login.html';
const LOGOUT_ACTION = '/__logout';

const PUBLIC_PREFIXES = [
  '/login',
  '/.netlify/identity',
  '/.netlify/functions/trending-export',
  '/email-templates',
];

const PUBLIC_ASSET_RE = /\.(css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|map)$/i;

function isPublicPath(pathname) {
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(p)) return true;
  }
  return PUBLIC_ASSET_RE.test(pathname);
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const aB = enc.encode(a), bB = enc.encode(b);
  if (aB.length !== bB.length) return false;
  let diff = 0;
  for (let i = 0; i < aB.length; i++) diff |= aB[i] ^ bB[i];
  return diff === 0;
}

function isAuthorizedRefresh(request, url, refreshKey) {
  if (!refreshKey) return false;
  if (!(url.pathname.startsWith('/api/') && url.pathname.includes('refresh'))) return false;
  return constantTimeEqual(request.headers.get('x-refresh-key') || '', refreshKey);
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))); }
  catch { return null; }
}

function looksLiveJwt(token) {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  if (payload.exp && payload.exp * 1000 <= Date.now()) return false;
  return true;
}

async function verifyHs256(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    return await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  } catch { return false; }
}

async function verifyViaIdentity(token, origin) {
  try {
    const resp = await fetch(origin + '/.netlify/identity/user', {
      headers: { Authorization: 'Bearer ' + token },
    });
    return resp.ok;
  } catch { return false; }
}

async function isAuthenticated(token, origin) {
  if (!token || !looksLiveJwt(token)) return false;
  const localSecret = Deno.env.get('IDENTITY_JWT_SECRET');
  if (localSecret) return verifyHs256(token, localSecret);
  return verifyViaIdentity(token, origin);
}

function isDocumentRequest(request) {
  if (request.headers.get('sec-fetch-dest') === 'document') return true;
  return (request.headers.get('accept') || '').includes('text/html');
}

function clearCookieHeader(host) {
  const h = (host || '').split(':')[0].toLowerCase();
  const shared = h === 'directagents.com' || h.endsWith('.directagents.com');
  const parts = [COOKIE_NAME + '=', 'Path=/', 'Secure', 'SameSite=Lax', 'Max-Age=0'];
  if (shared) parts.push('Domain=directagents.com');
  return parts.join('; ');
}

export default async (request, context) => {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === LOGOUT_ACTION) {
    return new Response('', {
      status: 302,
      headers: { Location: LOGIN_PATH, 'Set-Cookie': clearCookieHeader(url.host) },
    });
  }

  if (isPublicPath(pathname)) return context.next();

  if (isAuthorizedRefresh(request, url, Deno.env.get('DA_REFRESH_KEY'))) return context.next();

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (await isAuthenticated(token, url.origin)) return context.next();

  if (isDocumentRequest(request)) {
    return context.rewrite(new URL(LOGIN_FILE, url.origin));
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

export const config = { path: '/*' };
