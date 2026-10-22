// Panneau d'administration BOM. Aucune dépendance hors MapLibre (servi localement).
// Toutes les données venant des téléphones sont insérées en texte (jamais en HTML).

import * as maplibregl from '/admin/vendor/maplibre/maplibre-gl.mjs';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/** Construit un élément ; les chaînes deviennent des nœuds texte. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat())
    if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const ROLES = {
  user: { label: 'manifestant·e', color: '#38d7ff', icon: '✊' },
  medic: { label: 'street medic', color: '#3dff8f', icon: '⛑️' },
  supply: { label: 'ravitaillement', color: '#ffb547', icon: '💧' },
  protection: { label: 'protection', color: '#a78bfa', icon: '🛡️' },
  all: { label: 'tout le monde', color: '#c8d3dc', icon: '📣' },
};
const TYPES = {
  danger: { label: 'danger', icon: '⚠️', color: '#ff4d61' },
  teargas: { label: 'lacrymo', icon: '💨', color: '#c6ff3d' },
  medic: { label: 'soins', icon: '⛑️', color: '#3dff8f' },
  supply: { label: 'ravitaillement', icon: '💧', color: '#38d7ff' },
  test: { label: 'test', icon: '🧪', color: '#a78bfa' },
  kettle: { label: 'nasse', icon: '🚧', color: '#ffb547' },
  safe_zone: { label: 'zone sûre', icon: '🟢', color: '#3dff8f' },
  danger_zone: { label: 'zone de danger', icon: '🔴', color: '#ff4d61' },
};
const role = (r) => ROLES[r] || { label: r, color: '#c8d3dc', icon: '•' };
const type = (t) => TYPES[t] || { label: t, icon: '•', color: '#c8d3dc' };

const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (ts) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}`;
}
const device = (p) => `${p.platform || '?'} ${p.version || '?'}`;

async function api(path, body) {
  const res = await fetch(`/admin/api/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-BOM-Admin': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // réponse vide
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

let ticket = null;

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-form [name=username]').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('#login-error').textContent = '';
  try {
    if (!ticket) {
      const r = await api('login', { username: f.get('username'), password: f.get('password') });
      if (r.totp) {
        ticket = r.ticket;
        $('#step-pass').hidden = true;
        $('#step-totp').hidden = false;
        $('#login-form [name=code]').focus();
        return;
      }
    } else {
      await api('login/totp', { ticket, code: f.get('code') });
    }
    location.reload();
  } catch (err) {
    $('#login-error').textContent = err.message;
    if (ticket && err.status === 401 && /expirée/.test(err.message)) {
      ticket = null;
      $('#step-pass').hidden = false;
      $('#step-totp').hidden = true;
    }
  }
});

// ---------------------------------------------------------------------------
// Panneau
// ---------------------------------------------------------------------------

const state = { snapshot: null, events: [], paused: false, pending: [], me: null };
let map;
const markers = { reports: new Map(), helps: new Map(), purges: new Map() };
const layerOn = { people: true, heat: false, reports: true, areas: true, helps: true, purges: true };

async function boot() {
  try {
    state.me = await api('me');
  } catch {
    return showLogin();
  }
  $('#login').hidden = true;
  $('#app').hidden = false;
  initMap(state.me.mapStyleUrl);
  initUi();
  connect();
  setInterval(() => ($('#clock').textContent = hhmmss(Date.now())), 1000);
}

function initMap(styleUrl) {
  map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: [2.3636, 48.8674],
    zoom: 13,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  map.on('load', () => {
    map.addSource('people', { type: 'geojson', data: fc([]) });
    map.addSource('areas', { type: 'geojson', data: fc([]) });
    map.addLayer({
      id: 'heat',
      type: 'heatmap',
      source: 'people',
      layout: { visibility: 'none' },
      paint: {
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 40],
        'heatmap-intensity': 1.2,
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0,0,0,0)',
          0.2,
          '#0b3d2e',
          0.45,
          '#1fa86a',
          0.7,
          '#ffb547',
          1,
          '#ff4d61',
        ],
      },
    });
    map.addLayer({
      id: 'area-fill',
      type: 'fill',
      source: 'areas',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
    });
    map.addLayer({
      id: 'area-line',
      type: 'line',
      source: 'areas',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 1] },
    });
    map.addLayer({
      id: 'people',
      type: 'circle',
      source: 'people',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#000',
        'circle-stroke-width': 1.5,
        'circle-opacity': ['get', 'fresh'],
      },
    });
    map.addLayer({
      id: 'people-label',
      type: 'symbol',
      source: 'people',
      minzoom: 15,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: { 'text-color': '#c8d3dc', 'text-halo-color': '#000', 'text-halo-width': 1.5 },
    });
    map.on('click', 'people', (e) => {
      const p = e.features[0].properties;
      personPopup(JSON.parse(p.raw)).setLngLat(e.lngLat).addTo(map);
    });
    map.on('mouseenter', 'people', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'people', () => (map.getCanvas().style.cursor = ''));
    if (state.snapshot) render();
  });
}

const fc = (features) => ({ type: 'FeatureCollection', features });

function initUi() {
  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $$('.tab').forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
    }),
  );
  $$('[data-layer]').forEach((c) =>
    c.addEventListener('change', () => {
      layerOn[c.dataset.layer] = c.checked;
      applyLayers();
    }),
  );
  $('#feed-filter').addEventListener('input', renderFeed);
  $('#people-filter').addEventListener('input', renderPeople);
  $('#feed-pause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('#feed-pause').textContent = state.paused ? `reprendre (${state.pending.length})` : 'pause';
    if (!state.paused) {
      state.events.push(...state.pending);
      state.pending = [];
      renderFeed();
    }
  });
  $('#legend').append(
    ...Object.entries(ROLES)
      .filter(([k]) => k !== 'all')
      .map(([, r]) => h('span', {}, h('i', { class: 'dot', style: `background:${r.color}` }), r.label)),
    ...Object.values(TYPES).map((t) => h('span', {}, `${t.icon} ${t.label}`)),
  );
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close').addEventListener('click', () => $('#settings').close());
  $('#btn-logout').addEventListener('click', async () => {
    await api('logout', {}).catch(() => {});
    location.reload();
  });
  initSettings();
}

function applyLayers() {
  if (!map?.isStyleLoaded()) return;
  const vis = (on) => (on ? 'visible' : 'none');
  map.setLayoutProperty('people', 'visibility', vis(layerOn.people));
  map.setLayoutProperty('people-label', 'visibility', vis(layerOn.people));
  map.setLayoutProperty('heat', 'visibility', vis(layerOn.heat));
  map.setLayoutProperty('area-fill', 'visibility', vis(layerOn.areas));
  map.setLayoutProperty('area-line', 'visibility', vis(layerOn.areas));
  for (const [kind, on] of [
    ['reports', layerOn.reports],
    ['helps', layerOn.helps],
    ['purges', layerOn.purges],
  ]) {
    for (const m of markers[kind].values()) m.getElement().style.display = on ? '' : 'none';
  }
}

// --- Flux temps réel -----------------------------------------------------------------

let retry = 0;
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/admin/ws`);
  ws.onopen = () => {
    retry = 0;
    $('#link').className = 'link on';
    $('#link').textContent = '● en direct';
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      state.events = msg.events;
      renderFeed();
    } else if (msg.type === 'snapshot') {
      state.snapshot = msg;
      render();
    } else if (msg.type === 'event') {
      onEvent(msg.event);
    }
  };
  ws.onclose = (e) => {
    $('#link').className = 'link off';
    $('#link').textContent = '● hors ligne';
    if (e.code === 4401) return location.reload();
    setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++));
  };
}

function onEvent(e) {
  if (state.paused) {
    state.pending.push(e);
    $('#feed-pause').textContent = `reprendre (${state.pending.length})`;
  } else {
    state.events.push(e);
    if (state.events.length > 1000) state.events.shift();
    prependFeed(e);
  }
  const geo = geoOf(e);
  if ((e.kind === 'help' || e.kind === 'purge') && geo && $('#auto-fly').checked) {
    map?.flyTo({ center: [geo.longitude, geo.latitude], zoom: Math.max(map.getZoom(), 16) });
  }
}

function geoOf(e) {
  const g = e.report || e.help || e.purge || e;
  return typeof g.latitude === 'number' && typeof g.longitude === 'number' ? g : null;
}

function describe(e) {
  switch (e.kind) {
    case 'join':
      return [`${e.name}`, ` ${role(e.role).label} · ${e.platform} ${e.version}`];
    case 'leave':
      return [`${e.name}`, ' déconnecté·e'];
    case 'chat':
      return [`${e.name} `, `« ${e.text} »`];
    case 'report': {
      const r = e.report;
      const zone = r.area ? ` · zone ${r.area.length} sommets` : '';
      return [
        `${r.author} `,
        `→ ${type(r.type).icon} ${type(r.type).label}${zone} · via ${e.via?.channel} ${e.via?.platform} ${e.via?.version}`,
      ];
    }
    case 'report_removed':
      return [`${type(e.reportType).label} `, `retiré (${e.by})`];
    case 'help':
      return [
        `${e.help.author} `,
        `demande : ${e.help.roles.map((r) => role(r).label).join(', ')}${e.help.note ? ` « ${e.help.note} »` : ''} · ${e.notified} alerté·es`,
      ];
    case 'help_removed':
      return [`appel de ${e.author} `, e.reason];
    case 'purge':
      return [
        `${e.purge.name || '(anonyme)'} `,
        `a PURGÉ son téléphone · ${e.purge.friends} proche(s) alerté(s)`,
      ];
    default:
      return [e.kind, ''];
  }
}

const KIND_LABEL = {
  join: 'arrivée',
  leave: 'départ',
  chat: 'chat',
  report: 'signal',
  report_removed: 'retrait',
  help: 'AIDE',
  help_removed: 'aide',
  purge: 'PURGE',
};

function feedItem(e) {
  const [who, what] = describe(e);
  const geo = geoOf(e);
  return h(
    'li',
    {
      class: `k-${e.kind}`,
      dataset: geo ? { geo: `${geo.longitude},${geo.latitude}` } : {},
      onclick: geo ? () => map.flyTo({ center: [geo.longitude, geo.latitude], zoom: 17 }) : undefined,
    },
    h('time', {}, hhmmss(e.ts)),
    h('span', { class: `k k-${e.kind}` }, KIND_LABEL[e.kind] || e.kind),
    ' ',
    h('span', { class: 'txt' }, who),
    h('span', { class: 'meta' }, what),
  );
}

function matches(e, q) {
  if (!q) return true;
  return `${KIND_LABEL[e.kind]} ${describe(e).join('')}`.toLowerCase().includes(q);
}

function renderFeed() {
  const q = $('#feed-filter').value.trim().toLowerCase();
  const list = state.events
    .filter((e) => matches(e, q))
    .slice(-500)
    .reverse();
  $('#feed').replaceChildren(...list.map(feedItem));
}

function prependFeed(e) {
  const q = $('#feed-filter').value.trim().toLowerCase();
  if (!matches(e, q)) return;
  const feed = $('#feed');
  feed.prepend(feedItem(e));
  while (feed.children.length > 500) feed.lastChild.remove();
}

// --- Rendu de l'instantané -----------------------------------------------------------------

function render() {
  const s = state.snapshot;
  if (!s) return;
  renderStats(s);
  renderPeople();
  renderReports();
  renderAlerts();
  if (!map?.isStyleLoaded() || !map.getSource('people')) return;

  const now = s.now;
  map.getSource('people').setData(
    fc(
      s.people
        .filter((p) => p.latitude !== null)
        .map((p) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
          properties: {
            name: p.name,
            color: role(p.role).color,
            fresh: now - p.lastSeen < 60_000 ? 1 : 0.45,
            raw: JSON.stringify(p),
          },
        })),
    ),
  );
  map.getSource('areas').setData(
    fc(
      s.reports
        .filter((r) => r.area)
        .map((r) => ({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[...r.area, r.area[0]]] },
          properties: { color: type(r.type).color },
        })),
    ),
  );

  syncMarkers(
    'reports',
    s.reports,
    (r) => r.id,
    (r) => {
      const el = h('div', { class: 'mk', title: `${type(r.type).label} — ${r.author}` }, type(r.type).icon);
      return { el, popup: () => reportPopup(r) };
    },
  );
  syncMarkers(
    'helps',
    s.helps,
    (x) => x.id,
    (x) => ({
      el: h('div', { class: 'mk-help', title: `aide — ${x.author}` }, '🆘'),
      popup: () => helpPopup(x),
    }),
  );
  syncMarkers(
    'purges',
    s.purges.filter((p) => p.latitude !== null),
    (p) => p.id,
    (p) => ({
      el: h('div', { class: 'mk-purge', title: `purge — ${p.name}` }, '⛔'),
      popup: () => purgePopup(p),
    }),
  );
  applyLayers();
}

function syncMarkers(kind, items, key, build) {
  const store = markers[kind];
  const seen = new Set();
  for (const it of items) {
    const k = key(it);
    seen.add(k);
    if (store.has(k)) continue;
    const { el, popup } = build(it);
    const m = new maplibregl.Marker({ element: el }).setLngLat([it.longitude, it.latitude]).addTo(map);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      popup().setLngLat([it.longitude, it.latitude]).addTo(map);
    });
    store.set(k, m);
  }
  for (const [k, m] of store) {
    if (!seen.has(k)) {
      m.remove();
      store.delete(k);
    }
  }
}

const popup = (...lines) =>
  new maplibregl.Popup({ closeButton: true, maxWidth: '320px' }).setDOMContent(
    h('div', { class: 'pop' }, ...lines),
  );
const line = (k, v) => h('div', {}, h('span', { class: 'dim' }, `${k} `), v);

function personPopup(p) {
  return popup(
    h('b', {}, p.name),
    line('rôle', `${role(p.role).icon} ${role(p.role).label}`),
    line('appareil', device(p)),
    line('connecté·e depuis', ago(p.connectedAt)),
    line('dernier signe', `il y a ${ago(p.lastSeen)}`),
    line('position', `${p.latitude}, ${p.longitude} (±110 m)`),
    line('partage avec ses proches', p.sharing ? 'oui' : 'non'),
    line('suit', `${p.follows} proche(s)`),
  );
}
function reportPopup(r) {
  return popup(
    h('b', {}, `${type(r.type).icon} ${type(r.type).label}`),
    line('par', r.author),
    line('posé', `il y a ${ago(r.createdAt)}`),
    line('expire dans', ago(Date.now(), r.expiresAt)),
    r.area ? line('zone', `${r.area.length} sommets`) : null,
    line('position', `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`),
  );
}
function helpPopup(x) {
  return popup(
    h('b', {}, `🆘 ${x.author}`),
    line('rôle', role(x.role).label),
    line('demande', x.roles.map((r) => role(r).label).join(', ')),
    x.note ? line('note', x.note) : null,
    line('depuis', ago(x.createdAt)),
  );
}
function purgePopup(p) {
  return popup(
    h('b', {}, `⛔ ${p.name || '(anonyme)'}`),
    line('rôle', role(p.role).label),
    line('purge', `${hhmmss(p.ts)} (il y a ${ago(p.ts)})`),
    line('proches alertés', String(p.friends)),
    line('position', `${p.latitude}, ${p.longitude} (±110 m)`),
  );
}

function renderStats(s) {
  const minuteAgo = Date.now() - 60_000;
  const perMin = state.events.filter((e) => e.kind === 'chat' && e.ts > minuteAgo).length;
  const located = s.people.filter((p) => p.latitude !== null).length;
  const areas = s.reports.filter((r) => r.area).length;
  const up = ago(s.stats.started, s.now);
  const items = [
    ['connectés', s.stats.identified],
    ['localisés', located],
    ['signalements', s.reports.length - areas],
    ['zones', areas],
    ['aide active', s.helps.length, s.helps.length > 0],
    ['purges', s.stats.purges, s.stats.purges > 0],
    ['msg/min', perMin],
    ['msg total', s.stats.chat],
    ['uptime', up],
  ];
  $('#stats').replaceChildren(
    ...items.map(([k, v, hot]) => h('span', { class: `stat${hot ? ' hot' : ''}` }, k, h('b', {}, v))),
  );
  $('#n-people').textContent = s.stats.identified;
  $('#n-reports').textContent = s.reports.length;
  $('#n-alerts').textContent = s.helps.length + s.purges.length;
}

function renderPeople() {
  const s = state.snapshot;
  if (!s) return;
  const q = $('#people-filter').value.trim().toLowerCase();
  const rows = s.people
    .filter((p) => !q || `${p.name} ${role(p.role).label} ${device(p)}`.toLowerCase().includes(q))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((p) =>
      h(
        'tr',
        {
          onclick: () => {
            if (p.latitude === null) return;
            map.flyTo({ center: [p.longitude, p.latitude], zoom: 17 });
            personPopup(p).setLngLat([p.longitude, p.latitude]).addTo(map);
          },
        },
        h(
          'td',
          { class: p.latitude === null ? 'nopos' : '' },
          p.name,
          h('div', { class: 'sub' }, p.latitude === null ? 'sans position' : `${p.latitude}, ${p.longitude}`),
        ),
        h(
          'td',
          {},
          h('i', { class: 'dot', style: `background:${role(p.role).color}` }),
          role(p.role).label,
          p.sharing ? h('div', { class: 'sub' }, '↔ proches') : null,
        ),
        h('td', {}, device(p)),
        h('td', {}, ago(p.lastSeen, s.now)),
      ),
    );
  $('#people').replaceChildren(
    ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'personne'))]),
  );
}

function renderReports() {
  const s = state.snapshot;
  const rows = [...s.reports]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) =>
      h(
        'tr',
        { onclick: () => map.flyTo({ center: [r.longitude, r.latitude], zoom: 17 }) },
        h('td', {}, `${type(r.type).icon} ${type(r.type).label}`),
        h('td', {}, r.author),
        h('td', {}, ago(r.createdAt, s.now), h('div', { class: 'sub' }, `expire ${ago(s.now, r.expiresAt)}`)),
        h(
          'td',
          {},
          h(
            'button',
            {
              class: 'danger',
              title: 'Retirer ce signalement pour tout le monde',
              onclick: async (ev) => {
                ev.stopPropagation();
                if (!confirm(`Retirer « ${type(r.type).label} » de ${r.author} ?`)) return;
                await api(`reports/${encodeURIComponent(r.id)}/delete`, {}).catch((err) =>
                  alert(err.message),
                );
              },
            },
            'retirer',
          ),
        ),
      ),
    );
  $('#reports').replaceChildren(
    ...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 4, class: 'empty' }, 'aucun signalement'))]),
  );
}

function renderAlerts() {
  const s = state.snapshot;
  const helps = s.helps.map((x) =>
    h(
      'li',
      { class: 'help', onclick: () => map.flyTo({ center: [x.longitude, x.latitude], zoom: 17 }) },
      h('div', { class: 'title' }, `🆘 ${x.author}`),
      h('div', {}, `demande : ${x.roles.map((r) => role(r).label).join(', ')}`),
      x.note ? h('div', {}, `« ${x.note} »`) : null,
      h('div', { class: 'dim' }, `il y a ${ago(x.createdAt, s.now)}`),
      h(
        'button',
        {
          onclick: async (ev) => {
            ev.stopPropagation();
            await api(`helps/${encodeURIComponent(x.id)}/close`, {}).catch((err) => alert(err.message));
          },
        },
        'clore',
      ),
    ),
  );
  const purges = [...s.purges]
    .reverse()
    .map((p) =>
      h(
        'li',
        {
          class: 'purge',
          onclick: () => p.latitude !== null && map.flyTo({ center: [p.longitude, p.latitude], zoom: 17 }),
        },
        h('div', { class: 'title' }, `⛔ ${p.name || '(anonyme)'}`),
        h('div', {}, `${role(p.role).label} · ${p.friends} proche(s) alerté(s)`),
        h(
          'div',
          { class: 'dim' },
          `${hhmmss(p.ts)} · ${p.latitude === null ? 'position inconnue' : `${p.latitude}, ${p.longitude}`}`,
        ),
      ),
    );
  $('#helps').replaceChildren(
    ...(helps.length ? helps : [h('li', { class: 'empty' }, 'aucun appel en cours')]),
  );
  $('#purges').replaceChildren(...(purges.length ? purges : [h('li', { class: 'empty' }, 'aucune purge')]));
}

// --- Compte et sécurité -------------------------------------------------------------------------

function settingsMsg(text, ok = false) {
  $('#settings-msg').textContent = text;
  $('#settings-msg').className = ok ? 'ok' : 'err';
}

async function openSettings() {
  settingsMsg('');
  state.me = await api('me').catch(() => state.me);
  $('#me').textContent = state.me.username;
  const on = state.me.totpEnabled;
  $('#totp-state').textContent = on
    ? 'Active : un code à 6 chiffres est demandé à chaque connexion.'
    : 'Inactive. Fortement recommandée : sans elle, un mot de passe volé suffit.';
  $('#totp-state').className = on ? 'ok' : 'err';
  $('#totp-start').hidden = on;
  $('#totp-disable').hidden = !on;
  $('#totp-setup').hidden = true;
  const audit = await api('audit').catch(() => []);
  $('#audit').replaceChildren(
    ...audit.map((a) =>
      h(
        'li',
        {},
        h('time', {}, new Date(a.ts).toLocaleString('fr-FR')),
        ' ',
        h('span', { class: 'txt' }, a.username || '?'),
        h('span', { class: 'meta' }, ` ${a.action}${a.detail ? ` (${a.detail})` : ''}`),
      ),
    ),
  );
  $('#settings').showModal();
}

function initSettings() {
  $('#totp-start').addEventListener('click', async () => {
    try {
      const r = await api('2fa/setup', {});
      // SVG généré par notre serveur (bibliothèque qrcode), pas par un téléphone.
      $('#qr').innerHTML = r.qr;
      $('#totp-secret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
      $('#totp-setup').hidden = false;
      $('#totp-start').hidden = true;
      $('#totp-enable [name=code]').focus();
    } catch (err) {
      settingsMsg(err.message);
    }
  });
  $('#totp-enable').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('2fa/enable', { code: new FormData(e.target).get('code') });
      settingsMsg('Double authentification activée.', true);
      e.target.reset();
      await openSettings();
      settingsMsg('Double authentification activée.', true);
    } catch (err) {
      settingsMsg(err.message);
    }
  });
  $('#totp-disable').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('2fa/disable', { password: f.get('password'), code: f.get('code') });
      e.target.reset();
      await openSettings();
      settingsMsg('Double authentification désactivée.', true);
    } catch (err) {
      settingsMsg(err.message);
    }
  });
  $('#pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('password', { current: f.get('current'), next: f.get('next') });
      e.target.reset();
      settingsMsg('Mot de passe changé. Les autres sessions sont fermées.', true);
    } catch (err) {
      settingsMsg(err.message);
    }
  });
}

boot();
