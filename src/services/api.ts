import { CONFIG } from '../config';
import type { Coords, Report, ReportType } from '../types';
import { CLIENT_HEADER, parseReport } from './chatSocket';

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(`${CONFIG.apiUrl}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-BOM-Client': CLIENT_HEADER,
        ...init?.headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** GET /reports?lat=&lng=&radius= */
export async function fetchReports(center: Coords): Promise<Report[]> {
  const q = `lat=${center.latitude}&lng=${center.longitude}&radius=${CONFIG.radiusMeters}`;
  const data = await request(`/reports?${q}`);
  if (!Array.isArray(data)) return [];
  return data.map(parseReport).filter((r): r is Report => r !== null);
}

/** POST /reports — un point, ou une zone (`area`). Renvoie le signalement enregistré. */
export async function createReport(input: {
  type: ReportType;
  position: Coords;
  area?: [number, number][];
  author: string;
}): Promise<Report> {
  const data = await request('/reports', {
    method: 'POST',
    body: JSON.stringify({
      type: input.type,
      latitude: input.position.latitude,
      longitude: input.position.longitude,
      ...(input.area ? { area: input.area } : {}),
      author: input.author,
    }),
  });
  const report = parseReport(data);
  if (!report) throw new Error('Réponse serveur invalide');
  return report;
}
