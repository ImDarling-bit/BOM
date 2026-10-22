import { Platform } from 'react-native';

import { CONFIG } from '../config';
import type {
  ChatMessage,
  Coords,
  FriendPanic,
  FriendPosition,
  HelpCall,
  HelpTarget,
  Report,
  ReportType,
  Role,
} from '../types';
import { isValidCoord } from '../utils/geo';
import { newId } from '../utils/id';

// Protocole complet : docs/PROTOCOL.md

export type SocketStatus = 'offline' | 'connecting' | 'online';

export interface Identity {
  /** "Pseudo#48F2". L'UUID complet n'est jamais envoyé. */
  name: string;
  role: Role;
}

/** Ce qui est partagé avec les proches : renvoyé à chaque (re)connexion. */
export interface FriendLinks {
  shareCode: string | null;
  follows: string[];
}

type Events = {
  status: SocketStatus;
  message: ChatMessage;
  report: Report;
  reportRemoved: string;
  help: HelpCall;
  helpAck: { id: string; notified: number };
  helpRemoved: string;
  friend: FriendPosition;
  friendPanic: FriendPanic;
  nearby: number | null;
};

type Listener<K extends keyof Events> = (payload: Events[K]) => void;

const ROLES: Role[] = ['user', 'medic', 'supply', 'protection'];
const HELP_TARGETS: HelpTarget[] = [...ROLES, 'all'];
const REPORT_TYPES: ReportType[] = [
  'danger',
  'teargas',
  'medic',
  'supply',
  'test',
  'kettle',
  'safe_zone',
  'danger_zone',
];
const PING_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

/** Identifie l'app auprès du serveur (affiché dans le panneau d'administration). */
export const CLIENT = {
  version: CONFIG.appVersion,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
} as const;
export const CLIENT_HEADER = `bom/${CLIENT.version} (${CLIENT.platform})`;

class ChatSocket {
  private ws: WebSocket | null = null;
  private url = '';
  private identity: Identity | null = null;
  private position: Coords | null = null;
  private links: FriendLinks = { shareCode: null, follows: [] };
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private listeners: { [K in keyof Events]: Set<Listener<K>> } = {
    status: new Set(),
    message: new Set(),
    report: new Set(),
    reportRemoved: new Set(),
    help: new Set(),
    helpAck: new Set(),
    helpRemoved: new Set(),
    friend: new Set(),
    friendPanic: new Set(),
    nearby: new Set(),
  };

  status: SocketStatus = 'offline';
  /** Manifestant·es connecté·es dans le rayon du chat local (null = sans position). */
  nearby: number | null = null;

  on<K extends keyof Events>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => {
      this.listeners[event].delete(cb);
    };
  }

  connect(url: string, identity: Identity, position: Coords | null, links: FriendLinks) {
    this.shutdown();
    this.url = url;
    this.identity = identity;
    this.position = position;
    this.links = links;
    this.stopped = false;
    this.open();
  }

  /** Ferme la connexion et annule toute reconnexion (utilisé par la purge). */
  shutdown() {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onopen = null;
      try {
        this.ws.close();
      } catch {
        // déjà fermé
      }
      this.ws = null;
    }
    this.setNearby(null);
    this.setStatus('offline');
  }

  /** Envoie un message ; renvoie l'objet créé, ou null si hors ligne. */
  sendChat(text: string, role: Role): ChatMessage | null {
    const clean = text.trim().slice(0, CONFIG.maxMessageLength);
    if (!clean || !this.identity) return null;
    const msg: ChatMessage = {
      id: newId(),
      author: this.identity.name,
      role,
      text: clean,
      ts: Date.now(),
      ...(this.position ?? {}),
    };
    return this.send({ type: 'chat', ...msg }) ? msg : null;
  }

  /** Position arrondie utilisée par le serveur pour filtrer le chat local. */
  updatePosition(position: Coords | null) {
    this.position = position;
    this.send({ type: 'position', ...(position ?? { latitude: null, longitude: null }) });
  }

  /** Code de partage et proches suivis. */
  updateLinks(links: FriendLinks) {
    const prev = this.links;
    this.links = links;
    if (prev.shareCode !== links.shareCode) this.send({ type: 'share', code: links.shareCode });
    if (prev.follows.join() !== links.follows.join())
      this.send({ type: 'follow', codes: links.follows });
  }

  /** Position précise, uniquement transmise aux proches qui ont le code. */
  sendFriendPosition(p: Coords) {
    if (this.links.shareCode)
      this.send({ type: 'friend_position', latitude: p.latitude, longitude: p.longitude });
  }

  /** Appel à l'aide : renvoie l'appel créé, ou null si hors ligne. */
  sendHelp(roles: HelpTarget[], position: Coords, note = ''): HelpCall | null {
    if (!this.identity || !roles.length) return null;
    const now = Date.now();
    const help: HelpCall = {
      id: newId(),
      author: this.identity.name,
      role: this.identity.role,
      roles,
      note: note.slice(0, 120),
      latitude: position.latitude,
      longitude: position.longitude,
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000,
    };
    return this.send({ type: 'help', ...help }) ? help : null;
  }

  cancelHelp(id: string) {
    this.send({ type: 'help_cancel', id });
  }

  /**
   * Prévient les proches (et les organisateurs) juste avant une purge.
   * Le message part dans la file du WebSocket, qui est vidée avant la fermeture.
   */
  sendPanic(position: Coords | null) {
    this.send({ type: 'panic', ...(position ?? {}) });
  }

  private send(payload: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private open() {
    this.clearTimers();
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('online');
      this.send({
        type: 'hello',
        name: this.identity?.name,
        role: this.identity?.role,
        radius: CONFIG.radiusMeters,
        client: CLIENT,
        shareCode: this.links.shareCode,
        follows: this.links.follows,
        ...(this.position ?? {}),
      });
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), PING_MS);
    };

    ws.onmessage = (e) => this.handle(e.data);
    ws.onerror = () => {
      // onclose suit toujours : la reconnexion est gérée là.
    };
    ws.onclose = () => {
      this.ws = null;
      this.clearTimers();
      this.setStatus('offline');
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retry) + Math.random() * 500;
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
  }

  private setNearby(n: number | null) {
    if (this.nearby === n) return;
    this.nearby = n;
    this.emit('nearby', n);
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  private emit<K extends keyof Events>(event: K, payload: Events[K]) {
    this.listeners[event].forEach((cb) => cb(payload));
  }

  // Tout ce qui vient du réseau est validé avant d'atteindre l'UI.
  private handle(raw: unknown) {
    if (typeof raw !== 'string' || raw.length > 10_000) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'chat': {
        const msg = parseMessage(data);
        if (msg) this.emit('message', msg);
        break;
      }
      case 'report': {
        const report = parseReport(data.report);
        if (report) this.emit('report', report);
        break;
      }
      case 'report_removed':
        if (typeof data.id === 'string') this.emit('reportRemoved', data.id);
        break;
      case 'help': {
        const help = parseHelp(data.help);
        if (help) this.emit('help', help);
        break;
      }
      case 'help_ack':
        if (typeof data.id === 'string' && typeof data.notified === 'number') {
          this.emit('helpAck', { id: data.id, notified: data.notified });
        }
        break;
      case 'nearby':
        if (data.count === null || typeof data.count === 'number') {
          this.setNearby(data.count as number | null);
        }
        break;
      case 'help_removed':
        if (typeof data.id === 'string') this.emit('helpRemoved', data.id);
        break;
      case 'friend':
        if (
          typeof data.code === 'string' &&
          typeof data.name === 'string' &&
          isValidCoord(data.latitude, data.longitude) &&
          typeof data.ts === 'number'
        ) {
          this.emit('friend', {
            code: data.code,
            name: data.name.slice(0, 40),
            latitude: data.latitude as number,
            longitude: data.longitude as number,
            ts: data.ts,
          });
        }
        break;
      case 'friend_panic':
        if (typeof data.code === 'string' && typeof data.ts === 'number') {
          const has = isValidCoord(data.latitude, data.longitude);
          this.emit('friendPanic', {
            code: data.code,
            name: typeof data.name === 'string' ? data.name.slice(0, 40) : '?',
            latitude: has ? (data.latitude as number) : null,
            longitude: has ? (data.longitude as number) : null,
            ts: data.ts,
          });
        }
        break;
      default:
        break;
    }
  }
}

