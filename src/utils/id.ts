import { getRandomBytes, randomUUID } from 'expo-crypto';

export const newId = () => randomUUID();

/** "48F2" à partir de l'UUID local. */
export const tagFromUuid = (uuid: string) => uuid.replace(/-/g, '').slice(0, 4).toUpperCase();

// Sans 0/O, 1/I : lisible à voix haute dans le bruit d'une manif.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code de partage de position : 8 caractères aléatoires (~40 bits). */
export function newShareCode(): string {
  const bytes = getRandomBytes(8);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** "ABCD2345" → "ABCD-2345" */
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/** Saisie libre → code normalisé, ou null s'il est invalide. */
export function parseCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}
