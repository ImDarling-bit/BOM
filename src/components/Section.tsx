import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Colors, font, spacing } from '../theme';
import { useStyles } from '../theme/ThemeContext';

/** Bloc de réglages : titre discret, aide facultative courte, contenu sans cadre. */
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
      <View style={styles.body}>{children}</View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    section: { gap: spacing.sm },
    title: { color: c.textMuted, fontSize: font.small, fontWeight: '700', letterSpacing: 0.3 },
    hint: { color: c.textMuted, fontSize: font.small, lineHeight: 20 },
    body: { gap: spacing.sm },
  });
