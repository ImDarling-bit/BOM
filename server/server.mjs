// Serveur BOM (Boîte à Outils de Manifestation)
//  - /ws        WebSocket des téléphones (chat, aide, proches, purges)
//  - /reports   API REST de la carte
//  - /admin     panneau d'administration web
// Protocole : ../docs/PROTOCOL.md

import { createServer } from 'node:http';

import { createAdmin } from './lib/admin.mjs';
import { DB_PATH } from './lib/db.mjs';
import { createHub } from './lib/hub.mjs';
import { sendJson } from './lib/util.mjs';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (await hub.handleRest(req, res, url)) return;
    if (await admin.handle(req, res, url)) return;
    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: 'erreur serveur' });
  }
});

const hub = createHub(server);
const admin = createAdmin(hub);

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws')
    hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit('connection', ws, req));
  else if (pathname === '/admin/ws') admin.upgrade(req, socket, head);
  else socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`BOM : http://${HOST}:${PORT} (app : /ws et /reports, admin : /admin, base : ${DB_PATH})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    hub.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
