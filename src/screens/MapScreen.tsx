import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
} from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '../components/BigButton';
import { HelpSheet } from '../components/HelpSheet';
import { Icon, type IconName } from '../components/Icon';
import { ReportMenu } from '../components/ReportMenu';
import { CONFIG, FALLBACK_COORDS } from '../config';
import { useApp } from '../context/AppContext';
import { useField } from '../context/FieldContext';
import { useLocation } from '../context/LocationContext';
import { useHand } from '../hooks/useHand';
import { createReport, fetchReports } from '../services/api';
import { chatSocket } from '../services/chatSocket';
import { loadReports, saveReports } from '../storage/storage';
import { type Colors, elevation, font, radius, spacing, touch } from '../theme';
import { useStyles, useTheme } from '../theme/ThemeContext';
import type { Coords, Report, ReportType } from '../types';
import { centroid, distanceMeters, formatDistance, streetBand } from '../utils/geo';
import { success, tap, warning } from '../utils/haptics';
import { newId } from '../utils/id';
import { helpTargetLabel, type ReportMeta, reportMeta, timeAgo } from '../utils/labels';

const REFRESH_MS = 60_000;
const ZOOM = 15;
type LngLat = [number, number];
const lngLat = (c: Coords): LngLat => [c.longitude, c.latitude];
const HELP_COLOR = '#B000D8';

/** Message affiché dans la zone du pouce (touché = masqué). */
interface Notice {
  text: string;
  icon?: IconName;
  color?: string;
}

/** Ce que fait la zone du pouce : rien, choisir un type, dessiner une zone, appeler à l'aide. */
type Mode =
  | { kind: 'idle' }
  | { kind: 'pick' }
  | { kind: 'aim'; meta: ReportMeta }
  | { kind: 'draw'; meta: ReportMeta; points: LngLat[] }
  | { kind: 'help' };

