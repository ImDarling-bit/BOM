import type { ExpoConfig } from 'expo/config';

// URLs injectées au build (variables d'environnement CI). Aucune clé d'API :
// carte MapLibre + OpenStreetMap, localisation sans Google Play Services.
// Version issue du tag Git en CI (toolkit-v1.2.3 → 1.2.3), numéro de build = run CI.
const VERSION = process.env.APP_VERSION || '1.0.0';
const BUILD_NUMBER = Number(process.env.APP_BUILD_NUMBER || 1);

const LOCATION_REASON =
  "Ta position (arrondie à ~100 m) sert à recevoir le chat local et à placer les signalements sur la carte. Elle n'est jamais utilisée en arrière-plan.";

const config: ExpoConfig = {
  name: 'Manifestation Toolkit',
  slug: 'manifestation-toolkit',
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/icon.png',
  // Mode sombre permanent : l'app ignore le thème du système.
  userInterfaceStyle: 'dark',
  backgroundColor: '#121212',
  ios: {
    bundleIdentifier: 'org.manifestationtoolkit.app',
    buildNumber: String(BUILD_NUMBER),
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: LOCATION_REASON,
    },
  },
  android: {
    package: 'org.manifestationtoolkit.app',
    versionCode: BUILD_NUMBER,
    adaptiveIcon: {
      backgroundColor: '#121212',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Uniquement la localisation au premier plan : jamais en arrière-plan.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    blockedPermissions: ['ACCESS_BACKGROUND_LOCATION'],
    // Pas de sauvegarde cloud Android des données locales (anonymat).
    allowBackup: false,
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    // locationEngine "default" = LocationManager d'Android : pas de Google Play Services.
    ['@maplibre/maplibre-react-native', { android: { locationEngine: 'default' } }],
    './plugins/withAndroidReleaseSigning',
  ],
};

export default config;
