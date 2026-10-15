import type { Finding } from '@/lib/regulatory/compliance';

/**
 * Regrouper les constats identiques.
 *
 * Le moteur rend un constat par parcelle : « Parcelle en zone vulnérable »
 * cent vingt fois sur une exploitation de cent trente parcelles. Affiché tel
 * quel, l'écran devenait une liste qu'on ne lit plus — et l'anomalie unique,
 * celle qui compte, s'y noyait.
 *
 * Deux constats se regroupent quand ils disent la même chose : même domaine,
 * même niveau, même règle (code et titre), même action, même source et même
 * version. Le détail propre à chaque parcelle reste consultable dans le
 * groupe ; rien n'est retiré, seulement rangé.
 */

export type GroupeDeConstats = {
  cle: string;
  domain: Finding['domain'];
  level: Finding['level'];
  code: string;
  title: string;
  action?: string;
  sourceLabel?: string;
  referentialVersion?: string;
  /** La règle appliquée — la même pour tout le groupe, puisque le code l'est. */
  trace?: Finding['trace'];
  constats: Finding[];
};

const GRAVITE: Record<Finding['level'], number> = {
  ANOMALIE: 0,
  VERIFICATION: 1,
  INDETERMINE: 2,
  OK: 3,
};

export function regrouperConstats(findings: Finding[]): GroupeDeConstats[] {
  const groupes = new Map<string, GroupeDeConstats>();
  for (const f of findings) {
    const cle = [f.domain, f.level, f.code, f.title, f.action ?? '', f.sourceLabel ?? '', f.referentialVersion ?? ''].join('\u0001');
    const groupe = groupes.get(cle);
    if (groupe) groupe.constats.push(f);
    else {
      groupes.set(cle, {
        cle,
        domain: f.domain,
        level: f.level,
        code: f.code,
        title: f.title,
        action: f.action,
        sourceLabel: f.sourceLabel,
        referentialVersion: f.referentialVersion,
        trace: f.trace,
        constats: [f],
      });
    }
  }
  // Le plus grave d'abord ; à gravité égale, ce qui touche le plus de parcelles.
  return [...groupes.values()].sort(
    (a, b) => GRAVITE[a.level] - GRAVITE[b.level] || b.constats.length - a.constats.length,
  );
}
