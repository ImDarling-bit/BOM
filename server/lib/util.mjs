// Petits utilitaires partagés par le serveur.

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isCoord = (lat, lng) => isNum(lat) && isNum(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
export const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
/** Arrondi à 3 décimales (~110 m) : ce que voient les admins. */
export const round3 = (n) => Math.round(n * 1000) / 1000;

export function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Limiteur simple : `max` actions par fenêtre de `windowMs`, par clé. */
export function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (key) => {
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    return n <= max;
  };
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function readBody(req, max = 16 * 1024) {
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

export async function readJson(req, max) {
  try {
    const d = JSON.parse(await readBody(req, max));
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** IP du client : derrière Caddy, c'est X-Forwarded-For. Jamais écrite sur disque. */
export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0]
    .trim();
}

/** "bom/0.0.3 (android)" → { version, platform } */
export function parseClientHeader(v) {
  const m = /^bom\/([\w.-]{1,20}) \((android|ios|web)\)$/.exec(String(v || ''));
  return m ? { version: m[1], platform: m[2] } : { version: '?', platform: '?' };
}
