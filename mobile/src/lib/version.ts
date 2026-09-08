/**
 * Comparaison de versions sémantiques.
 *
 * Renvoie un nombre positif si `a` est postérieure à `b`. Un suffixe de
 * pré-publication (`1.2.0-rc.1`) précède la version finale, comme le veut
 * SemVer. Même logique que côté serveur (`src/lib/updates/releases.ts`),
 * redéclarée ici : l'application est empaquetée séparément et ne partage aucun
 * module avec le serveur.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = '', pre = ''] = value.replace(/^v/, '').split('-', 2);
    return {
      parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre,
    };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre);
}
