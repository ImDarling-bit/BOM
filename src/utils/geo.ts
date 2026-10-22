import { CONFIG } from '../config';
import type { Coords } from '../types';

/** Arrondit une position avant de l'envoyer au serveur (~110 m avec 3 décimales). */
export function toShared(c: Coords | null): Coords | null {
  if (!c) return null;
  const f = 10 ** CONFIG.sharedCoordDecimals;
  return {
    latitude: Math.round(c.latitude * f) / f,
    longitude: Math.round(c.longitude * f) / f,
  };
}

/** Distance en mètres (formule de haversine). */
export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 150) return 'tout près';
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

type LngLat = [number, number];

/**
 * Bande rectangulaire de `widthM` mètres de large entre deux points d'une rue
 * (début et fin de la nasse). Renvoie 4 sommets [longitude, latitude].
 */
export function streetBand(a: LngLat, b: LngLat, widthM: number): LngLat[] {
  const lat0 = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(lat0);
  // Vecteur a→b en mètres, puis sa perpendiculaire normalisée.
  const dx = (b[0] - a[0]) * mPerDegLng;
  const dy = (b[1] - a[1]) * mPerDegLat;
  const len = Math.hypot(dx, dy) || 1;
  const ox = ((-dy / len) * widthM) / 2 / mPerDegLng;
  const oy = ((dx / len) * widthM) / 2 / mPerDegLat;
  return [
    [a[0] + ox, a[1] + oy],
    [b[0] + ox, b[1] + oy],
    [b[0] - ox, b[1] - oy],
    [a[0] - ox, a[1] - oy],
  ];
}

/** Centre approximatif d'une zone (moyenne des sommets). */
export function centroid(ring: LngLat[]): Coords {
  return {
    latitude: ring.reduce((s, p) => s + p[1], 0) / ring.length,
    longitude: ring.reduce((s, p) => s + p[0], 0) / ring.length,
  };
}
