import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Colors, font, radius, spacing } from '../theme';
import { useStyles } from '../theme/ThemeContext';

/** Bloc de réglages : titre, aide facultative, contenu sur une carte arrondie. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    title: { color: c.text, fontSize: font.large, fontWeight: '800' },
    hint: { color: c.textMuted, fontSize: font.small, lineHeight: 21 },
    body: {
      gap: spacing.sm,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
  });
