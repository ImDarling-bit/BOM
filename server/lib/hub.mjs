// Temps réel de la manif : chat local, signalements, zones, appels à l'aide,
// partage de position entre proches et alertes de purge.
// Protocole : ../../docs/PROTOCOL.md
//
// Tout reste en mémoire : un redémarrage efface tout.

import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

import {
  clientIp,
  distanceM,
  isCoord,
  isNum,
  limiter,
  parseClientHeader,
  readJson,
  round3,
  sendJson,
  str,
} from './util.mjs';

const ROLES = ['user', 'medic', 'supply', 'protection'];
export const POINT_TYPES = ['danger', 'teargas', 'medic', 'supply', 'test'];
export const AREA_TYPES = ['kettle', 'safe_zone', 'danger_zone'];
const REPORT_TYPES = [...POINT_TYPES, ...AREA_TYPES];

const MAX_RADIUS_M = 5000;
const DEFAULT_RADIUS_M = 2000;
const REPORT_TTL_MS = 60 * 60 * 1000;
const TEST_TTL_MS = 30 * 60 * 1000;
const HELP_TTL_MS = 30 * 60 * 1000;
const PANIC_KEEP_MS = 6 * 60 * 60 * 1000;
const MAX_REPORTS = 5000;
const MAX_TEXT = 500;
const MAX_AREA_POINTS = 40;
const MAX_AREA_SPAN_M = 3000;
const IDLE_TIMEOUT_MS = 70_000;
const CODE_RE = /^[A-Z0-9]{8}$/;

const shortId = () => randomBytes(4).toString('hex');

/** Centre approximatif (moyenne des sommets) d'une zone. */
function centroid(ring) {
  const n = ring.length;
  return {
    latitude: ring.reduce((s, p) => s + p[1], 0) / n,
    longitude: ring.reduce((s, p) => s + p[0], 0) / n,
  };
}

/** Zone valide : 3 à 40 sommets [lng, lat], tous à moins de 3 km du centre. */
function parseArea(area) {
  if (!Array.isArray(area) || area.length < 3 || area.length > MAX_AREA_POINTS) return null;
  const ring = [];
  for (const p of area) {
    if (!Array.isArray(p) || !isCoord(p[1], p[0])) return null;
    ring.push([p[0], p[1]]);
  }
  const c = centroid(ring);
  if (ring.some((p) => distanceM(c.latitude, c.longitude, p[1], p[0]) > MAX_AREA_SPAN_M)) return null;
  return ring;
}

const normCode = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

