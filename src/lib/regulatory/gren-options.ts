import 'server-only';
import { prisma } from '@/lib/prisma';
import { badRequest } from '@/lib/api/errors';
import type { ClassementDeclare } from '@/lib/regulatory/classement-produit';

/**
 * Les dénominations entre lesquelles un exploitant classe son produit.
 *
 * Elles viennent de la fiche 19 du référentiel GREN **importé** — jamais
 * d'une liste écrite dans le code : si la fiche change, la liste change avec
 * elle, et un produit classé selon l'ancienne version garde un code que la
 * nouvelle ne connaît peut-être plus (il est alors signalé, pas réécrit).
 */

export type OptionDenomination = { code: string; libelle: string };

export type OptionsClassement = {
  /** Le référentiel lu ; `null` s'il n'est pas importé. */
  referentiel: { version: string; source: string; depuis: string } | null;
  aplsh: OptionDenomination[];
  keq: OptionDenomination[];
  teneur: (OptionDenomination & { teneurKgN: number | null })[];
};

function denominations(valeur: unknown): OptionDenomination[] {
  if (!Array.isArray(valeur)) return [];
  return valeur.flatMap((p) => {
    if (!p || typeof p !== 'object') return [];
    const { code, libelle } = p as { code?: unknown; libelle?: unknown };
    return typeof code === 'string' && typeof libelle === 'string' ? [{ code, libelle }] : [];
  });
}

/** Les dénominations de la version du GREN en vigueur aujourd'hui. */
export async function optionsClassement(at = new Date()): Promise<OptionsClassement> {
  const referentiel = await prisma.regulatoryReferential.findFirst({
    where: {
      code: 'gren',
      status: 'ACTIF',
      appliesFrom: { lte: at },
      OR: [{ appliesTo: null }, { appliesTo: { gte: at } }],
    },
    orderBy: { appliesFrom: 'desc' },
    select: { id: true, version: true, sourceLabel: true, appliesFrom: true },
  });
  if (!referentiel) return { referentiel: null, aplsh: [], keq: [], teneur: [] };

  const regles = await prisma.regulatoryRule.findMany({
    where: {
      referentialId: referentiel.id,
      code: { in: ['gren-aplsh', 'gren-keq', 'gren-teneurs-pro'] },
      appliesFrom: { lte: at },
      OR: [{ appliesTo: null }, { appliesTo: { gte: at } }],
    },
    orderBy: { appliesFrom: 'desc' },
    select: { code: true, value: true },
  });
  const valeur = (code: string) =>
    (regles.find((r) => r.code === code)?.value ?? null) as Record<string, unknown> | null;

  const keqCles = valeur('gren-keq')?.cles;
  const cleProduit = Array.isArray(keqCles)
    ? (keqCles as { nom?: unknown; valeurs?: unknown }[]).find((c) => c.nom === 'pro')
    : undefined;

  const teneurs = valeur('gren-teneurs-pro')?.produits;
  return {
    referentiel: {
      version: referentiel.version,
      source: referentiel.sourceLabel,
      depuis: (referentiel.appliesFrom ?? at).toISOString().slice(0, 10),
    },
    aplsh: denominations(valeur('gren-aplsh')?.produits),
    keq: denominations(cleProduit?.valeurs),
    teneur: Array.isArray(teneurs)
      ? denominations(teneurs).map((d) => {
          const ligne = (teneurs as { code?: unknown; teneur?: unknown }[]).find((p) => p.code === d.code);
          return { ...d, teneurKgN: typeof ligne?.teneur === 'number' ? ligne.teneur : null };
        })
      : [],
  };
}

/**
 * Refuse un classement dont une dénomination n'existe pas dans la fiche 19
 * en vigueur : un code inconnu ne serait trouvé par aucune règle, et le
 * contrôle resterait indéterminé sans que personne ne sache pourquoi.
 */
export async function verifierClassement(classement: ClassementDeclare | null): Promise<void> {
  if (!classement) return;
  const declares = (['aplsh', 'keq', 'teneur'] as const).filter((cle) => classement[cle]);
  if (declares.length === 0) return;

  const options = await optionsClassement();
  if (!options.referentiel) {
    throw badRequest(
      'Le référentiel GREN n’est pas importé : les dénominations de la fiche 19 ne peuvent pas être vérifiées. Seul le type (0, I, II, III) peut être déclaré.',
    );
  }
  for (const cle of declares) {
    const code = classement[cle];
    if (!options[cle].some((o) => o.code === code)) {
      throw badRequest(`Dénomination « ${code} » absente de la fiche 19 en vigueur (${options.referentiel.version}).`);
    }
  }
}
