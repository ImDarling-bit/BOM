import { LocationManager } from '@maplibre/maplibre-react-native';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

import type { Coords } from '../types';
import { toShared } from '../utils/geo';

type Permission = 'unknown' | 'granted' | 'denied';

interface LocationValue {
  /** Position précise : reste sur le téléphone (affichage de la carte). */
  coords: Coords | null;
  /** Position arrondie : la seule qui est envoyée aux serveurs. */
  shared: Coords | null;
  permission: Permission;
}

const LocationContext = createContext<LocationValue>({
  coords: null,
  shared: null,
  permission: 'unknown',
});

/**
 * `enabled` : le GPS est utilisé (carte, proches).
 * `share` : la position arrondie est envoyée au serveur (chat local, carte).
 */
export function LocationProvider({
  enabled,
  share,
  children,
}: {
  enabled: boolean;
  share: boolean;
  children: ReactNode;
}) {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [permission, setPermission] = useState<Permission>('unknown');

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // Localisation fournie par MapLibre : LocationManager d'Android / CoreLocation d'iOS,
    // sans Google Play Services.
    const onUpdate = (loc: GeoPosition) => {
      if (alive) setCoords(pick(loc));
    };

    (async () => {
      const granted = await requestPermission();
      if (!alive) return;
      if (!granted) {
        setPermission('denied');
        return;
      }
      setPermission('granted');
      LocationManager.setMinDisplacement(30);
      const last = await LocationManager.getCurrentPosition();
      if (alive && last) setCoords(pick(last));
      if (alive) LocationManager.addListener(onUpdate);
    })().catch(() => setPermission('denied'));

    return () => {
      alive = false;
      LocationManager.removeListener(onUpdate);
    };
  }, [enabled]);

  // GPS désactivé : aucune position n'est exposée, même en mémoire.
  const visibleCoords = enabled ? coords : null;
  const shared = useMemo(() => (share ? toShared(visibleCoords) : null), [share, visibleCoords]);
  // On ne recrée la valeur partagée que si la position arrondie change,
  // pour éviter de spammer le serveur à chaque petit déplacement.
  const sharedKey = shared ? `${shared.latitude},${shared.longitude}` : '';
  const stableShared = useMemo(() => shared, [sharedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(
    () => ({ coords: visibleCoords, shared: stableShared, permission }),
    [visibleCoords, stableShared, permission]
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

type GeoPosition = { coords: { latitude: number; longitude: number } };

const pick = (l: GeoPosition): Coords => ({
  latitude: l.coords.latitude,
  longitude: l.coords.longitude,
});

/** Position « au premier plan » uniquement. Android : la position approximative suffit. */
async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ]);
    return Object.values(res).includes(PermissionsAndroid.RESULTS.GRANTED);
  }
  return LocationManager.requestPermissions();
}

export const useLocation = () => useContext(LocationContext);
