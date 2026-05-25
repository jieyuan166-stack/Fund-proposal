const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const HOST = process.env.TRITON_HOST || '127.0.0.1';
const PORT = Number(process.env.TRITON_PORT || 8790);
const ROOT = __dirname;
const AUTH_FILE = path.join(ROOT, '.triton-auth.json');
const PORTFOLIO_DATA_FILE = path.join(ROOT, 'portfolio_data.json');
const DEFAULT_PASSWORD_HASH = process.env.TRITON_PASSWORD_HASH || '';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PORTFOLIO_STALE_DAYS = Number(process.env.TRITON_PORTFOLIO_STALE_DAYS || 45);

const sessions = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readPasswordHash() {
  try {
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return data.passwordHash || DEFAULT_PASSWORD_HASH;
  } catch {
    if (!DEFAULT_PASSWORD_HASH) {
      console.error('Missing password hash. Create .triton-auth.json or set TRITON_PASSWORD_HASH.');
    }
    return DEFAULT_PASSWORD_HASH;
  }
}

function writePasswordHash(passwordHash) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ passwordHash, updatedAt: new Date().toISOString() }, null, 2));
}

function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const index = part.indexOf('=');
    if (index > -1) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1));
  });
  return cookies;
}

function isAuthenticated(req) {
  const token = parseCookies(req).triton_proposal_session;
  if (!token) return false;

  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  send(res, status, JSON.stringify(payload), {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function portfolioFreshness(data) {
  const lastUpdated = data?.lastUpdated ? new Date(data.lastUpdated) : null;
  const ageDays = lastUpdated && !Number.isNaN(lastUpdated.getTime())
    ? Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 86400000))
    : null;
  const stale = ageDays === null || ageDays > PORTFOLIO_STALE_DAYS;

  return {
    checkedAt: new Date().toISOString(),
    lastUpdated: data?.lastUpdated || null,
    asOfLabel: data?.asOfLabel || null,
    ageDays,
    stale,
    staleAfterDays: PORTFOLIO_STALE_DAYS,
    updateMode: 'cache-free static source',
    note: stale
      ? 'Portfolio performance data is older than the configured freshness window. Connect an authorized live data feed before treating this as current.'
      : 'Portfolio data is within the configured freshness window.'
  };
}

function portfolioPayload() {
  const data = readJsonFile(PORTFOLIO_DATA_FILE);
  return {
    ...data,
    freshness: portfolioFreshness(data)
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  if (decoded === '/') decoded = '/index.html';
  const filePath = path.normalize(path.join(ROOT, decoded));
  if (!filePath.startsWith(ROOT) || path.basename(filePath).startsWith('.')) return null;
  if (path.basename(filePath) === 'server.js') return null;
  return filePath;
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const filePath = safePath(url.pathname);
  if (!filePath) {
    send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': ext === '.html' || ext === '.js' || ext === '.json' ? 'no-store' : 'public, max-age=14400'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function loginShell(res) {
  send(res, 200, `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 Proposal | Triton Wealth</title>
  <script src="/auth.v2.js" defer></script>
</head>
<body></body>
</html>`, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/auth-status' && req.method === 'GET') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return true;
  }

  if (url.pathname === '/api/portfolio-data' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: 'NOT_AUTHENTICATED' });
      return true;
    }
    sendJson(res, 200, portfolioPayload());
    return true;
  }

  if (url.pathname === '/api/data-health' && req.method === 'GET') {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: 'NOT_AUTHENTICATED' });
      return true;
    }
    sendJson(res, 200, {
      portfolio: portfolioFreshness(readJsonFile(PORTFOLIO_DATA_FILE)),
      serverTime: new Date().toISOString()
    });
    return true;
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    if (sha256(String(body.password || '')) !== readPasswordHash()) {
      sendJson(res, 401, { ok: false, error: 'INVALID_PASSWORD' });
      return true;
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    sendJson(res, 200, { ok: true }, {
      'set-cookie': `triton_proposal_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`
    });
    return true;
  }

  if (url.pathname === '/api/change-password' && req.method === 'POST') {
    if (!isAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: 'NOT_AUTHENTICATED' });
      return true;
    }

    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (sha256(currentPassword) !== readPasswordHash()) {
      sendJson(res, 401, { ok: false, error: 'INVALID_CURRENT_PASSWORD' });
      return true;
    }
    if (newPassword.length < 8) {
      sendJson(res, 400, { ok: false, error: 'PASSWORD_TOO_SHORT' });
      return true;
    }

    writePasswordHash(sha256(newPassword));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    const token = parseCookies(req).triton_proposal_session;
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true }, {
      'set-cookie': 'triton_proposal_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(req, res, url))) {
        sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      }
      return;
    }

    if (/^\/auth\.[a-z0-9-]+\.js$/i.test(url.pathname) || url.pathname === '/triton-logo.png') {
      serveFile(req, res);
      return;
    }

    if (!isAuthenticated(req)) {
      loginShell(res);
      return;
    }

    serveFile(req, res);
  } catch (error) {
    console.error(error);
    send(res, 500, 'Internal server error', { 'content-type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Triton proposal server listening on http://${HOST}:${PORT}`);
});
