// Edge-enforced authentication for the Origami Risk SEO & AI Visibility report.
//
// Replaces Netlify's built-in visitor-password (HTTP basic auth) with a
// server-validated session cookie. Runs at the CDN edge BEFORE any asset
// or function is served — unauthenticated requests never receive app
// code, data, or /api/* / /.netlify/functions/* routes.
//
// Pattern ported from wvp-seo / wacoal-dash / kabrita.
//
// Cookie format:    "<expiry_ms>.<hmac_base64url>"
// HMAC:             HMAC-SHA256(DA_AUTH_SECRET, expiry_ms_as_string)
//
// Env vars REQUIRED on the Netlify site (returns 503 — fails CLOSED — until
// both are set):
//   DA_AUTH_PASSWORD = the password users type in
//   DA_AUTH_SECRET   = a random 32-byte hex string used to sign cookies

const COOKIE_NAME = 'da_session_origami';
const LOGIN_ACTION = '/__login';
const LOGOUT_ACTION = '/__logout';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

function constantTimeEqual(a, b) {
  const aBytes = typeof a === 'string' ? new TextEncoder().encode(a) : a;
  const bBytes = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function bytesToB64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacB64Url(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return bytesToB64Url(new Uint8Array(sig));
}

async function makeCookieValue(secret) {
  const exp = String(Date.now() + MAX_AGE_SECONDS * 1000);
  const sig = await hmacB64Url(secret, exp);
  return `${exp}.${sig}`;
}

async function validateCookieValue(value, secret) {
  if (!value) return false;
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expMs = Number(exp);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = await hmacB64Url(secret, exp);
  return constantTimeEqual(sig, expected);
}

// Share the cookie across directagents.com subdomains so a sign-in on one
// DA client report also satisfies its siblings. Stay host-scoped on raw
// *.netlify.app URLs where a cross-domain cookie wouldn't be sent anyway.
function pickCookieDomain(host) {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase();
  if (h === 'directagents.com' || h.endsWith('.directagents.com')) return 'directagents.com';
  return null;
}

function setCookieHeader(cookieValue, host) {
  const domain = pickCookieDomain(host);
  const parts = [
    `${COOKIE_NAME}=${cookieValue}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join('; ');
}

function clearCookieHeader(host) {
  const domain = pickCookieDomain(host);
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join('; ');
}

function loginPage(errorMsg) {
  const err = errorMsg ? `<div class="err">${errorMsg}</div>` : '';
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign in · Origami Risk Report</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="icon" href="data:,">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; background: linear-gradient(135deg, #0B1F3A 0%, #0A4DA2 100%); color: white; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; color: #0B1F3A; padding: 32px 28px; border-radius: 10px; max-width: 380px; width: 90%; box-shadow: 0 16px 48px rgba(0,0,0,.3); }
    h1 { margin: 0 0 6px 0; font-size: 20px; }
    .sub { color: #555; font-size: 13px; margin: 0 0 18px 0; }
    .err { background: #ffe5e5; color: #a31515; padding: 8px 12px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
    input { width: 100%; box-sizing: border-box; height: 42px; padding: 0 12px; border: 2px solid #e9ebeb; border-radius: 4px; font-size: 15px; font-family: inherit; margin: 4px 0 16px 0; }
    input:focus { outline: none; border-color: #1A7FE0; }
    button { width: 100%; height: 42px; background: #1A7FE0; color: white; border: 0; border-radius: 4px; font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer; }
    button:hover { background: #0A4DA2; }
    .foot { color: #888; font-size: 11px; text-align: center; margin-top: 18px; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="${LOGIN_ACTION}">
    <h1>Origami Risk · SEO &amp; AI Visibility</h1>
    <p class="sub">Enter the password to access this report.</p>
    ${err}
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    <div class="foot">Session lasts 7 days.</div>
  </form>
</body>
</html>`, {
    status: errorMsg ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function serviceUnavailable() {
  return new Response(`Auth is not configured. Set DA_AUTH_PASSWORD and DA_AUTH_SECRET env vars on this Netlify site.`, {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function readCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq).trim();
    if (k === COOKIE_NAME) return p.slice(eq + 1).trim();
  }
  return null;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const host = url.host;

  const password = Deno.env.get('DA_AUTH_PASSWORD');
  const secret = Deno.env.get('DA_AUTH_SECRET');
  if (!password || !secret) return serviceUnavailable();

  if (url.pathname === LOGOUT_ACTION) {
    return new Response('', {
      status: 302,
      headers: { 'Location': '/', 'Set-Cookie': clearCookieHeader(host) },
    });
  }

  if (request.method === 'POST' && url.pathname === LOGIN_ACTION) {
    const form = await request.formData();
    const submitted = String(form.get('password') || '');
    if (!constantTimeEqual(submitted, password)) {
      await new Promise(r => setTimeout(r, 350));
      return loginPage('Incorrect password.');
    }
    const cookieValue = await makeCookieValue(secret);
    return new Response('', {
      status: 302,
      headers: { 'Location': '/', 'Set-Cookie': setCookieHeader(cookieValue, host) },
    });
  }

  const cookieVal = readCookie(request.headers.get('cookie'));
  if (cookieVal && await validateCookieValue(cookieVal, secret)) {
    return context.next();
  }

  return loginPage(null);
};

export const config = {
  // Match all paths so the function gates everything — assets AND /api/*.
  path: '/*',
};
