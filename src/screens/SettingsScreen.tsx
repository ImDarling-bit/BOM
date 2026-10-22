import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { FriendsSection } from '../components/FriendsSection';
import { HandPicker } from '../components/HandPicker';
import { Icon } from '../components/Icon';
import { RolePicker } from '../components/RolePicker';
import { ScreenHeader } from '../components/ScreenHeader';
import { Section } from '../components/Section';
import { ThemePicker } from '../components/ThemePicker';
import { ThumbScroll } from '../components/ThumbScroll';
import { CONFIG } from '../config';
import { useApp } from '../context/AppContext';
import { useLocation } from '../context/LocationContext';
import { checkForUpdate } from '../services/update';
import { type Colors, font, radius, spacing } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import { roleIcon, roleLabel } from '../utils/labels';

export function SettingsScreen() {
  const { profile, settings, updateSettings, updateProfile } = useApp();
  const { permission } = useLocation();
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  if (!profile) return null;

  const checkUpdate = async () => {
    setUpdateMsg('Recherche…');
    const u = await checkForUpdate();
    if (!u)
      return setUpdateMsg(
        CONFIG.updateRepo ? 'Tu as la dernière version.' : 'Vérification désactivée sur ce build.'
      );
    setUpdateMsg(`Version ${u.version} disponible : téléchargement…`);
    void Linking.openURL(u.url);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Réglages" />
      <ThumbScroll>
        <View style={styles.card}>
          <Text style={styles.name}>
            {profile.pseudo}
            <Text style={styles.tag}>#{profile.tag}</Text>
          </Text>
          <View style={styles.metaRow}>
            <Icon name={roleIcon(profile.role)} size={18} color={colors.accent} strokeWidth={2.5} />
            <Text style={[styles.meta, styles.flex]}>
              {roleLabel(profile.role)} · identifiant stocké uniquement sur ce téléphone
            </Text>
          </View>
        </View>

        <Section
          title="Apparence"
          hint="Clair ou sombre selon ton téléphone. Choisis ta couleur ou un drapeau."
        >
          <ThemePicker />
        </Section>

        <FriendsSection />

        <Section
          title="Position"
          hint={
            permission === 'denied'
              ? 'Localisation refusée dans les réglages du téléphone.'
              : 'Arrondie à ~100 m avant envoi au serveur. Jamais en arrière-plan.'
          }
        >
          <BigButton
            label={
              settings.shareLocation ? 'Chat local et carte : OUI' : 'Chat local et carte : NON'
            }
            icon={settings.shareLocation ? 'pin' : 'ban'}
            variant={settings.shareLocation ? 'selected' : 'secondary'}
            onPress={() => updateSettings({ shareLocation: !settings.shareLocation })}
          />
        </Section>

        <Section title="Rôle">
          <RolePicker value={profile.role} onChange={(role) => updateProfile({ role })} />
        </Section>

        <Section
          title="Main maîtresse"
          hint="Les boutons principaux et PURGE passent du côté de ton pouce."
        >
          <HandPicker value={settings.hand} onChange={(hand) => updateSettings({ hand })} />
        </Section>

        <Section
          title="Ce que voient les organisateurs"
          hint="Les admins du serveur voient en direct : ton pseudo, ton rôle, ta position arrondie (~100 m), tes messages du chat local, tes signalements, tes appels à l’aide et l’endroit d’une purge. Jamais ton identifiant complet ni ta position précise."
        >
          <Text style={styles.mono}>{CONFIG.wsUrl}</Text>
          <Text style={styles.mono}>{CONFIG.apiUrl}</Text>
        </Section>

        <Section
          title="Version"
          hint={`BOM ${CONFIG.appVersion} · Boîte à Outils de Manifestation`}
        >
          <BigButton
            label="Chercher une mise à jour"
            icon="update"
            onPress={() => void checkUpdate()}
          />
          {updateMsg ? <Text style={styles.meta}>{updateMsg}</Text> : null}
        </Section>
      </ThumbScroll>
    </SafeAreaView>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    name: { color: c.text, fontSize: font.title, fontWeight: '900' },
    tag: { color: c.accent },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    flex: { flex: 1 },
    meta: { color: c.textMuted, fontSize: font.small },
    mono: { color: c.textMuted, fontSize: font.small, fontFamily: 'monospace' },
  });