export function MapScreen({ focus }: { focus: (Coords & { at: number }) | null }) {
  const { profile } = useApp();
  const { coords, permission } = useLocation();
  const { helps, myHelp, friends, panics, cancelHelp } = useField();
  const { row, edge } = useHand();
  const [sheetHeight, setSheetHeight] = useState(0);
  const { scheme, colors } = useTheme();
  const styles = useStyles(makeStyles);
  const cameraRef = useRef<CameraRef>(null);
  const center = useRef<Coords>(coords ?? FALLBACK_COORDS);
  const centeredOnce = useRef(false);
  const loaded = useRef(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice | null>(null);
  // Horloge pour masquer les signalements expirés et rafraîchir « il y a X min ».
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const upsert = useCallback((r: Report) => {
    setReports((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
  }, []);

  // Cache local (affichage immédiat, même hors ligne) + temps réel.
  useEffect(() => {
    loadReports().then((cached) => {
      loaded.current = true;
      setReports((prev) => (prev.length ? prev : cached));
    });
    const offAdd = chatSocket.on('report', upsert);
    const offDel = chatSocket.on('reportRemoved', (id) =>
      setReports((prev) => prev.filter((r) => r.id !== id))
    );
    return () => {
      offAdd();
      offDel();
    };
  }, [upsert]);

  // Rafraîchissement périodique depuis l'API REST + purge des signalements expirés.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const fresh = await fetchReports(center.current);
        if (alive) setReports((prev) => [...prev.filter((r) => r.pending), ...fresh]);
      } catch {
        if (alive) setReports((prev) => prev.filter((r) => r.expiresAt > Date.now()));
      }
    };
    void refresh();
    const t = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (loaded.current) void saveReports(reports.filter((r) => !r.pending));
  }, [reports]);

  // Centrage automatique la première fois que la position arrive.
  useEffect(() => {
    if (coords && !centeredOnce.current && !focus) {
      centeredOnce.current = true;
      cameraRef.current?.easeTo({ center: lngLat(coords), zoom: ZOOM, duration: 400 });
    }
  }, [coords, focus]);

  // « Voir sur la carte » depuis une alerte.
  useEffect(() => {
    if (!focus) return;
    centeredOnce.current = true;
    const t = setTimeout(
      () => cameraRef.current?.easeTo({ center: lngLat(focus), zoom: 17, duration: 500 }),
      150
    );
    return () => clearTimeout(t);
  }, [focus]);

  const recenter = () => {
    if (coords) cameraRef.current?.easeTo({ center: lngLat(coords), zoom: ZOOM, duration: 300 });
    else setNotice({ text: 'Position indisponible.', icon: 'pin' });
  };

  const author = profile ? `${profile.pseudo}#${profile.tag}` : '?';

  const submit = async (type: ReportType, area?: LngLat[]) => {
    if (!profile) return;
    setMode({ kind: 'idle' });
    const position = area ? centroid(area) : { ...center.current };
    const temp = pendingReport(type, position, author, area);
    upsert(temp);
    try {
      const saved = await createReport({ type, position, area, author });
      setReports((prev) => [saved, ...prev.filter((r) => r.id !== temp.id && r.id !== saved.id)]);
      success();
      setNotice({
        text: `${reportMeta(type).label} signalé.`,
        icon: reportMeta(type).icon,
        color: reportMeta(type).color,
      });
    } catch {
      setReports((prev) => prev.filter((r) => r.id !== temp.id));
      warning();
      setNotice({
        text: 'Échec de l’envoi : réseau indisponible. Réessaie.',
        icon: 'danger',
        color: colors.warning,
      });
    }
  };

  const visible = useMemo(() => reports.filter((r) => r.expiresAt > now), [reports, now]);
  const drawing = mode.kind === 'draw' ? mode : null;

  // Zones (signalements + brouillon en cours) dessinées par MapLibre.
  const shapes = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = visible
      .filter((r) => r.area)
      .map((r) => polygon(r.area as LngLat[], reportMeta(r.type).color, r.pending ? 0.12 : 0.25));
    if (drawing) {
      const ring = draftRing(drawing);
      if (ring) features.push(polygon(ring, drawing.meta.color, 0.3));
    }
    return { type: 'FeatureCollection', features };
  }, [visible, drawing]);

  const onMapPress = (e: { nativeEvent: { lngLat: LngLat } }) => {
    if (!drawing) return;
    const p = e.nativeEvent.lngLat;
    tap();
    if (drawing.meta.draw === 'line' && drawing.points.length >= 2) return;
    setMode({ ...drawing, points: [...drawing.points, p] });
  };

  const info = (r: Report) => {
    const meta = reportMeta(r.type);
    const dist = coords ? ` · ${formatDistance(distanceMeters(coords, r))}` : '';
    setNotice({
      text: `${meta.label}${r.pending ? ' (envoi…)' : ''} · ${timeAgo(r.createdAt, now)} · ${r.author}${dist}`,
      icon: meta.icon,
      color: meta.color,
    });
  };

  const friendList = Object.values(friends);

  return (
    <View style={styles.root}>
      {/* MapLibre + tuiles OpenStreetMap (OpenFreeMap par défaut) : aucune clé, aucun SDK Google. */}
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={scheme === 'dark' ? CONFIG.mapStyle.dark : CONFIG.mapStyle.light}
        logo={false}
        attribution={false}
        compass={false}
        touchPitch={false}
        onPress={onMapPress}
        onRegionDidChange={(e) => {
          const [longitude, latitude] = e.nativeEvent.center;
          center.current = { latitude, longitude };
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: lngLat(coords ?? FALLBACK_COORDS), zoom: ZOOM }}
        />
        {permission === 'granted' ? <UserLocation /> : null}

        <GeoJSONSource id="zones" data={shapes}>
          <Layer
            type="fill"
            id="zones-fill"
            paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] }}
          />
          <Layer
            type="line"
            id="zones-line"
            paint={{ 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1] }}
          />
        </GeoJSONSource>

        {visible.map((r) => {
          const meta = reportMeta(r.type);
          return (
            <Marker
              key={r.id}
              id={r.id}
              lngLat={[r.longitude, r.latitude]}
              anchor="center"
              onPress={() => info(r)}
            >
              <View
                style={[
                  styles.pin,
                  r.area ? styles.pinSmall : null,
                  { borderColor: meta.color, opacity: r.pending ? 0.6 : 1 },
                ]}
                accessibilityLabel={meta.label}
              >
                <Icon
                  name={meta.icon}
                  size={r.area ? 17 : 22}
                  color={meta.color}
                  strokeWidth={2.6}
                />
              </View>
            </Marker>
          );
        })}

        {helps.map((h) => (
          <Marker
            key={`help-${h.id}`}
            id={`help-${h.id}`}
            lngLat={[h.longitude, h.latitude]}
            anchor="center"
            onPress={() =>
              setNotice({
                text: `${h.author} cherche : ${h.roles.map(helpTargetLabel).join(', ')}${h.note ? ` « ${h.note} »` : ''} · ${timeAgo(h.createdAt, now)}`,
                icon: 'help',
                color: HELP_COLOR,
              })
            }
          >
            <View style={[styles.pin, styles.helpPin]}>
              <Icon name="help" size={26} color={HELP_COLOR} strokeWidth={2.6} />
            </View>
          </Marker>
        ))}

        {friendList.map((f) => (
          <Marker
            key={`friend-${f.code}`}
            id={`friend-${f.code}`}
            lngLat={[f.longitude, f.latitude]}
            anchor="bottom"
            onPress={() =>
              setNotice({
                text: `${f.name} · position ${timeAgo(f.ts, now)}`,
                icon: 'friend',
                color: colors.success,
              })
            }
          >
            <View style={styles.friend}>
              <Icon name="friend" size={14} color={colors.success} strokeWidth={2.8} />
              <Text style={styles.friendText} numberOfLines={1}>
                {f.name.split('#')[0]}
              </Text>
            </View>
          </Marker>
        ))}

        {panics
          .filter((p) => p.latitude !== null && p.longitude !== null)
          .map((p) => (
            <Marker
              key={`panic-${p.code}`}
              id={`panic-${p.code}`}
              lngLat={[p.longitude as number, p.latitude as number]}
              anchor="center"
              onPress={() =>
                setNotice({
                  text: `${p.name} a purgé son téléphone ici · ${timeAgo(p.ts, now)}`,
                  icon: 'purge',
                  color: colors.danger,
                })
              }
            >
              <View style={[styles.pin, styles.panicPin]}>
                <Icon name="purge" size={24} color={colors.danger} strokeWidth={2.6} />
              </View>
            </Marker>
          ))}

        {drawing?.points.map((p, i) => (
          <Marker key={`v-${i}`} id={`v-${i}`} lngLat={p} anchor="center">
            <View style={[styles.vertex, { borderColor: drawing.meta.color }]} />
          </Marker>
        ))}
      </Map>

      {/* Viseur en croix : le point est posé exactement au centre de la carte. */}
      {mode.kind === 'aim' ? (
        <View pointerEvents="none" style={styles.crosshairWrap}>
          <View style={styles.cross}>
            <View style={[styles.aimBadge, { borderColor: mode.meta.color }]}>
              <Icon name={mode.meta.icon} size={24} color={mode.meta.color} strokeWidth={2.6} />
            </View>
            <View style={[styles.crossBar, styles.crossH, { backgroundColor: colors.accent }]} />
            <View style={[styles.crossBar, styles.crossV, { backgroundColor: colors.accent }]} />
            <View style={[styles.crossCenter, { borderColor: colors.accent }]} />
          </View>
        </View>
      ) : null}

      <SafeAreaView edges={['top']} pointerEvents="none" style={styles.top}>
        <Text style={styles.attribution}>© OpenStreetMap · OpenMapTiles · OpenFreeMap</Text>
        {bannerText(mode) || permission === 'denied' ? (
          <View style={styles.banner}>
            {bannerText(mode) ? <Text style={styles.bannerText}>{bannerText(mode)}</Text> : null}
            {permission === 'denied' ? (
              <Text style={styles.bannerWarn}>
                Localisation refusée : carte centrée par défaut.
              </Text>
            ) : null}
          </View>
        ) : null}
      </SafeAreaView>

      {/* Recentrer : bouton rond flottant côté pouce, juste au-dessus du panneau. */}
      {mode.kind === 'idle' || mode.kind === 'aim' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Centrer sur ma position"
          onPress={() => {
            tap();
            recenter();
          }}
          hitSlop={8}
          style={({ pressed }) => [
            styles.fab,
            edge(spacing.md),
            { bottom: sheetHeight + spacing.md },
            pressed && styles.fabPressed,
          ]}
        >
          <Icon name="crosshair" size={26} color={colors.text} strokeWidth={2.4} />
        </Pressable>
      ) : null}

      {/* Zone du pouce (masquée pendant que le menu latéral est ouvert) */}
      <View
        style={[styles.bottom, mode.kind === 'pick' && styles.hidden]}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        {notice ? (
          <Pressable
            onPress={() => setNotice(null)}
            accessibilityRole="button"
            accessibilityHint="Masquer"
          >
            <View style={styles.notice}>
              {notice.icon ? (
                <Icon name={notice.icon} size={22} color={notice.color} strokeWidth={2.5} />
              ) : null}
              <Text style={styles.noticeText}>{notice.text}</Text>
            </View>
          </Pressable>
        ) : null}

        {mode.kind === 'idle' ? (
          <>
            {myHelp ? (
              <View style={[styles.myHelp, { flexDirection: row }]}>
                <Icon name="help" size={22} color={HELP_COLOR} strokeWidth={2.6} />
                <Text style={styles.myHelpText}>
                  Appel en cours ·{' '}
                  {myHelp.notified === null
                    ? 'envoi…'
                    : `${myHelp.notified} personne(s) prévenue(s)`}
                </Text>
                <BigButton label="Annuler" onPress={cancelHelp} style={styles.myHelpBtn} />
              </View>
            ) : null}
            <View style={[styles.actions, { flexDirection: row }]}>
              <BigButton
                label="Aide"
                icon="help"
                variant="danger"
                onPress={() => {
                  setNotice(null);
                  setMode({ kind: 'help' });
                }}
                style={styles.secondary}
              />
              <BigButton
                label="Signaler"
                icon="plus"
                variant="primary"
                large
                onPress={() => {
                  setNotice(null);
                  setMode({ kind: 'pick' });
                }}
                style={styles.primary}
              />
            </View>
          </>
        ) : null}

        {mode.kind === 'aim' ? (
          <>
            <View style={styles.hintRow}>
              <Icon name={mode.meta.icon} size={22} color={mode.meta.color} strokeWidth={2.6} />
              <Text style={styles.drawHint}>
                Déplace la carte : la croix marque l’endroit exact.
              </Text>
            </View>
            <View style={[styles.actions, { flexDirection: row }]}>
              <BigButton
                label="Annuler"
                onPress={() => setMode({ kind: 'idle' })}
                style={styles.secondary}
              />
              <BigButton
                label="Changer"
                icon="menu"
                onPress={() => setMode({ kind: 'pick' })}
                style={styles.secondary}
              />
              <BigButton
                label="Poser ici"
                icon="check"
                variant="primary"
                large
                onPress={() => void submit(mode.meta.id)}
                style={styles.primary}
              />
            </View>
          </>
        ) : null}

        {drawing ? (
          <>
            <View style={styles.hintRow}>
              <Icon
                name={drawing.meta.icon}
                size={22}
                color={drawing.meta.color}
                strokeWidth={2.6}
              />
              <Text style={styles.drawHint}>{drawHint(drawing)}</Text>
            </View>
            <View style={[styles.actions, { flexDirection: row }]}>
              <BigButton
                label="Annuler"
                onPress={() => setMode({ kind: 'idle' })}
                style={styles.secondary}
              />
              <BigButton
                label="Effacer"
                icon="undo"
                disabled={!drawing.points.length}
                onPress={() => setMode({ ...drawing, points: drawing.points.slice(0, -1) })}
                style={styles.secondary}
              />
              <BigButton
                label="Valider"
                icon="check"
                variant="primary"
                large
                disabled={!draftRing(drawing)}
                onPress={() => {
                  const ring = draftRing(drawing);
                  if (ring) void submit(drawing.meta.id, ring);
                }}
                style={styles.primary}
              />
            </View>
          </>
        ) : null}

        {mode.kind === 'help' ? (
          <HelpSheet
            onDone={(msg) => {
              setMode({ kind: 'idle' });
              if (msg) setNotice({ text: msg, icon: 'help', color: HELP_COLOR });
            }}
          />
        ) : null}
      </View>

      {mode.kind === 'pick' ? (
        <ReportMenu
          onClose={() => setMode({ kind: 'idle' })}
          onPick={(meta) =>
            setMode(
              meta.draw === 'point' ? { kind: 'aim', meta } : { kind: 'draw', meta, points: [] }
            )
          }
        />
      ) : null}
    </View>
  );
}

