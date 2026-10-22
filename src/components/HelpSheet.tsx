import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useField } from '../context/FieldContext';
import { useHand } from '../hooks/useHand';
import { type Colors, font, spacing } from '../theme';
import { useStyles } from '../theme/ThemeContext';
import type { HelpTarget } from '../types';
import { HELP_TARGETS } from '../utils/labels';
import { BigButton } from './BigButton';

const NOTES = ['Blessure', 'Malaise', 'Gaz / yeux', 'Besoin d’eau', 'Encerclé·e', 'Perdu·e'];

/**
 * Appel à l'aide : on choisit qui prévenir (street medics, ravitaillement,
 * protection ou tout le monde), un motif en un tap, puis on envoie.
 * Seules les personnes concernées à moins de 2 km reçoivent l'alerte.
 */
export function HelpSheet({ onDone }: { onDone: (message: string | null) => void }) {
  const { callHelp } = useField();
  const { row } = useHand();
  const styles = useStyles(makeStyles);
  const [targets, setTargets] = useState<HelpTarget[]>(['medic']);
  const [note, setNote] = useState('');

  const toggle = (t: HelpTarget) => {
    if (t === 'all') return setTargets(['all']);
    setTargets((prev) => {
      const base = prev.filter((x) => x !== 'all');
      return base.includes(t) ? base.filter((x) => x !== t) : [...base, t];
    });
  };

  const send = () => {
    const r = callHelp(targets, note);
    if (r === 'sent') onDone('🆘 Appel envoyé. Reste visible si tu peux.');
    else if (r === 'offline')
      onDone('Hors ligne : appel non envoyé. Utilise le chat ou appelle le 112.');
    else onDone('Position indisponible : active la localisation pour appeler à l’aide.');
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Qui prévenir ?</Text>
      <View style={styles.grid}>
        {HELP_TARGETS.map((t) => (
          <BigButton
            key={t.id}
            label={t.label}
            icon={t.icon}
            variant={targets.includes(t.id) ? 'selected' : 'secondary'}
            onPress={() => toggle(t.id)}
            style={styles.cell}
          />
        ))}
      </View>
      <Text style={styles.title}>Motif (facultatif)</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.notes}
      >
        {NOTES.map((n) => (
          <BigButton
            key={n}
            label={n}
            variant={note === n ? 'selected' : 'secondary'}
            onPress={() => setNote(note === n ? '' : n)}
          />
        ))}
      </ScrollView>
      <View style={[styles.actions, { flexDirection: row }]}>
        <BigButton label="Annuler" onPress={() => onDone(null)} style={styles.secondary} />
        <BigButton
          label="Envoyer l’appel"
          icon="🆘"
          variant="danger"
          large
          disabled={!targets.length}
          onPress={send}
          style={styles.primary}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: { gap: spacing.sm },
    title: {
      color: c.textMuted,
      fontSize: font.small,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cell: { flexBasis: '47%', flexGrow: 1 },
    notes: { gap: spacing.sm },
    actions: { gap: spacing.sm },
    secondary: { flex: 1 },
    primary: { flex: 1.6 },
  });
