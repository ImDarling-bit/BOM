import {
  ArrowLeft,
  Ban,
  Check,
  Circle,
  CircleArrowUp,
  CircleCheck,
  Construction,
  Cross,
  Crosshair,
  Download,
  Droplet,
  FlaskConical,
  Hand,
  HandFist,
  Heart,
  LifeBuoy,
  type LucideIcon,
  Map,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  OctagonX,
  Plus,
  RefreshCw,
  Scale,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  Users,
  Wind,
  X,
} from 'lucide-react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeContext';

// Icônes SVG Lucide (licence ISC) : nettes à toute taille et colorées par le thème,
// contrairement aux emojis qui changent d'un téléphone à l'autre.
const ICONS = {
  // Onglets
  map: Map,
  chat: MessageCircle,
  rights: Scale,
  settings: Settings,
  purge: OctagonX,
  // Rôles
  fist: HandFist,
  medic: Cross,
  supply: Droplet,
  protection: Shield,
  all: Megaphone,
  // Signalements
  danger: TriangleAlert,
  teargas: Wind,
  test: FlaskConical,
  kettle: Construction,
  safeZone: ShieldCheck,
  dangerZone: ShieldAlert,
  // Actions et états
  help: LifeBuoy,
  users: Users,
  friend: Heart,
  ban: Ban,
  pin: MapPin,
  refresh: RefreshCw,
  idle: Circle,
  hand: Hand,
  crosshair: Crosshair,
  plus: Plus,
  menu: Menu,
  check: Check,
  undo: Undo2,
  close: X,
  back: ArrowLeft,
  download: Download,
  update: CircleArrowUp,
  offline: CircleCheck,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 2.25,
  style,
  mirrored,
}: {
  name: IconName;
  size?: number;
  /** Par défaut : couleur du texte du thème. */
  color?: string;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  /** Retourne l'icône horizontalement (ex. main gauche). */
  mirrored?: boolean;
}) {
  const { colors } = useTheme();
  const Svg = ICONS[name];
  return (
    <Svg
      size={size}
      color={color ?? colors.text}
      strokeWidth={strokeWidth}
      style={[mirrored ? { transform: [{ scaleX: -1 }] } : null, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
