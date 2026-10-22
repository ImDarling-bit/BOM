import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '../context/AppContext';
import { useField } from '../context/FieldContext';
import { useLocation } from '../context/LocationContext';
import { useHand } from '../hooks/useHand';
import { type Colors, font, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { distanceMeters, formatDistance } from '../utils/geo';
import { success, warning } from '../utils/haptics';
import { formatCode, newShareCode, parseCode } from '../utils/id';
import { timeAgo } from '../utils/labels';
import { BigButton } from './BigButton';
import { Icon } from './Icon';
import { Section } from './Section';

/**
 * Partage de position entre proches : chacun·e donne son code (à voix haute,
 * en personne). Les proches voient ta position précise sur leur carte, et sont
 * alerté·es si tu purges ton téléphone.
 */
export function FriendsSection() {
  const { settings, updateSettings } = useApp();
  const { friends: live } = useField();
  const { coords } = useLocation();
  const { colors } = useTheme();
  const { row } = useHand();
  const styles = useStyles(makeStyles);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const toggleShare = () => {
    const on = !settings.shareWithFriends;
    updateSettings({ shareWithFriends: on, shareCode: settings.shareCode ?? newShareCode() });
  };

  const add = () => {
    const parsed = parseCode(code);
    if (!parsed) {
      warning();
      return setError('Code invalide : 8 lettres ou chiffres, ex. ABCD-2345.');
    }
    if (parsed === settings.shareCode) return setError('C’est ton propre code.');
    if (settings.friends.some((f) => f.code === parsed)) return setError('Déjà dans tes proches.');
    success();
    updateSettings({
      friends: [...settings.friends, { code: parsed, label: label.trim().slice(0, 30) }],
    });
    setCode('');
    setLabel('');
    setError(null);
  };

  return (
    <Section
      title="Proches"
      hint="Ta position précise n’est envoyée qu’aux personnes qui ont ton code. Si tu purges ton téléphone, elles sont alertées avec ta dernière position."
    >
      <BigButton
        label={
          settings.shareWithFriends
            ? 'Partage avec mes proches : OUI'
            : 'Partage avec mes proches : NON'
        }
        icon={settings.shareWithFriends ? 'friend' : 'ban'}
        variant={settings.shareWithFriends ? 'selected' : 'secondary'}
        onPress={toggleShare}
      />

      {settings.shareWithFriends && settings.shareCode ? (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Mon code, à donner de vive voix</Text>
          <Text style={styles.code} selectable>
            {formatCode(settings.shareCode)}
          </Text>
          <BigButton
            label="Nouveau code"
            icon="refresh"
            onPress={() => updateSettings({ shareCode: newShareCode() })}
            accessibilityHint="L’ancien code ne fonctionne plus : plus personne ne te suit"
          />
        </View>
      ) : null}

      <Text style={styles.sub}>Suivre un·e proche</Text>
      <TextInput
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setError(null);
        }}
        placeholder="Son code : ABCD-2345"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        style={[styles.input, styles.mono]}
        accessibilityLabel="Code de partage du ou de la proche"
      />
      <View style={[styles.addRow, { flexDirection: row }]}>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="Nom (facultatif)"
          placeholderTextColor={colors.textMuted}
          maxLength={30}
          style={[styles.input, styles.flex]}
          accessibilityLabel="Nom du ou de la proche"
        />
        <BigButton
          label="Ajouter"
          variant="primary"
          disabled={!code.trim()}
          onPress={add}
          style={styles.addBtn}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {settings.friends.map((f) => {
        const pos = live[f.code];
        const name = f.label || pos?.name || formatCode(f.code);
        const status = pos
          ? `${coords ? `${formatDistance(distanceMeters(coords, pos))} · ` : ''}vu·e ${timeAgo(pos.ts)}`
          : 'pas de position pour l’instant';
        return (
          <View key={f.code} style={[styles.friend, { flexDirection: row }]}>
            <View style={styles.flex}>
              <View style={styles.friendRow}>
                <Icon
                  name={pos ? 'friend' : 'idle'}
                  size={20}
                  color={pos ? colors.success : colors.textMuted}
                  strokeWidth={2.5}
                />
                <Text style={styles.friendName}>{name}</Text>
              </View>
              <Text style={styles.friendMeta}>{status}</Text>
            </View>
            <BigButton
              label="Retirer"
              onPress={() =>
                updateSettings({ friends: settings.friends.filter((x) => x.code !== f.code) })
              }
            />
          </View>
        );
      })}
    </Section>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    codeCard: {
      backgroundColor: c.surfaceHigh,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.sm,
      alignItems: 'stretch',
    },
    codeLabel: { color: c.textMuted, fontSize: font.small, fontWeight: '700' },
    code: {
      color: c.accent,
      fontSize: 34,
      fontWeight: '900',
      letterSpacing: 4,
      fontFamily: 'monospace',
      textAlign: 'center',
    },
    sub: { color: c.text, fontSize: font.body, fontWeight: '800', marginTop: spacing.sm },
    input: {
      minHeight: touch.min,
      backgroundColor: c.bg,
      borderColor: c.border,
      borderWidth: 2,
      borderRadius: radius.md,
      color: c.text,
      fontSize: font.body,
      paddingHorizontal: spacing.lg,
    },
    mono: { fontFamily: 'monospace', fontSize: font.large, letterSpacing: 2 },
    addRow: { gap: spacing.sm, alignItems: 'center' },
    flex: { flex: 1 },
    addBtn: { minWidth: 120 },
    error: { color: c.warning, fontSize: font.small, fontWeight: '700' },
    friend: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    friendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    friendName: { color: c.text, fontSize: font.body, fontWeight: '800' },
    friendMeta: { color: c.textMuted, fontSize: font.small },
  });