export function createHub(server) {
  /** Flux d'événements pour le panneau d'administration. */
  const events = new EventEmitter();
  const log = [];
  const emit = (kind, data) => {
    const e = { id: shortId(), ts: Date.now(), kind, ...data };
    log.push(e);
    if (log.length > 1000) log.shift();
    events.emit('event', e);
  };

  const clients = new Map(); // ws -> client
  const reports = new Map(); // id -> report
  const helps = new Map(); // id -> help
  const purges = []; // dernières purges (positions arrondies)
  const friendPos = new Map(); // code -> { name, latitude, longitude, ts }
  const panics = new Map(); // code -> { name, latitude, longitude, ts }
  const stats = { started: Date.now(), chat: 0, reports: 0, helps: 0, purges: 0 };

  const send = (ws, payload) => {
    if (ws.readyState === ws.OPEN) ws.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  };
  function broadcast(payload, filter) {
    const data = JSON.stringify(payload);
    for (const [ws, c] of clients) if (filter(c)) send(ws, data);
  }
  const near = (c, lat, lng, radius) => c.lat !== null && distanceM(lat, lng, c.lat, c.lng) <= radius;

  // --- Signalements ---------------------------------------------------------

  function addReport(input, via) {
    if (!REPORT_TYPES.includes(input.type)) return { error: 'type inconnu' };
    let area = null;
    let center;
    if (AREA_TYPES.includes(input.type)) {
      area = parseArea(input.area);
      if (!area) return { error: 'zone invalide' };
      center = centroid(area);
    } else {
      if (!isCoord(input.latitude, input.longitude)) return { error: 'position invalide' };
      center = { latitude: input.latitude, longitude: input.longitude };
    }
    if (reports.size >= MAX_REPORTS) return { error: 'serveur plein', status: 503 };
    const now = Date.now();
    const report = {
      id: randomUUID(),
      type: input.type,
      latitude: center.latitude,
      longitude: center.longitude,
      ...(area ? { area } : {}),
      author: str(input.author, 40) || '?',
      createdAt: now,
      expiresAt: now + (input.type === 'test' ? TEST_TTL_MS : REPORT_TTL_MS),
    };
    reports.set(report.id, report);
    stats.reports++;
    broadcast({ type: 'report', report }, (c) => near(c, report.latitude, report.longitude, c.radius));
    emit('report', { report, via });
    return { report };
  }

  function removeReport(id, by) {
    const r = reports.get(id);
    if (!r) return false;
    reports.delete(id);
    broadcast({ type: 'report_removed', id }, () => true);
    emit('report_removed', { reportId: id, reportType: r.type, by });
    return true;
  }

  // --- Appels à l'aide ----------------------------------------------------------

  function removeHelp(id, reason) {
    const h = helps.get(id);
    if (!h) return;
    helps.delete(id);
    broadcast({ type: 'help_removed', id }, () => true);
    emit('help_removed', { helpId: id, author: h.author, reason });
  }

  // --- WebSocket des téléphones -------------------------------------------------

  const chatLimit = limiter(20, 30_000);
  const helpLimit = limiter(3, 60_000);
  const posLimit = limiter(30, 60_000);

  function setPosition(c, lat, lng) {
    if (isCoord(lat, lng)) {
      c.lat = round3(lat);
      c.lng = round3(lng);
    } else {
      c.lat = null;
      c.lng = null;
    }
  }

  function setFollows(ws, c, codes) {
    c.follows = new Set(
      (Array.isArray(codes) ? codes : [])
        .map(normCode)
        .filter((k) => CODE_RE.test(k))
        .slice(0, 50),
    );
    const now = Date.now();
    for (const code of c.follows) {
      const p = friendPos.get(code);
      if (p) send(ws, { type: 'friend', code, ...p });
      const panic = panics.get(code);
      if (panic && now - panic.ts < PANIC_KEEP_MS) send(ws, { type: 'friend_panic', code, ...panic });
    }
  }

  const followersOf = (code) => [...clients].filter(([, o]) => o.follows.has(code));

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
        const first = !c.name;
        c.name = str(d.name, 40);
        if (ROLES.includes(d.role)) c.role = d.role;
        if (isNum(d.radius)) c.radius = Math.min(Math.max(d.radius, 100), MAX_RADIUS_M);
        if (d.client && typeof d.client === 'object') {
          c.version = str(d.client.version, 20) || '?';
          c.platform = ['android', 'ios', 'web'].includes(d.client.platform) ? d.client.platform : '?';
        }
        setPosition(c, d.latitude, d.longitude);
        const code = normCode(d.shareCode);
        c.shareCode = CODE_RE.test(code) ? code : null;
        setFollows(ws, c, d.follows);
        if (first)
          emit('join', {
            client: c.id,
            name: c.name,
            role: c.role,
            platform: c.platform,
            version: c.version,
          });
        break;
      }
      case 'position':
        if (!posLimit(ws)) return;
        setPosition(c, d.latitude, d.longitude);
        break;
      case 'ping':
        send(ws, '{"type":"pong"}');
        break;
      case 'chat': {
        const text = str(d.text, MAX_TEXT)?.trim();
        const id = str(d.id, 64);
        if (!text || !id || !c.name || !chatLimit(ws)) return;
        // Auteur et rôle viennent du "hello" : impossible d'usurper un autre pseudo.
        const msg = { type: 'chat', id, author: c.name, role: c.role, text, ts: Date.now() };
        if (isCoord(d.latitude, d.longitude)) {
          msg.latitude = round3(d.latitude);
          msg.longitude = round3(d.longitude);
          broadcast(msg, (o) => near(o, msg.latitude, msg.longitude, c.radius));
          if (c.lat === null) send(ws, msg);
        } else {
          broadcast(msg, (o) => o.lat === null);
          if (c.lat !== null) send(ws, msg);
        }
        stats.chat++;
        emit('chat', {
          client: c.id,
          name: c.name,
          role: c.role,
          text,
          latitude: msg.latitude,
          longitude: msg.longitude,
        });
        break;
      }
      case 'help': {
        if (!c.name || !helpLimit(ws) || !isCoord(d.latitude, d.longitude)) return;
        const wanted = Array.isArray(d.roles) ? d.roles.filter((r) => ROLES.includes(r) || r === 'all') : [];
        if (!wanted.length) return;
        const now = Date.now();
        const help = {
          id: str(d.id, 64) || randomUUID(),
          author: c.name,
          role: c.role,
          roles: wanted,
          note: str(d.note, 120) || '',
          latitude: d.latitude,
          longitude: d.longitude,
          createdAt: now,
          expiresAt: now + HELP_TTL_MS,
        };
        helps.set(help.id, { ...help, client: c.id });
        let notified = 0;
        for (const [ows, o] of clients) {
          if (ows === ws || !near(o, help.latitude, help.longitude, Math.max(c.radius, DEFAULT_RADIUS_M)))
            continue;
          if (!wanted.includes('all') && !wanted.includes(o.role)) continue;
          send(ows, { type: 'help', help });
          notified++;
        }
        send(ws, { type: 'help_ack', id: help.id, notified });
        stats.helps++;
        emit('help', {
          help: { ...help, latitude: round3(help.latitude), longitude: round3(help.longitude) },
          client: c.id,
          notified,
        });
        break;
      }
      case 'help_cancel': {
        const h = helps.get(d.id);
        if (h && h.client === c.id) removeHelp(h.id, 'annulé');
        break;
      }
      case 'share': {
        const code = normCode(d.code);
        c.shareCode = CODE_RE.test(code) ? code : null;
        break;
      }
      case 'follow':
        setFollows(ws, c, d.codes);
        break;
      case 'friend_position': {
        if (!c.shareCode || !isCoord(d.latitude, d.longitude) || !posLimit(ws)) return;
        const p = { name: c.name, latitude: d.latitude, longitude: d.longitude, ts: Date.now() };
        friendPos.set(c.shareCode, p);
        for (const [ows] of followersOf(c.shareCode)) send(ows, { type: 'friend', code: c.shareCode, ...p });
        break;
      }
      case 'panic': {
        const now = Date.now();
        const has = isCoord(d.latitude, d.longitude);
        const purge = {
          id: shortId(),
          name: c.name,
          role: c.role,
          latitude: has ? round3(d.latitude) : c.lat,
          longitude: has ? round3(d.longitude) : c.lng,
          ts: now,
          friends: 0,
        };
        if (c.shareCode) {
          const p = {
            name: c.name,
            latitude: has ? d.latitude : null,
            longitude: has ? d.longitude : null,
            ts: now,
          };
          panics.set(c.shareCode, p);
          friendPos.delete(c.shareCode);
          const followers = followersOf(c.shareCode);
          for (const [ows] of followers) send(ows, { type: 'friend_panic', code: c.shareCode, ...p });
          purge.friends = followers.length;
        }
        purges.push(purge);
        if (purges.length > 200) purges.shift();
        stats.purges++;
        emit('purge', { purge, client: c.id });
        break;
      }
      default:
        break;
    }
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    const c = {
      id: shortId(),
      name: null,
      role: 'user',
      radius: DEFAULT_RADIUS_M,
      lat: null,
      lng: null,
      platform: '?',
      version: '?',
      shareCode: null,
      follows: new Set(),
      connectedAt: Date.now(),
      lastSeen: Date.now(),
    };
    clients.set(ws, c);
    ws.on('message', (raw) => onMessage(ws, c, raw));
    ws.on('close', () => {
      clients.delete(ws);
      if (c.name) emit('leave', { client: c.id, name: c.name, role: c.role });
    });
    ws.on('error', () => ws.terminate());
  });

  // --- Ménage périodique ----------------------------------------------------------

  setInterval(() => {
    const now = Date.now();
    for (const r of reports.values()) {
      if (r.expiresAt <= now) {
        reports.delete(r.id);
        broadcast({ type: 'report_removed', id: r.id }, () => true);
        emit('report_removed', { reportId: r.id, reportType: r.type, by: 'expiration' });
      }
    }
    for (const h of helps.values()) if (h.expiresAt <= now) removeHelp(h.id, 'expiré');
    for (const [code, p] of panics) if (now - p.ts > PANIC_KEEP_MS) panics.delete(code);
    for (const [code, p] of friendPos) if (now - p.ts > PANIC_KEEP_MS) friendPos.delete(code);
  }, 30_000).unref();

  setInterval(() => {
    const limit = Date.now() - IDLE_TIMEOUT_MS;
    for (const [ws, c] of clients) if (c.lastSeen < limit) ws.terminate();
  }, 30_000).unref();

  // Nombre de manifestant·es autour de chacun·e (chat local), envoyé s'il change.
  function sendNearbyCounts() {
    const located = [...clients].filter(([, c]) => c.name && c.lat !== null);
    for (const [ws, c] of clients) {
      if (!c.name) continue;
      let count = null;
      if (c.lat !== null) {
        // Pré-filtre grossier (degrés) avant le calcul exact de distance.
        const dLat = c.radius / 111_000;
        count = 0;
        for (const [ows, o] of located) {
          if (ows === ws || Math.abs(o.lat - c.lat) > dLat) continue;
          if (distanceM(c.lat, c.lng, o.lat, o.lng) <= c.radius) count++;
        }
      }
      if (count !== c.nearby) {
        c.nearby = count;
        send(ws, { type: 'nearby', count, radius: c.radius });
      }
    }
  }
  setInterval(sendNearbyCounts, 5000).unref();

  // --- REST : /reports ----------------------------------------------------------------

  const postLimit = limiter(10, 60_000);

  async function handleRest(req, res, url) {
    if (url.pathname !== '/reports') return false;
    if (req.method === 'GET') {
      const lat = Number(url.searchParams.get('lat'));
      const lng = Number(url.searchParams.get('lng'));
      const radius = Math.min(Number(url.searchParams.get('radius')) || DEFAULT_RADIUS_M, MAX_RADIUS_M);
      if (!isCoord(lat, lng)) return (sendJson(res, 400, { error: 'lat/lng invalides' }), true);
      const now = Date.now();
      const list = [...reports.values()].filter(
        (r) => r.expiresAt > now && distanceM(lat, lng, r.latitude, r.longitude) <= radius,
      );
      return (sendJson(res, 200, list), true);
    }
    if (req.method === 'POST') {
      if (!postLimit(clientIp(req))) return (sendJson(res, 429, { error: 'trop de signalements' }), true);
      const d = await readJson(req, 8 * 1024);
      if (!d) return (sendJson(res, 400, { error: 'JSON invalide' }), true);
      const { report, error, status } = addReport(d, {
        channel: 'rest',
        ...parseClientHeader(req.headers['x-bom-client']),
      });
      if (error) return (sendJson(res, status || 400, { error }), true);
      return (sendJson(res, 201, report), true);
    }
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'méthode non autorisée' });
    return true;
  }

  function close() {
    for (const ws of clients.keys()) ws.close(1001);
  }

  return {
    wss,
    events,
    handleRest,
    close,
    removeReport,
    removeHelp,
    /** Vue complète pour le panneau d'administration (positions arrondies). */
    snapshot() {
      const now = Date.now();
      const people = [...clients.values()]
        .filter((c) => c.name)
        .map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          latitude: c.lat,
          longitude: c.lng,
          platform: c.platform,
          version: c.version,
          sharing: !!c.shareCode,
          follows: c.follows.size,
          connectedAt: c.connectedAt,
          lastSeen: c.lastSeen,
        }));
      return {
        now,
        stats: { ...stats, clients: clients.size, identified: people.length },
        people,
        reports: [...reports.values()].filter((r) => r.expiresAt > now),
        helps: [...helps.values()].map(({ client, ...h }) => ({
          ...h,
          latitude: round3(h.latitude),
          longitude: round3(h.longitude),
        })),
        purges: purges.slice(-100),
      };
    },
    recentEvents: (n = 300) => log.slice(-n),
  };
}
