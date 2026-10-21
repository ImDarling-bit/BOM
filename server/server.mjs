// Serveur du Manifestation Toolkit : chat local (WebSocket) + signalements (REST).
// Protocole : ../docs/PROTOCOL.md
//
// Anonymat : tout reste en mémoire (rien sur disque), aucune IP n'est journalisée,
// un redémarrage efface messages et signalements.

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

const ROLES = ['user', 'medic', 'supply', 'protection'];
const REPORT_TYPES = ['danger', 'kettle', 'medic', 'supply'];
const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 2000;
const REPORT_TTL_MS = 60 * 60 * 1000;
const MAX_REPORTS = 5000;
const MAX_TEXT = 500;
const IDLE_TIMEOUT_MS = 70_000; // l'app envoie un ping toutes les 25 s

// --- Utilitaires -----------------------------------------------------------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCoord = (lat, lng) => isNum(lat) && isNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Limiteur simple : `max` actions par fenêtre de `windowMs`. */
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= max;
  };
}

// --- Signalements ----------------------------------------------------------

/** @type {Map<string, {id:string,type:string,latitude:number,longitude:number,author:string,createdAt:number,expiresAt:number}>} */
const reports = new Map();

function activeReportsNear(lat, lng, radius) {
  const now = Date.now();
  return [...reports.values()].filter(
    (r) => r.expiresAt > now && distanceM(lat, lng, r.latitude, r.longitude) <= radius,
  );
}

// Retire les signalements expirés et prévient les clients.
setInterval(() => {
  const now = Date.now();
  for (const r of reports.values()) {
    if (r.expiresAt <= now) {
      reports.delete(r.id);
      broadcast({ type: 'report_removed', id: r.id }, () => true);
    }
  }
}, 60_000).unref();

// --- WebSocket -------------------------------------------------------------

/** @type {Map<import('ws').WebSocket, {name:string|null, role:string, radius:number, lat:number|null, lng:number|null, lastSeen:number}>} */
const clients = new Map();

function broadcast(payload, filter) {
  const data = JSON.stringify(payload);
  for (const [ws, c] of clients) {
    if (ws.readyState === ws.OPEN && filter(c)) ws.send(data);
  }
}

/** Le client `c` est-il dans le rayon du point (lat, lng) ? */
function near(c, lat, lng, radius) {
  return c.lat !== null && distanceM(lat, lng, c.lat, c.lng) <= radius;
}

const chatLimit = limiter(20, 30_000); // 20 messages / 30 s par connexion

function onMessage(ws, c, raw) {
  c.lastSeen = Date.now();
  if (raw.length > 10_000) return;
  let d;
  try {
    d = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!d || typeof d !== 'object') return;

  switch (d.type) {
    case 'hello': {
      c.name = str(d.name, 40);
      if (ROLES.includes(d.role)) c.role = d.role;
      if (isNum(d.radius)) c.radius = Math.min(Math.max(d.radius, 100), MAX_RADIUS_M);
      setPosition(c, d.latitude, d.longitude);
      break;
    }
    case 'position':
      setPosition(c, d.latitude, d.longitude);
      break;
    case 'ping':
      ws.send('{"type":"pong"}');
      break;
    case 'chat': {
      const text = str(d.text, MAX_TEXT)?.trim();
      const id = str(d.id, 64);
      if (!text || !id || !c.name || !chatLimit(ws)) return;
      // Auteur et rôle viennent du "hello" : un client ne peut pas usurper un autre pseudo.
      const msg = { type: 'chat', id, author: c.name, role: c.role, text, ts: Date.now() };
      if (isCoord(d.latitude, d.longitude)) {
        msg.latitude = d.latitude;
        msg.longitude = d.longitude;
        broadcast(msg, (o) => near(o, msg.latitude, msg.longitude, c.radius));
        if (c.lat === null) ws.send(JSON.stringify(msg)); // écho à l'auteur
      } else {
        broadcast(msg, (o) => o.lat === null); // sans position : seulement aux clients sans position
        if (c.lat !== null) ws.send(JSON.stringify(msg));
      }
      break;
    }
    default:
      break;
  }
}

function setPosition(c, lat, lng) {
  if (isCoord(lat, lng)) {
    c.lat = lat;
    c.lng = lng;
  } else {
    c.lat = null;
    c.lng = null;
  }
}

// --- HTTP (REST) -----------------------------------------------------------

const postLimit = limiter(10, 60_000); // 10 signalements / min par IP (gardée en mémoire 1 min, jamais écrite)

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') return send(res, 200, { ok: true, clients: clients.size, reports: reports.size });

  if (url.pathname !== '/reports') return send(res, 404, { error: 'not found' });

  if (req.method === 'GET') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const radius = Math.min(Number(url.searchParams.get('radius')) || DEFAULT_RADIUS_M, MAX_RADIUS_M);
    if (!isCoord(lat, lng)) return send(res, 400, { error: 'lat/lng invalides' });
    return send(res, 200, activeReportsNear(lat, lng, radius));
  }

  if (req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!postLimit(ip)) return send(res, 429, { error: 'trop de signalements' });
    let d;
    try {
      d = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: 'JSON invalide' });
    }
    if (!d || !REPORT_TYPES.includes(d.type) || !isCoord(d.latitude, d.longitude)) {
      return send(res, 400, { error: 'signalement invalide' });
    }
    if (reports.size >= MAX_REPORTS) return send(res, 503, { error: 'serveur plein' });
    const now = Date.now();
    const report = {
      id: randomUUID(),
      type: d.type,
      latitude: d.latitude,
      longitude: d.longitude,
      author: str(d.author, 40) || '?',
      createdAt: now,
      expiresAt: now + REPORT_TTL_MS,
    };
    reports.set(report.id, report);
    broadcast({ type: 'report', report }, (c) => near(c, report.latitude, report.longitude, c.radius));
    return send(res, 201, report);
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'méthode non autorisée' });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  const c = { name: null, role: 'user', radius: DEFAULT_RADIUS_M, lat: null, lng: null, lastSeen: Date.now() };
  clients.set(ws, c);
  ws.on('message', (raw) => onMessage(ws, c, raw));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => ws.terminate());
});

// Ferme les connexions mortes (téléphone parti sans fermer).
setInterval(() => {
  const limit = Date.now() - IDLE_TIMEOUT_MS;
  for (const [ws, c] of clients) if (c.lastSeen < limit) ws.terminate();
}, 30_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Manifestation Toolkit server sur http://${HOST}:${PORT} (WebSocket : /ws)`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const ws of clients.keys()) ws.close(1001);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
