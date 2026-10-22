import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

/** Liseré aux couleurs du thème drapeau choisi (rien pour un accent simple). */
export function FlagStripe({ height = 5 }: { height?: number }) {
  const { flag, colors } = useTheme();
  const bands = flag.stripes.length ? flag.stripes : [colors.primary];
  const stripes = flag.triangle ? [flag.triangle, ...bands] : bands;
  return (
    <View
      style={[styles.row, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {stripes.map((c, i) => (
        <View key={`${c}-${i}`} style={[styles.band, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', width: '100%' },
  band: { flex: 1 },
});
