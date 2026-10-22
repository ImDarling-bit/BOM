import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Colors, font, spacing } from '../theme';
import { useStyles } from '../theme/ThemeContext';
import { FlagStripe } from './FlagStripe';

/**
 * En-tête purement informatif : le haut de l'écran est hors de portée du
 * pouce, donc on n'y met jamais d'action.
 */
export function ScreenHeader({ title, right }: { title: string; right?: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {right}
      </View>
      <FlagStripe height={3} />
    </View>
  );
}

export function StatusDot({ label, color }: { label: string; color: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.status} accessibilityLabel={label}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.statusText}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    title: {
      color: c.text,
      fontSize: font.title,
      fontWeight: '900',
      flexShrink: 1,
      letterSpacing: -0.5,
    },
    status: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: 999,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    statusText: { color: c.textMuted, fontSize: font.small, fontWeight: '700' },
  });
