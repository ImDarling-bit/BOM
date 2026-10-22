// Thème : clair ou sombre selon le téléphone, couleur d'accent au choix
// (jaune par défaut, n'importe quelle couleur, ou un thème drapeau).
// Les contrastes sont recalculés pour que le texte reste lisible quelle que
// soit la couleur choisie.

export type Scheme = 'light' | 'dark';

export interface Colors {
  bg: string;
  surface: string;
  surfaceHigh: string;
  border: string;
  text: string;
  textMuted: string;
  /** Couleur d'accent en fond (boutons principaux, sélection). */
  primary: string;
  /** Texte posé sur `primary`. */
  onPrimary: string;
  /** Accent utilisé comme texte ou bordure sur le fond : contraste garanti. */
  accent: string;
  danger: string;
  onDanger: string;
  success: string;
  warning: string;
  info: string;
  /** Panneaux posés sur la carte. */
  overlay: string;
  shadow: string;
}

const BASE: Record<Scheme, Omit<Colors, 'primary' | 'onPrimary' | 'accent'>> = {
  dark: {
    bg: '#121212',
    surface: '#1E1E1E',
    surfaceHigh: '#2A2A2A',
    border: '#3D3D3D',
    text: '#FFFFFF',
    textMuted: '#BDBDBD',
    danger: '#C62828',
    onDanger: '#FFFFFF',
    success: '#00E676',
    warning: '#FF9100',
    info: '#40C4FF',
    overlay: 'rgba(18,18,18,0.94)',
    shadow: '#000000',
  },
  light: {
    bg: '#F3F3F1',
    surface: '#FFFFFF',
    surfaceHigh: '#E0E0DB',
    border: '#CFCFCB',
    text: '#111111',
    textMuted: '#505050',
    danger: '#C62828',
    onDanger: '#FFFFFF',
    success: '#1B873F',
    warning: '#B35900',
    info: '#0B6BA8',
    overlay: 'rgba(255,255,255,0.96)',
    shadow: '#000000',
  },
};

export interface FlagTheme {
  id: string;
  label: string;
  accent: string;
  /** Bandes horizontales du drapeau, affichées en liseré sous les en-têtes et la barre d'onglets. */
  stripes: string[];
  /** Triangle côté hampe (drapeau palestinien). */
  triangle?: string;
}

export const DEFAULT_ACCENT = '#FFD600';

export const FLAG_THEMES: FlagTheme[] = [
  { id: 'default', label: 'Jaune', accent: DEFAULT_ACCENT, stripes: [] },
  {
    id: 'palestine',
    label: 'Palestine',
    accent: '#009736',
    stripes: ['#000000', '#FFFFFF', '#009736'],
    triangle: '#EE2A35',
  },
  {
    id: 'pride',
    label: 'Fierté LGBT',
    accent: '#FF8C00',
    stripes: ['#E40303', '#FF8C00', '#FFED00', '#008026', '#24408E', '#732982'],
  },
  {
    id: 'trans',
    label: 'Trans',
    accent: '#5BCEFA',
    stripes: ['#5BCEFA', '#F5A9B8', '#FFFFFF', '#F5A9B8', '#5BCEFA'],
  },
  {
    id: 'bi',
    label: 'Bi',
    accent: '#D60270',
    stripes: ['#D60270', '#D60270', '#9B4F96', '#0038A8', '#0038A8'],
  },
  {
    id: 'nonbinary',
    label: 'Non-binaire',
    accent: '#9C59D1',
    stripes: ['#FCF434', '#FFFFFF', '#9C59D1', '#2C2C2C'],
  },
  {
    id: 'lesbian',
    label: 'Lesbienne',
    accent: '#D362A4',
    stripes: ['#D52D00', '#FF9A56', '#FFFFFF', '#D362A4', '#A30262'],
  },
  { id: 'pan', label: 'Pan', accent: '#FF218C', stripes: ['#FF218C', '#FFD800', '#21B1FF'] },
  {
    id: 'ace',
    label: 'Asexuel·le',
    accent: '#810081',
    stripes: ['#000000', '#A3A3A3', '#FFFFFF', '#810081'],
  },
  { id: 'antifa', label: 'Rouge & noir', accent: '#E53935', stripes: ['#E53935', '#000000'] },
  {
    id: 'feminist',
    label: 'Féministe',
    accent: '#8E44AD',
    stripes: ['#8E44AD', '#C39BD3', '#8E44AD'],
  },
  {
    id: 'ecology',
    label: 'Écologie',
    accent: '#43A047',
    stripes: ['#1B5E20', '#43A047', '#A5D6A7'],
  },
];

/** Couleurs proposées pour l'accent personnalisé (en plus de la saisie libre). */
export const SWATCHES = [
  '#FFD600',
  '#FF9100',
  '#FF5252',
  '#E91E63',
  '#D500F9',
  '#7C4DFF',
  '#448AFF',
  '#00B0FF',
  '#00E5FF',
  '#1DE9B6',
  '#00E676',
  '#C6FF00',
];

// --- Calculs de couleur ---------------------------------------------------------

/** "#abc" ou "abc123" → "#AABBCC" ; null si invalide. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s))
    return `#${s
      .split('')
      .map((c) => c + c)
      .join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toUpperCase();
  return null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function mix(a: string, b: string, t: number): string {
  const [ra, ga, ba] = rgb(a);
  const [rb, gb, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(ra, rb)}${c(ga, gb)}${c(ba, bb)}`.toUpperCase();
}

/** Texte noir ou blanc, le plus lisible sur `bg`. */
export const readableOn = (bg: string) =>
  contrast(bg, '#000000') >= contrast(bg, '#FFFFFF') ? '#000000' : '#FFFFFF';

/** Éclaircit ou assombrit `fg` jusqu'à un contraste suffisant sur `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const toward = luminance(bg) < 0.5 ? '#FFFFFF' : '#000000';
  for (let t = 0.1; t <= 1; t += 0.1) {
    const c = mix(fg, toward, t);
    if (contrast(c, bg) >= min) return c;
  }
  return toward;
}

export interface Theme {
  scheme: Scheme;
  colors: Colors;
  flag: FlagTheme;
}

export function buildTheme(scheme: Scheme, themeId: string, customAccent: string | null): Theme {
  const flag =
    themeId === 'custom'
      ? {
          id: 'custom',
          label: 'Personnalisé',
          accent: normalizeHex(customAccent ?? '') ?? DEFAULT_ACCENT,
          stripes: [],
        }
      : (FLAG_THEMES.find((f) => f.id === themeId) ?? FLAG_THEMES[0]);
  const base = BASE[scheme];
  const accent = ensureContrast(flag.accent, base.bg, 3.5);
  return {
    scheme,
    flag,
    colors: {
      ...base,
      // Sur fond clair, un jaune pur est illisible en texte mais parfait en bouton.
      primary: flag.accent,
      onPrimary: readableOn(flag.accent),
      accent,
    },
  };
}

// --- Mesures fixes ------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const touch = {
  // Hauteur minimale de toute cible tactile (règle du projet).
  min: 56,
  // Actions principales : encore plus grandes.
  primary: 64,
} as const;

export const font = {
  body: 18,
  large: 21,
  title: 28,
  small: 15,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 22,
  pill: 999,
} as const;

/** Ombre douce pour les panneaux flottants. */
export const elevation = (c: Colors, level = 1) => ({
  shadowColor: c.shadow,
  shadowOpacity: 0.1 + level * 0.04,
  shadowRadius: 4 + level * 4,
  shadowOffset: { width: 0, height: 1 + level },
  elevation: 1 + level * 2,
});
