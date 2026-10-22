import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useApp } from '../context/AppContext';
import {
  type Colors,
  FLAG_THEMES,
  font,
  normalizeHex,
  radius,
  spacing,
  SWATCHES,
  touch,
} from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { tap } from '../utils/haptics';

/** Choix de l'accent : jaune, thème drapeau, ou n'importe quelle couleur. */
export function ThemePicker() {
  const { settings, updateSettings } = useApp();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [hex, setHex] = useState(settings.customAccent ?? '');
  const custom = settings.themeId === 'custom';

  const pick = (themeId: string) => {
    tap();
    updateSettings({ themeId });
  };
  const setCustom = (value: string) => {
    setHex(value);
    const color = normalizeHex(value);
    if (color) updateSettings({ themeId: 'custom', customAccent: color });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.grid}>
        {FLAG_THEMES.map((t) => {
          const selected = settings.themeId === t.id;
          const bands = t.stripes.length ? t.stripes : [t.accent];
          return (
            <Pressable
              key={t.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Thème ${t.label}`}
              onPress={() => pick(t.id)}
              style={({ pressed }) => [
                styles.tile,
                selected && styles.tileSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.flag}>
                {bands.map((b, i) => (
                  <View key={`${b}-${i}`} style={[styles.band, { backgroundColor: b }]} />
                ))}
                {t.triangle ? (
                  <View style={[styles.triangle, { borderLeftColor: t.triangle }]} />
                ) : null}
              </View>
              <Text
                style={[styles.tileLabel, selected && styles.tileLabelSelected]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: custom }}
          accessibilityLabel="Couleur personnalisée"
          onPress={() => setCustom(hex || settings.customAccent || SWATCHES[6])}
          style={({ pressed }) => [
            styles.tile,
            custom && styles.tileSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.flag, styles.rainbowWrap]}>
            {SWATCHES.slice(0, 6).map((s) => (
              <View key={s} style={[styles.band, { backgroundColor: s }]} />
            ))}
          </View>
          <Text style={[styles.tileLabel, custom && styles.tileLabelSelected]}>Ma couleur</Text>
        </Pressable>
      </View>

      {custom ? (
        <View style={styles.custom}>
          <View style={styles.swatches}>
            {SWATCHES.map((s) => (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityLabel={`Couleur ${s}`}
                onPress={() => {
                  tap();
                  setCustom(s);
                }}
                style={[
                  styles.swatch,
                  { backgroundColor: s },
                  settings.customAccent === s && { borderColor: colors.text, borderWidth: 3 },
                ]}
              />
            ))}
          </View>
          <View style={styles.hexRow}>
            <View
              style={[styles.preview, { backgroundColor: normalizeHex(hex) ?? colors.surfaceHigh }]}
            />
            <TextInput
              value={hex}
              onChangeText={setCustom}
              placeholder="#FF00AA"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={styles.input}
              accessibilityLabel="Code couleur hexadécimal"
            />
          </View>
          <Text style={styles.hint}>
            N’importe quelle couleur : le texte reste lisible en mode clair comme sombre.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: {
      flexBasis: '30%',
      flexGrow: 1,
      minHeight: touch.min + 8,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: c.border,
      backgroundColor: c.surfaceHigh,
      padding: spacing.sm,
      gap: spacing.xs,
      justifyContent: 'center',
    },
    tileSelected: { borderColor: c.accent, borderWidth: 3 },
    pressed: { opacity: 0.7 },
    flag: { height: 20, borderRadius: 4, overflow: 'hidden', flexDirection: 'column' },
    rainbowWrap: { flexDirection: 'row' },
    band: { flex: 1 },
    // Triangle côté hampe : bordure transparente haut/bas, colorée à gauche.
    triangle: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      borderTopWidth: 10,
      borderBottomWidth: 10,
      borderLeftWidth: 14,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
    },
    tileLabel: { color: c.text, fontSize: 14, fontWeight: '700' },
    tileLabelSelected: { color: c.accent, fontWeight: '900' },
    custom: { gap: spacing.md },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: c.border },
    hexRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
    preview: {
      width: touch.min,
      height: touch.min,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: c.border,
    },
    input: {
      flex: 1,
      minHeight: touch.min,
      backgroundColor: c.bg,
      borderColor: c.border,
      borderWidth: 2,
      borderRadius: radius.md,
      color: c.text,
      fontSize: font.large,
      fontFamily: 'monospace',
      paddingHorizontal: spacing.lg,
    },
    hint: { color: c.textMuted, fontSize: font.small },
  });