function parseMessage(d: Record<string, unknown>): ChatMessage | null {
  if (
    typeof d.id !== 'string' ||
    typeof d.author !== 'string' ||
    typeof d.text !== 'string' ||
    typeof d.ts !== 'number' ||
    !ROLES.includes(d.role as Role)
  ) {
    return null;
  }
  const msg: ChatMessage = {
    id: d.id.slice(0, 64),
    author: d.author.slice(0, 40),
    role: d.role as Role,
    text: d.text.slice(0, CONFIG.maxMessageLength),
    ts: d.ts,
  };
  if (isValidCoord(d.latitude, d.longitude)) {
    msg.latitude = d.latitude as number;
    msg.longitude = d.longitude as number;
  }
  return msg;
}

function parseArea(v: unknown): [number, number][] | undefined {
  if (!Array.isArray(v) || v.length < 3 || v.length > 40) return undefined;
  const ring: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || !isValidCoord(p[1], p[0])) return undefined;
    ring.push([p[0] as number, p[1] as number]);
  }
  return ring;
}

export function parseReport(r: unknown): Report | null {
  if (!r || typeof r !== 'object') return null;
  const d = r as Record<string, unknown>;
  if (
    typeof d.id !== 'string' ||
    !REPORT_TYPES.includes(d.type as ReportType) ||
    !isValidCoord(d.latitude, d.longitude) ||
    typeof d.createdAt !== 'number'
  ) {
    return null;
  }
  const area = parseArea(d.area);
  const isArea = d.type === 'kettle' || d.type === 'safe_zone' || d.type === 'danger_zone';
  if (isArea && !area) return null;
  return {
    id: d.id.slice(0, 64),
    type: d.type as ReportType,
    latitude: d.latitude as number,
    longitude: d.longitude as number,
    ...(area ? { area } : {}),
    author: typeof d.author === 'string' ? d.author.slice(0, 40) : '?',
    createdAt: d.createdAt,
    expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : d.createdAt + CONFIG.reportTtlMs,
  };
}

function parseHelp(h: unknown): HelpCall | null {
  if (!h || typeof h !== 'object') return null;
  const d = h as Record<string, unknown>;
  if (
    typeof d.id !== 'string' ||
    typeof d.author !== 'string' ||
    !ROLES.includes(d.role as Role) ||
    !Array.isArray(d.roles) ||
    !isValidCoord(d.latitude, d.longitude) ||
    typeof d.createdAt !== 'number'
  ) {
    return null;
  }
  const roles = d.roles.filter((r): r is HelpTarget => HELP_TARGETS.includes(r as HelpTarget));
  if (!roles.length) return null;
  return {
    id: d.id.slice(0, 64),
    author: d.author.slice(0, 40),
    role: d.role as Role,
    roles,
    note: typeof d.note === 'string' ? d.note.slice(0, 120) : '',
    latitude: d.latitude as number,
    longitude: d.longitude as number,
    createdAt: d.createdAt,
    expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : d.createdAt + 30 * 60 * 1000,
  };
}

/** Instance unique partagée par toute l'app. */
export const chatSocket = new ChatSocket();
