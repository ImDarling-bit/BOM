import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { Icon, type IconName } from '../components/Icon';
import { useHand } from '../hooks/useHand';
import { type Colors, elevation, font, radius, spacing } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';

export interface AlertAction {
  label: string;
  icon?: IconName;
  primary?: boolean;
  onPress?: () => void;
}

export interface AppAlert {
  id: string;
  tone: 'danger' | 'help' | 'info';
  icon: IconName;
  title: string;
  body?: string;
  actions: AlertAction[];
  /** Vibration longue (urgence) ou courte. */
  urgent?: boolean;
}

interface AlertsValue {
  show: (a: AppAlert) => void;
  dismiss: (id: string) => void;
}

const AlertsContext = createContext<AlertsValue>({ show: () => {}, dismiss: () => {} });

// Les alertes arrivent par le réseau pendant que l'app est ouverte. Pas de
// notifications système : elles exigeraient Firebase (Google) ou les serveurs
// d'Apple, ce qui irait contre l'anonymat et l'open source.
export function AlertsProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<AppAlert[]>([]);

  const show = useCallback((a: AppAlert) => {
    setQueue((q) => (q.some((x) => x.id === a.id) ? q : [...q, a]));
    Vibration.vibrate(a.urgent ? [0, 500, 200, 500, 200, 800] : [0, 200]);
  }, []);
  const dismiss = useCallback((id: string) => setQueue((q) => q.filter((x) => x.id !== id)), []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const current = queue[0];

  return (
    <AlertsContext.Provider value={value}>
      {children}
      {current ? (
        <AlertSheet alert={current} more={queue.length - 1} onClose={() => dismiss(current.id)} />
      ) : null}
    </AlertsContext.Provider>
  );
}

export const useAlerts = () => useContext(AlertsContext);

/** Carte d'alerte posée en bas de l'écran, dans la zone du pouce. */
function AlertSheet({
  alert,
  more,
  onClose,
}: {
  alert: AppAlert;
  more: number;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { row } = useHand();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toneColor =
    alert.tone === 'danger' ? colors.danger : alert.tone === 'help' ? '#B000D8' : colors.info;
  const toneStyle =
    alert.tone === 'danger' ? styles.danger : alert.tone === 'help' ? styles.help : styles.info;

  return (
    // Posée juste au-dessus de la barre d'onglets : le bouton PURGE reste accessible.
    <View
      style={[styles.backdrop, { paddingBottom: 100 + Math.max(insets.bottom, spacing.sm) }]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.sheet, toneStyle]}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <View style={styles.head}>
          <View style={[styles.iconWrap, { backgroundColor: toneColor }]}>
            <Icon name={alert.icon} size={30} color="#FFFFFF" strokeWidth={2.5} />
          </View>
          <View style={styles.headText}>
            <Text style={styles.title}>{alert.title}</Text>
            {alert.body ? <Text style={styles.body}>{alert.body}</Text> : null}
          </View>
        </View>
        {more > 0 ? <Text style={styles.more}>+ {more} autre(s) alerte(s)</Text> : null}
        <View style={[styles.actions, { flexDirection: row }]}>
          {alert.actions.map((a) => (
            <BigButton
              key={a.label}
              label={a.label}
              icon={a.icon}
              variant={a.primary ? 'primary' : 'secondary'}
              large={a.primary}
              onPress={() => {
                onClose();
                a.onPress?.();
              }}
              style={a.primary ? styles.primary : styles.secondary}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'flex-end',
      padding: spacing.md,
    },
    sheet: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.md,
      borderWidth: 3,
      ...elevation(c, 3),
    },
    danger: { borderColor: c.danger },
    help: { borderColor: '#D500F9' },
    info: { borderColor: c.accent },
    head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
    iconWrap: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headText: { flex: 1, gap: spacing.xs },
    title: { color: c.text, fontSize: font.large, fontWeight: '900' },
    body: { color: c.text, fontSize: font.body, lineHeight: 25 },
    more: { color: c.textMuted, fontSize: font.small },
    actions: { gap: spacing.sm },
    primary: { flex: 1.5 },
    secondary: { flex: 1 },
  });
