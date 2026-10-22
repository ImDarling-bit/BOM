import type { IconName } from '../components/Icon';
import type { AreaType, HelpTarget, PointType, ReportType, Role } from '../types';

export const ROLES: { id: Role; label: string; icon: IconName }[] = [
  { id: 'user', label: 'Manifestant·e', icon: 'fist' },
  { id: 'medic', label: 'Street medic', icon: 'medic' },
  { id: 'supply', label: 'Ravitaillement', icon: 'supply' },
  { id: 'protection', label: 'Protection', icon: 'protection' },
];

export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;
export const roleIcon = (r: Role): IconName => ROLES.find((x) => x.id === r)?.icon ?? 'fist';

export const HELP_TARGETS: { id: HelpTarget; label: string; icon: IconName }[] = [
  { id: 'medic', label: 'Street medic', icon: 'medic' },
  { id: 'supply', label: 'Ravitaillement', icon: 'supply' },
  { id: 'protection', label: 'Protection', icon: 'protection' },
  { id: 'all', label: 'Tout le monde', icon: 'all' },
];

export const helpTargetLabel = (t: HelpTarget) => HELP_TARGETS.find((x) => x.id === t)?.label ?? t;

export interface ReportMeta {
  id: ReportType;
  label: string;
  icon: IconName;
  color: string;
  /** point = sous le viseur ; line = début + fin de rue ; area = zone libre. */
  draw: 'point' | 'line' | 'area';
  hint: string;
}

// Couleurs fixes : elles doivent rester reconnaissables quel que soit le thème.
export const POINT_TYPES: (ReportMeta & { id: PointType })[] = [
  {
    id: 'danger',
    label: 'Danger',
    icon: 'danger',
    color: '#E53935',
    draw: 'point',
    hint: 'Charge, violence, risque immédiat',
  },
  {
    id: 'teargas',
    label: 'Lacrymo',
    icon: 'teargas',
    color: '#9CCC00',
    draw: 'point',
    hint: 'Gaz lacrymogène tiré ici',
  },
  {
    id: 'medic',
    label: 'Soins',
    icon: 'medic',
    color: '#00C853',
    draw: 'point',
    hint: 'Point de soins, street medics',
  },
  {
    id: 'supply',
    label: 'Ravitaillement',
    icon: 'supply',
    color: '#0091EA',
    draw: 'point',
    hint: 'Eau, nourriture, sérum',
  },
  {
    id: 'test',
    label: 'Test',
    icon: 'test',
    color: '#8E24AA',
    draw: 'point',
    hint: 'Point d’essai (expire en 30 min)',
  },
];

export const AREA_TYPES: (ReportMeta & { id: AreaType })[] = [
  {
    id: 'kettle',
    label: 'Nasse',
    icon: 'kettle',
    color: '#FF8F00',
    draw: 'line',
    hint: 'Touche le début puis la fin de la rue nassée',
  },
  {
    id: 'safe_zone',
    label: 'Zone sûre',
    icon: 'safeZone',
    color: '#00C853',
    draw: 'area',
    hint: 'Touche la carte pour dessiner la zone',
  },
  {
    id: 'danger_zone',
    label: 'Zone de danger',
    icon: 'dangerZone',
    color: '#E53935',
    draw: 'area',
    hint: 'Touche la carte pour dessiner la zone',
  },
];

export const REPORT_TYPES: ReportMeta[] = [...POINT_TYPES, ...AREA_TYPES];

export const reportMeta = (t: ReportType): ReportMeta =>
  REPORT_TYPES.find((x) => x.id === t) ?? REPORT_TYPES[0];

/** Messages pré-écrits : un seul tap, zéro saisie sous stress. */
export const QUICK_MESSAGES = [
  'Besoin de soins ici',
  'Nasse en cours',
  'Gaz lacrymo',
  'Eau / ravito dispo',
  'Sortie possible par ici',
  'RAS, tout va bien',
];

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h ${String(m % 60).padStart(2, '0')}`;
}
