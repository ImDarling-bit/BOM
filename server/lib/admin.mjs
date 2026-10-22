// Panneau d'administration web : /admin
// Comptes en base SQLite (mot de passe scrypt), double authentification TOTP
// optionnelle, sessions en mémoire (cookie HttpOnly, SameSite=Strict).

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';

import * as db from './db.mjs';
import * as totp from './totp.mjs';
import { clientIp, limiter, parseCookies, readJson, sendJson, str } from './util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public', 'admin');
const MAPLIBRE = join(HERE, '..', 'node_modules', 'maplibre-gl', 'dist');

const COOKIE = 'bom_admin';
const SESSION_IDLE_MS = 60 * 60 * 1000; // 1 h sans activité
const SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 h au maximum
const TICKET_MS = 5 * 60 * 1000;
const SNAPSHOT_MS = 2000;

const MAP_STYLE_URL = process.env.MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/dark';

const STATIC = {
  '/admin': ['index.html', 'text/html; charset=utf-8'],
  '/admin/': ['index.html', 'text/html; charset=utf-8'],
  '/admin/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'],
};
const VENDOR = /^\/admin\/vendor\/maplibre\/(maplibre-gl(?:-shared|-worker)?\.mjs|maplibre-gl\.css)$/;

const token = () => randomBytes(32).toString('base64url');

