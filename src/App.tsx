import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { type TabId, ThumbTabBar } from './components/ThumbTabBar';
import { CONFIG } from './config';
import { AlertsProvider, useAlerts } from './context/AlertsContext';
import { AppProvider, useApp } from './context/AppContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { FieldProvider } from './context/FieldContext';
import { LocationProvider, useLocation } from './context/LocationContext';
import { chatSocket } from './services/chatSocket';
import { checkForUpdate } from './services/update';
import { ChatScreen } from './screens/ChatScreen';
import { MapScreen } from './screens/MapScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WikiScreen } from './screens/WikiScreen';
import type { Colors } from './theme';
import { ThemeProvider, useStyles, useTheme } from './theme/ThemeContext';
import type { Coords } from './types';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemeProvider>
          <ThemedStatusBar />
          <AlertsProvider>
            <Root />
          </AlertsProvider>
        </ThemeProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { scheme } = useTheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}

function Root() {
  const { ready, profile, settings, sessionKey } = useApp();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // `key` change à chaque purge : tout l'arbre (et son état en mémoire) repart à zéro.
  return (
    <View key={sessionKey} style={styles.root}>
      {profile ? (
        <LocationProvider
          enabled={settings.shareLocation || settings.shareWithFriends}
          share={settings.shareLocation}
        >
          <ChatProvider>
            <Main />
          </ChatProvider>
        </LocationProvider>
      ) : (
        <OnboardingScreen />
      )}
    </View>
  );
}

function Main() {
  const { profile, settings } = useApp();
  const { shared, coords } = useLocation();
  const { unread } = useChat();
  const { show } = useAlerts();
  const styles = useStyles(makeStyles);
  const [tab, setTab] = useState<TabId>('map');
  /** Point à centrer sur la carte (alerte « Voir sur la carte »). */
  const [focus, setFocus] = useState<(Coords & { at: number }) | null>(null);
  const name = profile ? `${profile.pseudo}#${profile.tag}` : '';
  const role = profile?.role ?? 'user';

  const links = useMemo(
    () => ({
      shareCode: settings.shareWithFriends ? settings.shareCode : null,
      follows: settings.friends.map((f) => f.code),
    }),
    [settings.shareWithFriends, settings.shareCode, settings.friends]
  );

  // Connexion WebSocket ouverte tant que le profil existe.
  useEffect(() => {
    if (!name) return;
    chatSocket.connect(CONFIG.wsUrl, { name, role }, shared, links);
    return () => chatSocket.shutdown();
    // Position et proches sont mis à jour séparément, sans reconnexion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, role]);

  useEffect(() => {
    chatSocket.updatePosition(shared);
  }, [shared]);

  useEffect(() => {
    chatSocket.updateLinks(links);
  }, [links]);

  // Position précise pour les proches, seulement si le partage est activé.
  useEffect(() => {
    if (coords && settings.shareWithFriends) chatSocket.sendFriendPosition(coords);
  }, [coords, settings.shareWithFriends]);

  // Nouvelle version publiée sur GitHub ? On propose la mise à jour à l'ouverture.
  useEffect(() => {
    const t = setTimeout(async () => {
      const update = await checkForUpdate();
      if (!update) return;
      show({
        id: `update-${update.version}`,
        tone: 'info',
        icon: 'update',
        title: `BOM ${update.version} est disponible`,
        body: `Tu as la version ${CONFIG.appVersion}. Mettre à jour maintenant ?`,
        actions: [
          { label: 'Plus tard' },
          {
            label: 'Mettre à jour',
            icon: 'download',
            primary: true,
            onPress: () => void Linking.openURL(update.url),
          },
        ],
      });
    }, 3000);
    return () => clearTimeout(t);
  }, [show]);

  // Bouton retour Android : revient à la carte avant de quitter l'app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'map') return false;
      setTab('map');
      return true;
    });
    return () => sub.remove();
  }, [tab]);

  const showOnMap = useCallback((c: Coords) => {
    setTab('map');
    setFocus({ latitude: c.latitude, longitude: c.longitude, at: Date.now() });
  }, []);

  return (
    <FieldProvider onFocus={showOnMap}>
      <View style={styles.root}>
        <View style={styles.root}>
          {tab === 'map' && <MapScreen focus={focus} />}
          {tab === 'chat' && <ChatScreen />}
          {tab === 'wiki' && <WikiScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </View>
        <ThumbTabBar
          active={tab}
          onChange={setTab}
          badges={{ chat: tab === 'chat' ? 0 : unread }}
        />
      </View>
    </FieldProvider>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  });