function bannerText(mode: Mode): string | null {
  if (mode.kind === 'pick') return 'Que veux-tu signaler ?';
  if (mode.kind === 'aim') return `${mode.meta.label} : vise avec la croix`;
  if (mode.kind === 'draw') return mode.meta.label;
  if (mode.kind === 'help') return 'Ta position sera partagée.';
  return null;
}

function drawHint(d: { meta: ReportMeta; points: LngLat[] }): string {
  if (d.meta.draw === 'line') {
    if (d.points.length === 0) return 'Touche le DÉBUT de la rue nassée.';
    if (d.points.length === 1) return 'Touche la FIN de la rue nassée.';
    return 'Rue marquée. Valide ou efface un point.';
  }
  const left = Math.max(0, 3 - d.points.length);
  return left
    ? `Touche la carte pour placer les coins (encore ${left} minimum).`
    : `${d.points.length} coins. Ajoute-en ou valide.`;
}

/** Polygone du brouillon : bande de rue (nasse) ou zone libre. */
function draftRing(d: { meta: ReportMeta; points: LngLat[] }): LngLat[] | null {
  if (d.meta.draw === 'line') {
    return d.points.length === 2
      ? streetBand(d.points[0], d.points[1], CONFIG.kettleWidthMeters)
      : null;
  }
  return d.points.length >= 3 ? d.points : null;
}

