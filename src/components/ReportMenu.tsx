import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useHand } from '../hooks/useHand';
import { type Colors, elevation, font, radius, spacing, touch } from '../theme';
import { useStyles } from '../theme/ThemeContext';
import { tap } from '../utils/haptics';
import { AREA_TYPES, POINT_TYPES, type ReportMeta } from '../utils/labels';
import { BigButton } from './BigButton';
import { Icon } from './Icon';

const WIDTH = 228;

/**
 * Menu latéral des signalements, glissé depuis le bord du pouce (droite pour
 * un droitier, gauche pour un gaucher). Les choix sont collés en bas, à
 * portée du pouce ; « Fermer » est le plus bas.
 */
export function ReportMenu({
  onPick,
  onClose,
}: {
  onPick: (meta: ReportMeta) => void;
  onClose: () => void;
}) {
  const { isRight } = useHand();
  const styles = useStyles(makeStyles);
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(slide, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [slide]);

  const offscreen = isRight ? WIDTH + 24 : -(WIDTH + 24);
  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [offscreen, 0] });

  const item = (meta: ReportMeta) => (
    <Pressable
      key={meta.id}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
      accessibilityHint={meta.hint}
      onPress={() => {
        tap();
        onPick(meta);
      }}
      style={({ pressed }) => [
        styles.item,
        { flexDirection: isRight ? 'row' : 'row-reverse' },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.swatch, { backgroundColor: meta.color }]} />
      <Icon name={meta.icon} size={22} color={meta.color} strokeWidth={2.5} />
      <Text style={[styles.itemLabel, { textAlign: isRight ? 'left' : 'right' }]} numberOfLines={1}>
        {meta.label}
      </Text>
    </Pressable>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Toucher la carte à côté ferme le menu. */}
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityLabel="Fermer le menu"
      />
      <Animated.View
        style={[
          styles.panel,
          isRight ? styles.right : styles.left,
          { transform: [{ translateX }] },
        ]}
        accessibilityViewIsModal
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.title}>Point · avec la croix</Text>
          {POINT_TYPES.map(item)}
          <Text style={styles.title}>Zone · à dessiner</Text>
          {AREA_TYPES.map(item)}
          <BigButton label="Fermer" icon="close" onPress={onClose} style={styles.close} />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0,0,0,0.25)' },
    panel: {
      position: 'absolute',
      top: 120,
      bottom: spacing.md,
      width: WIDTH,
      backgroundColor: c.overlay,
      borderRadius: radius.lg,
      ...elevation(c, 3),
    },
    right: { right: spacing.sm },
    left: { left: spacing.sm },
    // Contenu poussé vers le bas : le pouce n'a pas à monter.
    content: { flexGrow: 1, justifyContent: 'flex-end', padding: spacing.sm, gap: spacing.xs },
    title: {
      color: c.textMuted,
      fontSize: 13,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    item: {
      minHeight: touch.min,
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      overflow: 'hidden',
    },
    swatch: { width: 6, alignSelf: 'stretch', borderRadius: 3, marginVertical: spacing.sm },
    itemLabel: { flex: 1, color: c.text, fontSize: font.body, fontWeight: '800' },
    pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
    close: { marginTop: spacing.sm },
  });
