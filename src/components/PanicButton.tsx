import { useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { CONFIG } from '../config';
import { useApp } from '../context/AppContext';
import { useLocation } from '../context/LocationContext';
import { type Colors, radius, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { tap, warning } from '../utils/haptics';
import { Icon } from './Icon';

/**
 * Bouton d'urgence : maintenir ~0,8 s pour tout purger.
 * L'appui maintenu évite une purge accidentelle quand on court ou qu'on
 * tremble, tout en restant un seul geste du pouce. La jauge rouge montre la
 * progression : relâcher avant la fin annule. Les proches qui suivent ta
 * position sont prévenus juste avant l'effacement.
 */
export function PanicButton() {
  const { panic } = useApp();
  const { coords } = useLocation();
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [progress] = useState(() => new Animated.Value(0));
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  const start = () => {
    tap();
    anim.current?.stop();
    anim.current = Animated.timing(progress, {
      toValue: 1,
      duration: CONFIG.panicHoldMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.current.start(({ finished }) => {
      if (!finished) return;
      warning();
      void panic(coords);
    });
  };

  const cancel = () => {
    anim.current?.stop();
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };

  const height = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Purge d'urgence"
      accessibilityHint="Maintenir appuyé pour effacer toutes les données de l'application et prévenir tes proches"
      onPressIn={start}
      onPressOut={cancel}
      hitSlop={8}
      style={styles.button}
    >
      <Animated.View style={[styles.fill, { height }]} />
      <View style={styles.content} pointerEvents="none">
        <Icon name="purge" size={22} color={colors.text} strokeWidth={2.5} />
        <Text style={styles.label}>PURGE</Text>
        <Text style={styles.hint}>maintenir</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    button: {
      width: 84,
      minHeight: touch.primary + 8,
      borderRadius: radius.md,
      borderWidth: 2.5,
      borderColor: c.danger,
      backgroundColor: c.surface,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    fill: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.danger,
    },
    content: { alignItems: 'center' },
    label: { color: c.text, fontWeight: '900', fontSize: 15, letterSpacing: 1 },
    hint: { color: c.textMuted, fontSize: 11 },
  });
