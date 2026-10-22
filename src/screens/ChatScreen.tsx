import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { ScreenHeader, StatusDot } from '../components/ScreenHeader';
import { CONFIG } from '../config';
import { useApp } from '../context/AppContext';
import { useChat } from '../context/ChatContext';
import { useLocation } from '../context/LocationContext';
import { useHand } from '../hooks/useHand';
import { chatSocket, type SocketStatus } from '../services/chatSocket';
import { type Colors, font, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import type { ChatMessage, Coords } from '../types';
import { distanceMeters, formatDistance } from '../utils/geo';
import { tap, warning } from '../utils/haptics';
import { QUICK_MESSAGES, roleIcon, timeAgo } from '../utils/labels';

const statusInfo = (c: Colors): Record<SocketStatus, { label: string; color: string }> => ({
  online: { label: 'En ligne', color: c.success },
  connecting: { label: 'Connexion…', color: c.warning },
  offline: { label: 'Hors ligne', color: c.danger },
});

export function useSocketStatus(): SocketStatus {
  return useSyncExternalStore(
    (cb) => chatSocket.on('status', cb),
    () => chatSocket.status
  );
}

/** Manifestant·es connecté·es autour de moi (compté par le serveur). */
export function useNearby(): number | null {
  return useSyncExternalStore(
    (cb) => chatSocket.on('nearby', cb),
    () => chatSocket.nearby
  );
}

export function ChatScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { profile } = useApp();
  const { coords } = useLocation();
  const { row, isRight } = useHand();
  const status = useSocketStatus();
  const nearby = useNearby();
  const { messages, add, markRead } = useChat();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = profile ? `${profile.pseudo}#${profile.tag}` : '';

  // Onglet ouvert = messages lus (y compris ceux qui arrivent pendant qu'il est affiché).
  useEffect(() => {
    markRead();
  }, [messages, markRead]);

  const send = (text: string) => {
    if (!profile) return;
    const msg = chatSocket.sendChat(text, profile.role);
    if (!msg) {
      warning();
      setError('Hors ligne : message non envoyé.');
      return;
    }
    setError(null);
    add(msg);
    if (text === draft) setDraft('');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title="Chat local"
        right={
          <View style={styles.headerRight}>
            {nearby !== null ? (
              <View
                style={styles.nearby}
                accessibilityLabel={`${nearby} manifestant·es autour de toi`}
              >
                <Text style={styles.nearbyText}>👥 {nearby}</Text>
              </View>
            ) : null}
            <StatusDot
              label={statusInfo(colors)[status].label}
              color={statusInfo(colors)[status].color}
            />
          </View>
        }
      />
      <Text style={styles.subtitle}>
        {nearby === null
          ? status === 'online'
            ? 'Active ta position pour voir combien vous êtes autour.'
            : `Messages dans un rayon de ${CONFIG.radiusMeters / 1000} km`
          : `${nearby} autre${nearby > 1 ? 's' : ''} manifestant·e${nearby > 1 ? 's' : ''} connecté·e${nearby > 1 ? 's' : ''} à moins de ${CONFIG.radiusMeters / 1000} km`}
      </Text>

      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <FlatList
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Bubble msg={item} mine={item.author === me} here={coords} isRight={isRight} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>{"Aucun message pour l'instant."}</Text>}
        />

        {/* Zone du pouce : messages rapides + saisie */}
        <View style={styles.composer}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quick}
            keyboardShouldPersistTaps="handled"
          >
            {QUICK_MESSAGES.map((q) => (
              <Pressable
                key={q}
                onPress={() => {
                  tap();
                  send(q);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Envoyer : ${q}`}
                style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              >
                <Text style={styles.chipText}>{q}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={[styles.inputRow, { flexDirection: row }]}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor={colors.textMuted}
              maxLength={CONFIG.maxMessageLength}
              multiline
              style={styles.input}
              accessibilityLabel="Message"
            />
            <BigButton
              label="Envoyer"
              variant="primary"
              large
              disabled={!draft.trim()}
              onPress={() => send(draft)}
              style={styles.send}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({
  msg,
  mine,
  here,
  isRight,
}: {
  msg: ChatMessage;
  mine: boolean;
  here: Coords | null;
  isRight: boolean;
}) {
  const styles = useStyles(makeStyles);
  const where =
    here && msg.latitude !== undefined && msg.longitude !== undefined
      ? formatDistance(distanceMeters(here, { latitude: msg.latitude, longitude: msg.longitude }))
      : null;
  return (
    <View
      style={[
        styles.bubble,
        mine ? styles.bubbleMine : styles.bubbleOther,
        // Mes messages côté pouce, les autres côté opposé.
        { alignSelf: mine === isRight ? 'flex-end' : 'flex-start' },
      ]}
      accessible
      accessibilityLabel={`${msg.author} : ${msg.text}`}
    >
      <Text style={styles.meta}>
        {roleIcon(msg.role)} {mine ? 'Moi' : msg.author} · {timeAgo(msg.ts)}
        {where ? ` · ${where}` : ''}
      </Text>
      <Text style={styles.text}>{msg.text}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    nearby: {
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: 999,
    },
    nearbyText: { color: c.onPrimary, fontSize: font.body, fontWeight: '900' },
    subtitle: { color: c.textMuted, fontSize: font.small, paddingHorizontal: spacing.lg },
    list: { padding: spacing.lg, gap: spacing.sm },
    empty: { color: c.textMuted, fontSize: font.body, textAlign: 'center', padding: spacing.xl },
    bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
    bubbleMine: { backgroundColor: c.surfaceHigh, borderWidth: 2, borderColor: c.accent },
    bubbleOther: { backgroundColor: c.surface },
    meta: { color: c.textMuted, fontSize: font.small, fontWeight: '700' },
    text: { color: c.text, fontSize: font.body, lineHeight: 25 },
    composer: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingVertical: spacing.sm,
      gap: spacing.sm,
      backgroundColor: c.bg,
    },
    error: {
      color: c.warning,
      fontSize: font.small,
      fontWeight: '700',
      paddingHorizontal: spacing.lg,
    },
    quick: { gap: spacing.sm, paddingHorizontal: spacing.lg },
    chip: {
      minHeight: touch.min,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    chipText: { color: c.text, fontSize: font.body, fontWeight: '700' },
    pressed: { opacity: 0.6 },
    inputRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: 'flex-end' },
    input: {
      flex: 1,
      minHeight: touch.primary,
      maxHeight: 120,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 2,
      borderRadius: radius.md,
      color: c.text,
      fontSize: font.body,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    send: { minWidth: 110 },
  });
