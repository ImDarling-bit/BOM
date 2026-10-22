// URLs des serveurs privés et version. Définies au build via EXPO_PUBLIC_*
// (voir README), avec des valeurs par défaut factices pour le développement.
const MAP_STYLE = process.env.EXPO_PUBLIC_MAP_STYLE_URL || '';

export const CONFIG = {
  wsUrl: process.env.EXPO_PUBLIC_WS_URL || 'wss://chat.example.org/ws',
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.example.org',
  /** Styles de carte MapLibre (tuiles OpenStreetMap). Gratuits, sans clé ; auto-hébergeables. */
  mapStyle: {
    dark: MAP_STYLE || 'https://tiles.openfreemap.org/styles/dark',
    light: MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron',
  },
  /** Version publiée (tag Git `vX.Y.Z`), injectée par le GitHub Action. */
  appVersion: process.env.EXPO_PUBLIC_APP_VERSION || '0.0.0',
  /** Dépôt GitHub où chercher les nouvelles versions ("" = vérification désactivée). */
  updateRepo: process.env.EXPO_PUBLIC_UPDATE_REPO ?? '',

  /** Rayon du chat local et des signalements, en mètres. */
  radiusMeters: 2000,
  /** Décimales conservées sur les coordonnées partagées : 3 ≈ 110 m. */
  sharedCoordDecimals: 3,
  /** Durée de vie d'un signalement sur la carte. */
  reportTtlMs: 60 * 60 * 1000,
  /** Largeur de la bande dessinée pour une nasse, en mètres. */
  kettleWidthMeters: 30,
  /** Messages gardés en cache local. */
  maxCachedMessages: 200,
  maxMessageLength: 500,
  /** Durée d'appui pour déclencher la purge d'urgence. */
  panicHoldMs: 800,
  requestTimeoutMs: 8000,
} as const;

/** Position de repli si la localisation est refusée (Paris, place de la République). */
export const FALLBACK_COORDS = { latitude: 48.8674, longitude: 2.3636 };
