import { Pressable, type StyleProp, StyleSheet, Text, type ViewStyle } from 'react-native';

import { type Colors, font, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { tap } from '../utils/haptics';

type Variant = 'primary' | 'secondary' | 'danger' | 'selected';

interface Props {
  label: string;
  icon?: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  /** Bouton principal : hauteur 64 au lieu de 56. */
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

export function BigButton({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled,
  large,
  style,
  accessibilityHint,
}: Props) {
  const { colors: c } = useTheme();
  const styles = useStyles(makeStyles);
  const bg: Record<Variant, string> = {
    primary: c.primary,
    secondary: c.surfaceHigh,
    danger: c.danger,
    selected: c.primary,
  };
  const fg: Record<Variant, string> = {
    primary: c.onPrimary,
    secondary: c.text,
    danger: c.onDanger,
    selected: c.onPrimary,
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, selected: variant === 'selected' }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        { minHeight: large ? touch.primary : touch.min, backgroundColor: bg[variant] },
        variant === 'secondary' && styles.outlined,
        (variant === 'primary' || variant === 'danger') && styles.raised,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        numberOfLines={2}
        style={[styles.label, { color: fg[variant], fontSize: large ? font.large : font.body }]}
      >
        {icon ? `${icon}  ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    base: {
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    outlined: {
      borderWidth: 1.5,
      borderColor: c.border,
    },
    raised: {
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 3,
    },
    pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
    disabled: { opacity: 0.4 },
    label: { fontWeight: '800', textAlign: 'center' },
  });
