import { useState } from 'react';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { HandPicker } from '../components/HandPicker';
import { RolePicker } from '../components/RolePicker';
import { Section } from '../components/Section';
import { ThumbScroll } from '../components/ThumbScroll';
import { useApp } from '../context/AppContext';
import { type Colors, font, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import type { Hand, Role } from '../types';
import { success } from '../utils/haptics';

const PSEUDO_MIN = 2;
const PSEUDO_MAX = 20;

export function OnboardingScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { createProfile, settings } = useApp();
  const [pseudo, setPseudo] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [hand, setHand] = useState<Hand>(settings.hand);

  const clean = pseudo.trim();
  const valid = clean.length >= PSEUDO_MIN && clean.length <= PSEUDO_MAX;

  const submit = async () => {
    if (!valid) return;
    success();
    await createProfile(clean, role, hand);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.root} behavior="padding">
        <ThumbScroll>
          <View style={styles.intro}>
            <Text style={styles.title} accessibilityRole="header">
              BOM
            </Text>
            <Text style={styles.subtitle}>Boîte à Outils de Manifestation</Text>
            <Text style={styles.text}>
              Aucun compte, aucun e-mail. Ton identité est un pseudo + un code aléatoire créé sur ce
              téléphone.
            </Text>
            <Text style={styles.notice}>
              Les organisateurs qui gèrent le serveur voient ton pseudo, ton rôle et ta position
              arrondie (~100 m) tant que le partage est activé. Tu peux le couper dans les réglages.
            </Text>
          </View>

          <Section title="Ta main" hint="Les boutons principaux se placeront sous ton pouce.">
            <HandPicker value={hand} onChange={setHand} />
          </Section>

          <Section title="Ton rôle">
            <RolePicker value={role} onChange={setRole} />
          </Section>

          <Section title="Ton pseudo" hint="N'utilise pas ton vrai nom.">
            <TextInput
              value={pseudo}
              onChangeText={setPseudo}
              placeholder="ex. Mouette"
              placeholderTextColor={colors.textMuted}
              maxLength={PSEUDO_MAX}
              autoCorrect={false}
              autoCapitalize="none"
              autoComplete="off"
              textContentType="none"
              returnKeyType="done"
              onSubmitEditing={submit}
              style={styles.input}
              accessibilityLabel="Pseudo"
            />
          </Section>

          <BigButton
            label="Commencer"
            variant="primary"
            large
            disabled={!valid}
            onPress={submit}
            accessibilityHint={`Pseudo de ${PSEUDO_MIN} à ${PSEUDO_MAX} caractères`}
          />
        </ThumbScroll>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    intro: { gap: spacing.sm },
    title: { color: c.accent, fontSize: 56, fontWeight: '900', letterSpacing: 4 },
    subtitle: { color: c.text, fontSize: font.large, fontWeight: '800', marginTop: -spacing.sm },
    notice: { color: c.textMuted, fontSize: font.small, lineHeight: 21 },
    text: { color: c.text, fontSize: font.body, lineHeight: 26 },
    input: {
      minHeight: touch.primary,
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 2,
      borderRadius: radius.md,
      color: c.text,
      fontSize: font.large,
      paddingHorizontal: spacing.lg,
    },
  });
