import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHand } from '../hooks/useHand';
import { type Colors, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { tap } from '../utils/haptics';
import { FlagStripe } from './FlagStripe';
import { Icon, type IconName } from './Icon';
import { PanicButton } from './PanicButton';

export type TabId = 'map' | 'chat' | 'wiki' | 'settings';

// Par ordre de priorité : le premier est placé le plus près du pouce.
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'map', label: 'Carte', icon: 'map' },
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'wiki', label: 'Droits', icon: 'rights' },
  { id: 'settings', label: 'Réglages', icon: 'settings' },
];

/**
 * Barre de navigation unique, collée en bas de l'écran.
 * Le bouton PURGE est dans le coin côté pouce, puis les onglets par priorité
 * décroissante en s'éloignant du pouce.
 */
export function ThumbTabBar({
  active,
  onChange,
  badges = {},
}: {
  active: TabId;
  onChange: (id: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
}) {
  const { row } = useHand();
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  // Ordre [moins prioritaire … plus prioritaire, PURGE] + `row` = PURGE sous le pouce.
  const ordered = [...TABS].reverse();

  return (
    <View style={styles.wrap}>
      <FlagStripe height={4} />
      <View
        style={[
          styles.bar,
          { flexDirection: row, paddingBottom: Math.max(insets.bottom, spacing.sm) },
        ]}
        accessibilityRole="tablist"
      >
        {ordered.map((t) => {
          const selected = t.id === active;
          const badge = badges[t.id] ?? 0;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="tab"
              accessibilityLabel={badge ? `${t.label}, ${badge} nouveaux` : t.label}
              accessibilityState={{ selected }}
              onPress={() => {
                tap();
                onChange(t.id);
              }}
              style={({ pressed }) => [
                styles.tab,
                selected && styles.tabActive,
                pressed && styles.pressed,
              ]}
            >
              {selected ? <View style={styles.indicator} /> : null}
              <Icon
                name={t.icon}
                size={26}
                color={selected ? colors.accent : colors.textMuted}
                strokeWidth={selected ? 2.6 : 2.1}
              />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              ) : null}
              <Text style={[styles.label, selected && styles.labelActive]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
        <PanicButton />
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { backgroundColor: c.surface },
    bar: {
      backgroundColor: c.surface,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      gap: spacing.xs,
      alignItems: 'center',
    },
    tab: {
      flex: 1,
      minHeight: touch.primary + 8,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: { backgroundColor: c.surfaceHigh },
    pressed: { opacity: 0.6 },
    label: { color: c.textMuted, fontSize: 13, fontWeight: '700', marginTop: 2 },
    labelActive: { color: c.accent },
    indicator: {
      position: 'absolute',
      top: 4,
      width: 22,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.accent,
    },
    badge: {
      position: 'absolute',
      top: 4,
      right: 8,
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 4,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: c.onDanger, fontSize: 12, fontWeight: '900' },
  });
