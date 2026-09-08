import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '@/lib/env';
import { getSetting, setSetting } from '@/lib/admin/settings';

/**
 * Détection des mises à jour publiées sur GitHub.
 *
 * Parcelys s'auto-héberge : personne ne pousse de mise à jour à la place de
 * l'exploitant, et rien ne s'installe tout seul. Ce module se contente de
 * **regarder** si une version plus récente a été publiée, et de le dire dans
 * la section d'administration et dans l'application de terrain.
 *
 * Trois principes :
 *
 *  - **Rien n'est interrogé sans configuration.** Sans `UPDATE_REPOSITORY`,
 *    aucune requête ne part — une instance à l'abri du réseau reste à l'abri.
 *  - **Rien n'est inventé.** Si l'appel échoue, la réponse dit qu'elle a
 *    échoué ; elle n'affirme jamais « à jour » par défaut.
 *  - **Rien ne s'installe.** La mise à jour reste une opération manuelle,
 *    décrite dans `docs/DEPLOIEMENT.md`. On n'exécute pas du code téléchargé
 *    sur la foi d'une réponse HTTP.
 */

export type ReleaseInfo = {
  /** Version publiée, sans le « v » initial. */
  version: string;
  /** Nom de la publication, tel qu'il figure sur GitHub. */
  name: string;
  url: string;
  publishedAt: string;
  notes: string;
  /** APK joint à la publication, quand le workflow l'a produit. */
  apkUrl: string | null;
};

export type UpdateStatus = {
  /** Version de cette instance, lue dans `package.json`. */
  current: string;
  /** `null` quand la vérification n'est pas configurée ou a échoué. */
  latest: ReleaseInfo | null;
  /** `true` seulement si une version strictement plus récente existe. */
  updateAvailable: boolean;
  checkedAt: string | null;
  /** Dépôt surveillé, `null` si la vérification est désactivée. */
  repository: string | null;
  /** Message d'erreur si la dernière vérification n'a pas abouti. */
  error: string | null;
};

const CACHE_KEY = 'updates.lastCheck';
/** Une vérification par heure suffit, et ménage l'API publique de GitHub. */
const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedVersion: string | null = null;

/** Version de l'instance, lue une fois dans `package.json`. */
export async function currentVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    const raw = await readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    cachedVersion = (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

/**
 * Comparaison de deux versions sémantiques.
 *
 * Renvoie un nombre positif si `a` est postérieure à `b`. Les suffixes de
 * pré-publication (`1.2.0-rc.1`) sont considérés comme antérieurs à la version
 * finale, conformément à la convention SemVer.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = '', pre = ''] = value.replace(/^v/, '').split('-', 2);
    const parts = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { parts, pre };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Cœur identique : une pré-publication précède la version finale.
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre);
}

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

/**
 * Dernière publication du dépôt surveillé.
 *
 * Un échec renvoie une erreur explicite plutôt qu'un « à jour » rassurant :
 * une instance qui ne sait pas où elle en est doit le dire.
 */
async function fetchLatestRelease(
  repository: string,
): Promise<{ release: ReleaseInfo | null; error: string | null }> {
  const url = `https://api.github.com/repos/${repository}/releases/latest`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Parcelys',
      },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });

    if (response.status === 404) {
      return { release: null, error: 'Aucune version publiée sur ce dépôt.' };
    }
    if (!response.ok) {
      return { release: null, error: `GitHub a répondu ${response.status}.` };
    }

    const data = (await response.json()) as GitHubRelease;
    if (!data.tag_name) {
      return { release: null, error: 'Réponse GitHub inexploitable.' };
    }

    const apk = (data.assets ?? []).find((asset) =>
      asset.name?.toLowerCase().endsWith('.apk'),
    );

    return {
      release: {
        version: data.tag_name.replace(/^v/, ''),
        name: data.name || data.tag_name,
        url: data.html_url ?? `https://github.com/${repository}/releases`,
        publishedAt: data.published_at ?? new Date().toISOString(),
        // Les notes viennent d'un dépôt distant : elles sont affichées comme du
        // texte, jamais interprétées, et bornées pour ne pas noyer la page.
        notes: (data.body ?? '').slice(0, 4000),
        apkUrl: apk?.browser_download_url ?? null,
      },
      error: null,
    };
  } catch {
    return { release: null, error: 'Dépôt injoignable (réseau ou délai dépassé).' };
  }
}

type CachedCheck = {
  checkedAt: string;
  release: ReleaseInfo | null;
  error: string | null;
};

/** Le cache est un réglage d'instance : une valeur illisible est ignorée. */
function readCache(raw: string | null): CachedCheck | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedCheck;
    return typeof parsed?.checkedAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * État des mises à jour, avec un cache d'une heure en base.
 *
 * `force` ignore le cache : c'est le bouton « Vérifier maintenant » de la
 * section d'administration.
 */
export async function getUpdateStatus(force = false): Promise<UpdateStatus> {
  const env = getEnv();
  const current = await currentVersion();
  const repository = env.UPDATE_REPOSITORY ?? null;

  if (!repository) {
    return {
      current,
      latest: null,
      updateAvailable: false,
      checkedAt: null,
      repository: null,
      error: null,
    };
  }

  const cached = readCache(await getSetting(CACHE_KEY));
  const fresh =
    cached !== null &&
    !force &&
    Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_MS;

  const check: CachedCheck =
    fresh && cached
      ? cached
      : {
          checkedAt: new Date().toISOString(),
          ...(await fetchLatestRelease(repository)),
        };

  if (!fresh) await setSetting(CACHE_KEY, JSON.stringify(check));

  return {
    current,
    latest: check.release,
    updateAvailable:
      check.release !== null && compareVersions(check.release.version, current) > 0,
    checkedAt: check.checkedAt,
    repository,
    error: check.error,
  };
}
