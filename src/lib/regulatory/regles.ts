import 'server-only';
import type { RegulatoryRule } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveReferential } from '@/lib/regulatory/referentials';

/**
 * Lecture des règles transcrites, avec leur traçabilité.
 *
 * Toute règle opposée à une parcelle doit pouvoir dire, à l'écran comme dans
 * un rapport : quelle règle, de quel référentiel et de quelle version, quel
 * texte (arrêté, article, page) et ce qu'il dit mot pour mot, sur quel
 * territoire, et depuis quand. C'est ce que porte `Trace` — et c'est ce que
 * l'exploitant présente en contrôle pour discuter d'un constat.
 *
 * ## La date
 *
 * Une règle se lit **à la date de l'intervention**, jamais à la date du jour :
 * un épandage de février 2024 relève du 6e programme d'actions (non fourni),
 * pas du 7e entré en vigueur le 1er septembre 2024. Sans référentiel en
 * vigueur à cette date, la réponse est « aucune règle », et l'appelant le dit.
 */

export type Trace = {
  regle: { code: string; libelle: string };
  referentiel: { code: string; version: string; source: string };
  /** Arrêté, article, page. */
  texte: string | null;
  /** Ce que dit le texte. */
  citation: string | null;
  territoire: string;
  validite: { du: string; au: string | null };
};

export type RegleLue = {
  code: string;
  libelle: string;
  condition: Record<string, unknown> | null;
  valeur: Record<string, unknown>;
  unite: string | null;
  exception: string | null;
  trace: Trace;
};

export type LectureRegles = {
  regles: RegleLue[];
  /** Le référentiel en vigueur, s'il y en a un. */
  referentiel: { code: string; version: string; source: string } | null;
  /** Pourquoi il n'y en a pas, quand il n'y en a pas. */
  raison: string | null;
};

function lue(
  regle: RegulatoryRule,
  referentiel: { code: string; version: string; sourceLabel: string },
): RegleLue {
  return {
    code: regle.code,
    libelle: regle.label,
    condition:
      regle.condition && typeof regle.condition === 'object' && !Array.isArray(regle.condition)
        ? (regle.condition as Record<string, unknown>)
        : null,
    valeur:
      regle.value && typeof regle.value === 'object' && !Array.isArray(regle.value)
        ? (regle.value as Record<string, unknown>)
        : { valeur: regle.value },
    unite: regle.unit,
    exception: regle.exception,
    trace: {
      regle: { code: regle.code, libelle: regle.label },
      referentiel: {
        code: referentiel.code,
        version: referentiel.version,
        source: referentiel.sourceLabel,
      },
      texte: regle.sourceRef,
      citation: regle.citation,
      territoire: regle.territory,
      validite: {
        du: regle.appliesFrom.toISOString().slice(0, 10),
        au: regle.appliesTo ? regle.appliesTo.toISOString().slice(0, 10) : null,
      },
    },
  };
}

/**
 * Les règles d'un référentiel en vigueur sur ces territoires à cette date.
 *
 * `codes` restreint la lecture ; absent, toutes les règles de la version sont
 * rendues.
 */
export async function lireRegles(params: {
  referentiel: string;
  territoires: string[];
  at: Date;
  codes?: string[];
}): Promise<LectureRegles> {
  const referentiel = await resolveReferential({
    code: params.referentiel,
    territories: params.territoires,
    at: params.at,
  }).catch(() => null);

  if (!referentiel) {
    // Deux silences différents : rien d'importé, ou rien qui s'applique ici
    // à cette date. On dit lequel.
    const existant = await prisma.regulatoryReferential.findFirst({
      where: { code: params.referentiel, status: { in: ['ACTIF', 'REMPLACE'] } },
      orderBy: { appliesFrom: 'desc' },
      select: { territory: true, appliesFrom: true, version: true },
    });
    let raison: string;
    if (!existant) {
      raison = `Le référentiel « ${params.referentiel} » n’est pas importé.`;
    } else if (existant.territory && !params.territoires.includes(existant.territory)) {
      raison =
        `Le référentiel « ${params.referentiel} » importé couvre le territoire ` +
        `${existant.territory}, et l’appartenance de la parcelle à ce territoire n’est pas ` +
        'établie (contour régional non importé, ou parcelle sans contour, ou hors de ce territoire).';
    } else if (existant.appliesFrom && existant.appliesFrom > params.at) {
      raison =
        `La version importée (${existant.version}) n’entre en vigueur que le ` +
        `${existant.appliesFrom.toLocaleDateString('fr-FR')} : aucune version fournie ne ` +
        `couvre le ${params.at.toLocaleDateString('fr-FR')}.`;
    } else {
      raison = `Aucune version du référentiel « ${params.referentiel} » ne s’applique à cette date.`;
    }
    return { regles: [], referentiel: null, raison };
  }

  const regles = await prisma.regulatoryRule.findMany({
    where: {
      referentialId: referentiel.id,
      ...(params.codes ? { code: { in: params.codes } } : {}),
      appliesFrom: { lte: params.at },
      OR: [{ appliesTo: null }, { appliesTo: { gte: params.at } }],
    },
    orderBy: [{ code: 'asc' }, { appliesFrom: 'desc' }],
  });

  return {
    regles: regles.map((r) => lue(r, referentiel)),
    referentiel: {
      code: referentiel.code,
      version: referentiel.version,
      source: referentiel.sourceLabel,
    },
    raison: null,
  };
}

/** La règle d'un code, ou `null`. La plus récente en vigueur l'emporte. */
export function regleDe(lecture: LectureRegles, code: string): RegleLue | null {
  return lecture.regles.find((r) => r.code === code) ?? null;
}

/** La trace en une ligne, pour un constat ou une infobulle. */
export function traceEnClair(trace: Trace): string {
  return [
    trace.texte,
    `${trace.referentiel.code} — ${trace.referentiel.version}`,
    `territoire ${trace.territoire}`,
    `en vigueur depuis le ${new Date(`${trace.validite.du}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}` +
      (trace.validite.au
        ? ` jusqu’au ${new Date(`${trace.validite.au}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`
        : ''),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Un nombre porté par une valeur de règle, ou `null`. */
export function nombre(valeur: unknown): number | null {
  if (typeof valeur === 'number' && Number.isFinite(valeur)) return valeur;
  return null;
}
