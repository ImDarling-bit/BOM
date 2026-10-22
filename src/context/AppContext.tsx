import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { chatSocket } from '../services/chatSocket';
import {
  loadProfile,
  loadSettings,
  purgeAll,
  saveProfile,
  saveSettings,
} from '../storage/storage';
import type { Coords, Hand, Profile, Role, Settings } from '../types';
import { newId, tagFromUuid } from '../utils/id';

export const DEFAULT_SETTINGS: Settings = {
  hand: 'right',
  shareLocation: true,
  shareWithFriends: false,
  shareCode: null,
  friends: [],
  themeId: 'default',
  customAccent: null,
};

interface AppValue {
  ready: boolean;
  profile: Profile | null;
  settings: Settings;
  /** Change à chaque purge : sert de `key` pour remonter tout l'arbre à neuf. */
  sessionKey: number;
  createProfile: (pseudo: string, role: Role, hand: Hand) => Promise<void>;
  updateProfile: (patch: Partial<Pick<Profile, 'pseudo' | 'role'>>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Purge d'urgence. `lastPosition` est envoyée aux proches juste avant. */
  panic: (lastPosition: Coords | null) => Promise<void>;
}

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sessionKey, setSessionKey] = useState(0);

  // Refs pour que les callbacks restent stables tout en lisant l'état courant.
  const profileRef = useRef(profile);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    profileRef.current = profile;
    settingsRef.current = settings;
  }, [profile, settings]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, s] = await Promise.all([loadProfile(), loadSettings()]);
      if (!alive) return;
      setProfile(p);
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const createProfile = useCallback(async (pseudo: string, role: Role, hand: Hand) => {
    const uuid = newId();
    const p: Profile = { uuid, pseudo: pseudo.trim(), tag: tagFromUuid(uuid), role, createdAt: Date.now() };
    const s: Settings = { ...settingsRef.current, hand };
    setSettings(s);
    setProfile(p);
    await Promise.all([saveProfile(p), saveSettings(s)]);
  }, []);

  const updateProfile = useCallback((patch: Partial<Pick<Profile, 'pseudo' | 'role'>>) => {
    const current = profileRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    setProfile(next);
    void saveProfile(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    void saveSettings(next);
  }, []);

  const panic = useCallback(async (lastPosition: Coords | null) => {
    // 0. Prévenir les proches (si connecté), 1. couper le réseau, 2. vider
    // l'état en mémoire (l'UI repart à zéro immédiatement), 3. effacer le stockage.
    chatSocket.sendPanic(lastPosition);
    chatSocket.shutdown();
    setProfile(null);
    // L'apparence n'identifie personne : on la garde pour ne pas trahir la purge.
    setSettings({
      ...DEFAULT_SETTINGS,
      themeId: settingsRef.current.themeId,
      customAccent: settingsRef.current.customAccent,
      hand: settingsRef.current.hand,
    });
    setSessionKey((k) => k + 1);
    await purgeAll();
  }, []);

  const value = useMemo<AppValue>(
    () => ({
      ready,
      profile,
      settings,
      sessionKey,
      createProfile,
      updateProfile,
      updateSettings,
      panic,
    }),
    [ready, profile, settings, sessionKey, createProfile, updateProfile, updateSettings, panic]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp doit être utilisé dans <AppProvider>');
  return ctx;
}