function polygon(ring: LngLat[], color: string, opacity: number): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    properties: { color, opacity },
  };
}

/** Signalement affiché tout de suite, en attendant la réponse du serveur. */
function pendingReport(
  type: ReportType,
  position: Coords,
  author: string,
  area?: LngLat[]
): Report {
  const createdAt = Date.now();
  return {
    id: `local-${newId()}`,
    type,
    ...position,
    ...(area ? { area } : {}),
    author,
    createdAt,
    expiresAt: createdAt + CONFIG.reportTtlMs,
    pending: true,
  };
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    top: { position: 'absolute', top: 0, left: 0, right: 0 },
    banner: {
      alignSelf: 'center',
      marginTop: spacing.xs,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: c.overlay,
      ...elevation(c, 1),
    },
    bannerText: { color: c.text, fontSize: font.body, fontWeight: '700' },
    bannerWarn: { color: c.warning, fontSize: font.small, marginTop: spacing.xs },
    attribution: {
      alignSelf: 'flex-start',
      marginLeft: spacing.sm,
      color: c.textMuted,
      fontSize: 10,
      opacity: 0.8,
    },
    pin: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      borderWidth: 2,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...elevation(c, 1),
    },
    pinSmall: { width: 34, height: 34, borderWidth: 2 },
    helpPin: { borderColor: HELP_COLOR, width: 50, height: 50 },
    panicPin: { borderColor: c.danger },
    friend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: c.surface,
      borderColor: c.success,
      borderWidth: 2,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      maxWidth: 140,
      ...elevation(c, 1),
    },
    friendText: { color: c.text, fontSize: 13, fontWeight: '800' },
    vertex: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, backgroundColor: c.surface },
    crosshairWrap: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cross: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
    crossBar: {
      position: 'absolute',
      borderRadius: 2,
      borderWidth: 1,
      borderColor: c.shadow,
    },
    crossH: { width: 72, height: 6, top: 33, left: 0 },
    crossV: { width: 6, height: 72, left: 33, top: 0 },
    crossCenter: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 3,
      backgroundColor: c.surface,
    },
    aimBadge: {
      position: 'absolute',
      top: -58,
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 3,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...elevation(c, 1),
    },
    bottom: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: spacing.md,
      gap: spacing.sm,
      backgroundColor: c.overlay,
      borderTopLeftRadius: radius.lg + 6,
      borderTopRightRadius: radius.lg + 6,
      ...elevation(c, 2),
    },
    hidden: { display: 'none' },
    fab: {
      position: 'absolute',
      width: touch.min,
      height: touch.min,
      borderRadius: touch.min / 2,
      backgroundColor: c.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      ...elevation(c, 1),
    },
    fabPressed: { opacity: 0.7, transform: [{ scale: 0.95 }] },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      backgroundColor: c.surfaceHigh,
      borderRadius: radius.md,
    },
    noticeText: { flex: 1, color: c.text, fontSize: font.body, fontWeight: '700' },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    myHelp: {
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm,
      paddingLeft: spacing.md,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: HELP_COLOR,
    },
    myHelpText: { flex: 1, color: c.text, fontSize: font.small, fontWeight: '800' },
    myHelpBtn: { minWidth: 110 },
    drawHint: { flex: 1, color: c.text, fontSize: font.body, fontWeight: '800' },
    actions: { gap: spacing.sm },
    secondary: { flex: 1 },
    primary: { flex: 1.5 },
  });
