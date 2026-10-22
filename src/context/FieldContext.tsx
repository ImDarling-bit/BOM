import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { chatSocket } from '../services/chatSocket';
import type { Coords, FriendPanic, FriendPosition, HelpCall, HelpTarget } from '../types';
import { distanceMeters, formatDistance } from '../utils/geo';
import { success, warning } from '../utils/haptics';
import { helpTargetLabel, roleLabel } from '../utils/labels';
import { useAlerts } from './AlertsContext';
import { useApp } from './AppContext';
import { useLocation } from './LocationContext';

interface MyHelp extends HelpCall {
  /** Nombre de personnes prévenues, connu après l'accusé de réception du serveur. */
  notified: number | null;
}

interface FieldValue {
  /** Appels à l'aide reçus (encore actifs). */
  helps: HelpCall[];
  /** Mon appel en cours. */
  myHelp: MyHelp | null;
  /** Dernière position connue de chaque proche, par code. */
  friends: Record<string, FriendPosition>;
  /** Purges de proches (dernière position avant purge). */
  panics: FriendPanic[];
  callHelp: (roles: HelpTarget[], note?: string) => 'sent' | 'offline' | 'no-position';
  cancelHelp: () => void;
}

const FieldContext = createContext<FieldValue | null>(null);

/**
 * État « terrain » partagé : appels à l'aide, proches, purges.
 * Remonté à neuf après une purge (via la `key` de Root).
 */
export function FieldProvider({
  children,
  onFocus,
}: {
  children: ReactNode;
  onFocus: (c: Coords) => void;
}) {
  const { settings } = useApp();
  const { coords } = useLocation();
  const { show } = useAlerts();
  const [helps, setHelps] = useState<HelpCall[]>([]);
  const [myHelp, setMyHelp] = useState<MyHelp | null>(null);
  const [friends, setFriends] = useState<Record<string, FriendPosition>>({});
  const [panics, setPanics] = useState<FriendPanic[]>([]);
  const seenPanics = useRef(new Set<string>());

  // Références stables pour les écouteurs réseau.
  const coordsRef = useRef(coords);
  const labelsRef = useRef<Record<string, string>>({});
  const focusRef = useRef(onFocus);
  useEffect(() => {
    coordsRef.current = coords;
    focusRef.current = onFocus;
    labelsRef.current = Object.fromEntries(settings.friends.map((f) => [f.code, f.label]));
  }, [coords, onFocus, settings.friends]);

  useEffect(() => {
    const where = (p: { latitude: number | null; longitude: number | null }) => {
      const here = coordsRef.current;
      if (p.latitude === null || p.longitude === null) return 'position inconnue';
      return here ? formatDistance(distanceMeters(here, p as Coords)) : 'distance inconnue';
    };

    const offHelp = chatSocket.on('help', (h) => {
      setHelps((prev) => [h, ...prev.filter((x) => x.id !== h.id)]);
      show({
        id: `help-${h.id}`,
        tone: 'help',
        icon: 'help',
        urgent: true,
        title: `${h.author} appelle à l’aide`,
        body: `${roleLabel(h.role)} · cherche : ${h.roles.map(helpTargetLabel).join(', ')}${
          h.note ? `\n« ${h.note} »` : ''
        }\n${where(h)}`,
        actions: [
          { label: 'OK' },
          {
            label: 'Voir sur la carte',
            icon: 'map',
            primary: true,
            onPress: () => focusRef.current(h),
          },
        ],
      });
    });
    const offHelpRemoved = chatSocket.on('helpRemoved', (id) => {
      setHelps((prev) => prev.filter((x) => x.id !== id));
      setMyHelp((m) => (m?.id === id ? null : m));
    });
    const offAck = chatSocket.on('helpAck', ({ id, notified }) =>
      setMyHelp((m) => (m && m.id === id ? { ...m, notified } : m))
    );
    const offFriend = chatSocket.on('friend', (f) =>
      setFriends((prev) => ({ ...prev, [f.code]: f }))
    );
    const offPanic = chatSocket.on('friendPanic', (p) => {
      const key = `${p.code}-${p.ts}`;
      if (seenPanics.current.has(key)) return;
      seenPanics.current.add(key);
      setPanics((prev) => [p, ...prev.filter((x) => x.code !== p.code)]);
      setFriends((prev) => {
        const next = { ...prev };
        delete next[p.code];
        return next;
      });
      const label = labelsRef.current[p.code] || p.name;
      show({
        id: `panic-${key}`,
        tone: 'danger',
        icon: 'purge',
        urgent: true,
        title: `${label} a purgé son téléphone`,
        body: `Ça peut vouloir dire une interpellation ou un danger. Dernière position : ${where(p)}.`,
        actions:
          p.latitude !== null && p.longitude !== null
            ? [
                { label: 'OK' },
                {
                  label: 'Voir sur la carte',
                  icon: 'map',
                  primary: true,
                  onPress: () => focusRef.current(p as Coords),
                },
              ]
            : [{ label: 'OK', primary: true }],
      });
    });
    return () => {
      offHelp();
      offHelpRemoved();
      offAck();
      offFriend();
      offPanic();
    };
  }, [show]);

  // Appels expirés.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setHelps((prev) =>
        prev.some((h) => h.expiresAt <= now) ? prev.filter((h) => h.expiresAt > now) : prev
      );
      setMyHelp((m) => (m && m.expiresAt <= now ? null : m));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const callHelp = useCallback((roles: HelpTarget[], note = '') => {
    const here = coordsRef.current;
    if (!here) return 'no-position' as const;
    const sent = chatSocket.sendHelp(roles, here, note);
    if (!sent) {
      warning();
      return 'offline' as const;
    }
    success();
    setMyHelp({ ...sent, notified: null });
    return 'sent' as const;
  }, []);

  const myHelpRef = useRef(myHelp);
  useEffect(() => {
    myHelpRef.current = myHelp;
  }, [myHelp]);
  const cancelHelp = useCallback(() => {
    if (myHelpRef.current) chatSocket.cancelHelp(myHelpRef.current.id);
    setMyHelp(null);
  }, []);

  // Proches retirés de la liste : leur position n'est plus affichée.
  const followed = settings.friends.map((f) => f.code).join();
  const shownFriends = useMemo(() => {
    const keep = new Set(followed.split(','));
    return Object.fromEntries(Object.entries(friends).filter(([code]) => keep.has(code)));
  }, [friends, followed]);

  const value = useMemo(
    () => ({ helps, myHelp, friends: shownFriends, panics, callHelp, cancelHelp }),
    [helps, myHelp, shownFriends, panics, callHelp, cancelHelp]
  );
  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}

export function useField(): FieldValue {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField doit être utilisé dans <FieldProvider>');
  return ctx;
}
