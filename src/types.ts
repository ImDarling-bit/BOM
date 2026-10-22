export type Role = 'user' | 'medic' | 'supply' | 'protection';

export type Hand = 'right' | 'left';

export interface Profile {
  /** UUID v4 généré localement. Ne quitte jamais le téléphone. */
  uuid: string;
  pseudo: string;
  /** 4 premiers caractères hexadécimaux de l'UUID, ex. "48F2". */
  tag: string;
  role: Role;
  createdAt: number;
}

/** Un·e proche dont on suit la position (grâce à son code de partage). */
export interface Friend {
  code: string;
  /** Nom donné localement ; à défaut, le pseudo reçu du serveur. */
  label: string;
}

export interface Settings {
  hand: Hand;
  /** Partager une position arrondie (~100 m) pour le chat et la carte. */
  shareLocation: boolean;
  /** Partager sa position précise avec ses proches (ceux qui ont son code). */
  shareWithFriends: boolean;
  /** Code à donner à ses proches. Généré à la première activation. */
  shareCode: string | null;
  friends: Friend[];
  /** 'default', un thème drapeau, ou 'custom'. */
  themeId: string;
  customAccent: string | null;
}

export interface Coords {
  latitude: number;
  longitude: number;
}

export interface ChatMessage {
  id: string;
  /** "Pseudo#48F2" */
  author: string;
  role: Role;
  text: string;
  latitude?: number;
  longitude?: number;
  ts: number;
}

/** Points posés sous le viseur. */
export type PointType = 'danger' | 'teargas' | 'medic' | 'supply' | 'test';
/** Zones dessinées : la nasse est une bande le long d'une rue. */
export type AreaType = 'kettle' | 'safe_zone' | 'danger_zone';
export type ReportType = PointType | AreaType;

export interface Report {
  id: string;
  type: ReportType;
  /** Position du point, ou centre de la zone. */
  latitude: number;
  longitude: number;
  /** Sommets [longitude, latitude] d'une zone. */
  area?: [number, number][];
  author: string;
  createdAt: number;
  expiresAt: number;
  /** Ajouté localement, pas encore confirmé par le serveur. */
  pending?: boolean;
}

/** Rôles qu'un appel à l'aide peut viser ; 'all' = tout le monde autour. */
export type HelpTarget = Role | 'all';

export interface HelpCall {
  id: string;
  author: string;
  role: Role;
  roles: HelpTarget[];
  note: string;
  latitude: number;
  longitude: number;
  createdAt: number;
  expiresAt: number;
}

export interface FriendPosition {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  ts: number;
}

export interface FriendPanic {
  code: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  ts: number;
}

export interface WikiSection {
  heading: string;
  body: string;
}

export interface WikiArticle {
  id: string;
  category: string;
  title: string;
  summary: string;
  sections: WikiSection[];
}