export function createAdmin(hub) {
  db.openDb();

  const sessions = new Map(); // token -> { adminId, username, created, seen }
  const tickets = new Map(); // ticket -> { adminId, username, expires, tries }
  const loginLimitIp = limiter(10, 15 * 60 * 1000);
  const loginLimitUser = limiter(10, 15 * 60 * 1000);

  setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions)
      if (now - s.seen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) sessions.delete(k);
    for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
  }, 60_000).unref();

  const secure = (req) =>
    process.env.COOKIE_SECURE === '1' ||
    (process.env.COOKIE_SECURE !== '0' && req.headers['x-forwarded-proto'] === 'https');

  function getSession(req) {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    const s = t && sessions.get(t);
    if (!s) return null;
    const now = Date.now();
    if (now - s.seen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) {
      sessions.delete(t);
      return null;
    }
    s.seen = now;
    return { token: t, ...s };
  }

  function openSession(req, res, admin) {
    const t = token();
    const now = Date.now();
    sessions.set(t, { adminId: admin.id, username: admin.username, created: now, seen: now });
    db.touchLogin(admin.id);
    db.audit(admin.username, 'connexion');
    const cookie = `${COOKIE}=${t}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_MS / 1000}${secure(req) ? '; Secure' : ''}`;
    sendJson(
      res,
      200,
      { ok: true, username: admin.username, totpEnabled: !!admin.totp_enabled },
      { 'Set-Cookie': cookie },
    );
  }

  function headers(req) {
    const host = String(req.headers.host || '');
    let tiles = '';
    try {
      tiles = new URL(MAP_STYLE_URL).origin;
    } catch {
      // URL invalide : la carte ne chargera pas, le reste du panneau fonctionne.
    }
    return {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: blob: ${tiles}`,
        `connect-src 'self' ws://${host} wss://${host} ${tiles}`,
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    };
  }

  /** Requêtes POST : en-tête maison obligatoire (bloque les formulaires d'autres sites). */
  const csrfOk = (req) => req.headers['x-bom-admin'] === '1';

  async function api(req, res, path) {
    const ip = clientIp(req);
    if (req.method === 'GET' && path === 'me') {
      const s = getSession(req);
      if (!s) return sendJson(res, 401, { error: 'non connecté' });
      const a = db.getAdmin(s.adminId);
      return sendJson(res, 200, {
        username: a.username,
        totpEnabled: !!a.totp_enabled,
        mapStyleUrl: MAP_STYLE_URL,
      });
    }
    if (req.method === 'GET' && path === 'audit') {
      if (!getSession(req)) return sendJson(res, 401, { error: 'non connecté' });
      return sendJson(res, 200, db.recentAudit(100));
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'méthode non autorisée' });
    if (!csrfOk(req)) return sendJson(res, 403, { error: 'requête refusée' });
    const body = (await readJson(req, 4096)) || {};

    if (path === 'login') {
      const username = str(body.username, 64) || '';
      if (!loginLimitIp(ip) || !loginLimitUser(username.toLowerCase())) {
        return sendJson(res, 429, { error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
      }
      const a = db.findAdmin(username);
      // Même temps de calcul que le compte existe ou non.
      const ok = await db.checkPassword(
        String(body.password || ''),
        a ? a.password_hash : 'scrypt$0$0$0$AAAA$AAAA',
      );
      if (!a || !ok) {
        db.audit(username, 'connexion refusée', 'mot de passe');
        return sendJson(res, 401, { error: 'Identifiants incorrects.' });
      }
      if (a.totp_enabled) {
        const ticket = token();
        tickets.set(ticket, {
          adminId: a.id,
          username: a.username,
          expires: Date.now() + TICKET_MS,
          tries: 0,
        });
        return sendJson(res, 200, { totp: true, ticket });
      }
      return openSession(req, res, a);
    }

    if (path === 'login/totp') {
      const t = tickets.get(String(body.ticket || ''));
      if (!t || t.expires < Date.now())
        return sendJson(res, 401, { error: 'Session expirée, reconnecte-toi.' });
      const a = db.getAdmin(t.adminId);
      const step = a?.totp_enabled ? totp.verify(a.totp_secret, body.code, a.totp_last_step) : -1;
      if (step < 0) {
        if (++t.tries >= 5) tickets.delete(String(body.ticket));
        db.audit(t.username, 'connexion refusée', 'code 2FA');
        return sendJson(res, 401, { error: 'Code incorrect.' });
      }
      tickets.delete(String(body.ticket));
      db.setTotpLastStep(a.id, step);
      return openSession(req, res, a);
    }

    // --- Routes connectées ---
    const s = getSession(req);
    if (!s) return sendJson(res, 401, { error: 'non connecté' });
    const a = db.getAdmin(s.adminId);
    if (!a) return sendJson(res, 401, { error: 'compte supprimé' });

    if (path === 'logout') {
      sessions.delete(s.token);
      db.audit(a.username, 'déconnexion');
      return sendJson(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': `${COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0` },
      );
    }

    if (path === '2fa/setup') {
      if (a.totp_enabled) return sendJson(res, 400, { error: 'La double authentification est déjà active.' });
      const secret = totp.newSecret();
      db.setTotpPending(a.id, secret);
      const uri = totp.otpauthUri(secret, a.username);
      const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return sendJson(res, 200, { secret, uri, qr });
    }

    if (path === '2fa/enable') {
      const fresh = db.getAdmin(a.id);
      if (!fresh.totp_pending) return sendJson(res, 400, { error: 'Commence par générer un QR code.' });
      const step = totp.verify(fresh.totp_pending, body.code);
      if (step < 0) return sendJson(res, 400, { error: 'Code incorrect. Vérifie l’heure du téléphone.' });
      db.enableTotp(a.id, step);
      db.audit(a.username, '2FA activée');
      return sendJson(res, 200, { ok: true });
    }

    if (path === '2fa/disable') {
      const okPass = await db.checkPassword(String(body.password || ''), a.password_hash);
      const step = a.totp_enabled ? totp.verify(a.totp_secret, body.code, a.totp_last_step) : -1;
      if (!okPass || step < 0) return sendJson(res, 400, { error: 'Mot de passe ou code incorrect.' });
      db.disableTotp(a.id);
      db.audit(a.username, '2FA désactivée');
      return sendJson(res, 200, { ok: true });
    }

    if (path === 'password') {
      const okPass = await db.checkPassword(String(body.current || ''), a.password_hash);
      if (!okPass) return sendJson(res, 400, { error: 'Mot de passe actuel incorrect.' });
      if (!db.passwordOk(body.next)) return sendJson(res, 400, { error: '12 caractères minimum.' });
      await db.setPassword(a.id, body.next);
      // Déconnecte les autres sessions de ce compte.
      for (const [k, x] of sessions) if (x.adminId === a.id && k !== s.token) sessions.delete(k);
      db.audit(a.username, 'mot de passe changé');
      return sendJson(res, 200, { ok: true });
    }

    const m = /^reports\/([\w-]{1,64})\/delete$/.exec(path);
    if (m) {
      const ok = hub.removeReport(m[1], `admin:${a.username}`);
      if (ok) db.audit(a.username, 'signalement supprimé', m[1]);
      return sendJson(res, ok ? 200 : 404, { ok });
    }
    const h = /^helps\/([\w-]{1,64})\/close$/.exec(path);
    if (h) {
      hub.removeHelp(h[1], `clos par admin:${a.username}`);
      db.audit(a.username, 'appel à l’aide clos', h[1]);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { error: 'introuvable' });
  }

  /** Renvoie true si la requête concernait /admin. */
  async function handle(req, res, url) {
    if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false;
    const hdrs = headers(req);
    for (const [k, v] of Object.entries(hdrs)) res.setHeader(k, v);

    if (url.pathname.startsWith('/admin/api/')) {
      await api(req, res, url.pathname.slice('/admin/api/'.length));
      return true;
    }
    const file = STATIC[url.pathname];
    const vendor = VENDOR.exec(url.pathname);
    if (req.method === 'GET' && (file || vendor)) {
      const [path, type] = file
        ? [join(PUBLIC, file[0]), file[1]]
        : [
            join(MAPLIBRE, vendor[1]),
            vendor[1].endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          ];
      try {
        const data = await readFile(path);
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': vendor ? 'public, max-age=86400' : 'no-store',
        });
        res.end(data);
      } catch {
        sendJson(res, 404, { error: 'introuvable' });
      }
      return true;
    }
    sendJson(res, 404, { error: 'introuvable' });
    return true;
  }

  // --- WebSocket du panneau : instantané toutes les 2 s + événements en direct ---

  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const viewers = new Set();

  wss.on('connection', (ws, session) => {
    viewers.add(ws);
    ws.send(JSON.stringify({ type: 'hello', username: session.username, events: hub.recentEvents(300) }));
    ws.send(JSON.stringify({ type: 'snapshot', ...hub.snapshot() }));
    ws.on('close', () => viewers.delete(ws));
    ws.on('error', () => ws.terminate());
  });

  hub.events.on('event', (e) => {
    const data = JSON.stringify({ type: 'event', event: e });
    for (const ws of viewers) if (ws.readyState === ws.OPEN) ws.send(data);
  });

  setInterval(() => {
    if (!viewers.size) return;
    // Une session expirée ferme le flux.
    for (const ws of viewers) if (!sessions.has(ws.sessionToken)) ws.close(4401, 'session expirée');
    const data = JSON.stringify({ type: 'snapshot', ...hub.snapshot() });
    for (const ws of viewers) if (ws.readyState === ws.OPEN) ws.send(data);
  }, SNAPSHOT_MS).unref();

  /** Upgrade WebSocket sur /admin/ws : refusé sans session valide. */
  function upgrade(req, socket, head) {
    const s = getSession(req);
    const origin = req.headers.origin;
    const host = req.headers.host;
    const sameOrigin = origin && (origin === `https://${host}` || origin === `http://${host}`);
    if (!s || !sameOrigin) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.sessionToken = s.token;
      wss.emit('connection', ws, s);
    });
  }

  return { handle, upgrade };
}
