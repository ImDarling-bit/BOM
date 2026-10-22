import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { font, radius, spacing, touch } from '../theme';
import { useTheme } from '../theme/ThemeContext';
import { tap } from '../utils/haptics';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger' | 'selected';

interface Props {
  label: string;
  icon?: IconName;
  /** Icône retournée horizontalement (ex. main gauche). */
  iconMirrored?: boolean;
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
  iconMirrored,
  onPress,
  variant = 'secondary',
  disabled,
  large,
  style,
  accessibilityHint,
}: Props) {
  const { colors: c } = useTheme();
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
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? (
          <Icon
            name={icon}
            size={large ? 24 : 21}
            color={fg[variant]}
            strokeWidth={2.5}
            mirrored={iconMirrored}
          />
        ) : null}
        <Text
          numberOfLines={2}
          style={[styles.label, { color: fg[variant], fontSize: large ? font.large : font.body }]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  label: { fontWeight: '700', textAlign: 'center', flexShrink: 1 },
});
