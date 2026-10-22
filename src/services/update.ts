import { Platform } from 'react-native';

import { CONFIG } from '../config';

export interface UpdateInfo {
  version: string;
  /** Fichier à installer (APK sur Android), ou page de la version. */
  url: string;
  pageUrl: string;
}

/** Compare "1.2.10" et "1.2.9" : > 0 si a est plus récent. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const isGithubUrl = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/github\.com\//.test(u);

/**
 * Regarde la dernière Release du dépôt GitHub. Renvoie null s'il n'y a rien de
 * plus récent, si la vérification est désactivée ou si le réseau échoue.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!CONFIG.updateRepo || CONFIG.appVersion === '0.0.0') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.updateRepo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      assets?: { name?: unknown; browser_download_url?: unknown }[];
    };
    if (typeof data.tag_name !== 'string' || !isGithubUrl(data.html_url)) return null;
    const version = data.tag_name.replace(/^v/, '');
    if (compareVersions(version, CONFIG.appVersion) <= 0) return null;
    const wanted = Platform.OS === 'ios' ? 'app-release.ipa' : 'app-release.apk';
    const asset = data.assets?.find((a) => a.name === wanted);
    // iOS ne permet pas d'installer un IPA depuis le navigateur : on ouvre la page.
    const url =
      Platform.OS === 'android' && isGithubUrl(asset?.browser_download_url)
        ? asset.browser_download_url
        : data.html_url;
    return { version, url, pageUrl: data.html_url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
