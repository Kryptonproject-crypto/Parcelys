import 'server-only';
import { prisma } from '@/lib/prisma';
import type { RegulatoryDomain, ReferentialStatus } from '@prisma/client';

/**
 * Les référentiels réglementaires, et la seule façon honnête de s'en servir.
 *
 * Parcelys ne détient aucune valeur réglementaire en propre. Tout ce qui sert à
 * calculer une dose, à opposer une période ou à qualifier un zonage provient
 * d'un jeu de données importé depuis une source officielle, versionné, daté et
 * territorialisé.
 *
 * D'où la règle que ce module fait respecter : **un référentiel absent ne
 * produit pas un résultat par défaut, il produit une absence de résultat**.
 * `resolveReferential()` renvoie `null`, l'appelant en fait un constat
 * « indéterminé », et l'interface écrit « impossible de vérifier cette règle :
 * référentiel X non importé ». C'est plus utile qu'un chiffre plausible, et
 * infiniment plus défendable devant un contrôle.
 *
 * Le catalogue ci-dessous ne contient aucune donnée : il déclare quels jeux de
 * données Parcelys sait utiliser, où les trouver et à quoi ils servent. C'est
 * une carte des sources, pas un cache de valeurs.
 */

/**
 * Comment trouver ce référentiel sur data.gouv.fr.
 *
 * Des **termes de recherche**, pas un identifiant. Deux raisons, vérifiées
 * plutôt que supposées :
 *
 *  · il n'existe pas de jeu national « zones vulnérables » — il y en a des
 *    dizaines, par région et par département, avec des millésimes différents.
 *    Un identifiant en dur importerait le zonage d'une autre région ;
 *  · la documentation de l'API le dit : « utilisez les identifiants techniques
 *    dans les scripts de production, les slugs peuvent changer ».
 *
 * `slugConnu` n'est donc qu'une piste de départ, vérifiée à la rédaction et
 * susceptible d'avoir bougé. Le CLI cherche, montre les candidats, et conserve
 * l'identifiant technique de celui qu'on retient.
 */
export type DatagouvHint = {
  /** Termes passés à `?q=` de l'API. */
  query: string;
  /** Formats exploitables, du plus commode au moins. */
  formats: readonly string[];
  /** Slug relevé à la rédaction. Une piste, pas une garantie. */
  slugConnu?: string;
  /** Ce qu'il faut savoir avant de choisir parmi les résultats. */
  note?: string;
};

export type ReferentialSpec = {
  code: string;
  domain: RegulatoryDomain;
  name: string;
  /** À quoi ce référentiel sert dans le logiciel, en une phrase. */
  usage: string;
  /** Où le trouver. Affiché à l'administrateur qui doit lancer l'import. */
  sourceLabel: string;
  /** Variable d'environnement portant l'URL. Jamais d'URL codée en dur. */
  envVar: string;
  /** Territorialisé : une version par région ou département. */
  territorial: boolean;
  /** Ce que Parcelys ne peut pas faire tant qu'il manque. */
  degradedWithout: string;
  /** Comment le découvrir sur data.gouv.fr, quand il y figure. */
  datagouv?: DatagouvHint;
};

/**
 * Jeux de données que Parcelys sait exploiter.
 *
 * Aucune URL n'est écrite ici. Les adresses des jeux de données officiels
 * changent, et une URL périmée codée en dur produit soit une erreur, soit —
 * bien pire — l'import silencieux d'une version obsolète. Chaque référentiel
 * lit son adresse dans une variable d'environnement ; à défaut il reste
 * « non configuré », ce que l'interface affiche.
 */
export const REFERENTIAL_CATALOG: ReferentialSpec[] = [
  {
    code: 'ephy',
    domain: 'PHYTO',
    name: 'Catalogue E-Phy des produits phytopharmaceutiques',
    usage:
      'Doses autorisées par culture, ZNT, délais avant récolte, conditions d’emploi.',
    sourceLabel: 'ANSES — jeu de données ouvert E-Phy',
    envVar: 'EPHY_DATA_URL',
    territorial: false,
    degradedWithout:
      'Aucune vérification de dose ni de ZNT : les produits sont saisis librement et signalés « non vérifiés ».',
    datagouv: {
      query: 'e-phy catalogue produits phytopharmaceutiques',
      formats: ['zip'],
      note: 'Retenir la publication de l’ANSES, et l’archive complète — pas un extrait.',
    },
  },
  {
    code: 'ift-doses-reference',
    domain: 'IFT',
    name: 'Doses de référence pour le calcul de l’IFT',
    usage: 'Calcul de l’IFT par traitement, parcelle, culture et campagne.',
    sourceLabel: 'Ministère de l’Agriculture — référentiel des doses de référence',
    envVar: 'IFT_DATA_URL',
    territorial: false,
    degradedWithout:
      'Aucun IFT calculé. Parcelys ne compte pas les passages à la place : un nombre de traitements n’est pas un IFT.',
    datagouv: {
      query: 'doses de référence indicateur de fréquence de traitements phytosanitaires',
      formats: ['csv', 'xlsx'],
      slugConnu: 'doses-de-reference-indicateur-de-frequence-de-traitements-phytosanitaires',
      note:
        'Les listes sont propres à chaque campagne culturale. Prendre celle de la campagne travaillée, pas la plus récente.',
    },
  },
  {
    code: 'zones-vulnerables',
    domain: 'ZONAGE',
    name: 'Zones vulnérables aux nitrates',
    usage:
      'Détermination par intersection géographique, avec la surface réellement concernée.',
    sourceLabel: 'Données publiques de zonage (DREAL / data.gouv.fr)',
    envVar: 'ZONES_VULNERABLES_URL',
    territorial: true,
    degradedWithout:
      'Le classement de la parcelle reste indéterminé. Aucune règle nitrates n’est opposée, et l’interface le signale.',
    datagouv: {
      query: 'zones vulnérables nitrates',
      formats: ['geojson', 'json', 'shp', 'zip'],
      note:
        'Aucun jeu national : des dizaines de jeux régionaux et départementaux, de millésimes différents. Choisir CELUI de son territoire — un autre classerait des parcelles à tort.',
    },
  },
  {
    code: 'zones-action-renforcee',
    domain: 'ZONAGE',
    name: 'Zones d’actions renforcées',
    usage: 'Prescriptions renforcées applicables à l’intérieur des zones vulnérables.',
    sourceLabel: 'DREAL régionales',
    envVar: 'ZAR_URL',
    territorial: true,
    degradedWithout: 'Les prescriptions renforcées éventuelles ne sont pas opposées.',
    datagouv: {
      query: 'zones actions renforcées nitrates',
      formats: ['geojson', 'json', 'shp', 'zip'],
      note: 'Publiées par les DREAL régionales, à l’intérieur des zones vulnérables.',
    },
  },
  {
    code: 'programme-actions-nitrates',
    domain: 'NITRATES',
    name: 'Programme d’actions nitrates',
    usage:
      'Périodes d’épandage, conditions, couverture des sols, plafond d’azote organique.',
    sourceLabel: 'Programme national et programmes régionaux (DRAAF)',
    envVar: 'PAR_DATA_URL',
    territorial: true,
    degradedWithout:
      'Aucun calendrier d’épandage ni plafond n’est vérifié. Les apports sont enregistrés sans contrôle réglementaire.',
    datagouv: {
      query: 'programme actions régional nitrates',
      formats: ['csv', 'json'],
      note:
        'Le programme est un arrêté, pas un jeu de données : ce qui circule en ouvert est partiel. Les règles se saisissent règle par règle, avec leur référence de texte.',
    },
  },
  {
    code: 'gren',
    domain: 'GREN',
    name: 'Référentiel régional de calcul de la dose prévisionnelle',
    usage:
      'Besoin de la culture et fournitures du sol pour le plan prévisionnel de fumure.',
    sourceLabel: 'GREN régionaux / DRAAF',
    envVar: 'GREN_DATA_URL',
    territorial: true,
    degradedWithout:
      'La dose prévisionnelle n’est pas calculée. Le plan reste saisissable à la main, et le bilan indique quelles valeurs manquent.',
    datagouv: {
      query: 'GREN référentiel régional calcul dose azote prévisionnelle',
      formats: ['csv', 'xlsx'],
      note:
        'Souvent publié en PDF par les GREN régionaux, donc non importable tel quel. Sans version tabulaire, le besoin et la fourniture du sol se saisissent à la main — et le bilan dit d’où ils viennent.',
    },
  },
  {
    code: 'captages',
    domain: 'ZONAGE',
    name: 'Captages et aires d’alimentation de captage',
    usage: 'Contraintes liées à la protection de la ressource en eau.',
    sourceLabel: 'Données publiques sur l’eau',
    envVar: 'CAPTAGES_URL',
    territorial: true,
    degradedWithout: 'La proximité d’un captage n’est pas détectée.',
    datagouv: {
      query: 'captages aire alimentation captage périmètre protection',
      formats: ['geojson', 'json', 'shp', 'zip'],
      note:
        'Un captage est souvent publié en points ; seules les aires et périmètres, qui sont des surfaces, permettent de calculer une part de parcelle concernée.',
    },
  },
  {
    code: 'cours-eau',
    domain: 'ZONAGE',
    name: 'Cours d’eau',
    usage: 'Distances réglementaires et zones non traitées riveraines.',
    sourceLabel: 'IGN — Géoplateforme',
    envVar: 'COURS_EAU_URL',
    territorial: true,
    degradedWithout:
      'La proximité d’un cours d’eau n’est pas détectée : les ZNT restent affichées sans être rapportées au terrain.',
    datagouv: {
      query: 'cours d’eau police de l’eau BD TOPO hydrographie',
      formats: ['geojson', 'json', 'shp', 'zip'],
      note:
        'Les cours d’eau sont des lignes : leur import sert au repérage, pas au calcul de surface concernée.',
    },
  },
];

export function findSpec(code: string): ReferentialSpec | null {
  return REFERENTIAL_CATALOG.find((spec) => spec.code === code) ?? null;
}

export type ReferentialState = ReferentialSpec & {
  /** Version active, ou `null` si le référentiel n'a jamais été importé. */
  version: string | null;
  status: ReferentialStatus;
  territory: string | null;
  recordCount: number;
  importedAt: string | null;
  appliesFrom: string | null;
  appliesTo: string | null;
  sourceUrl: string | null;
  notes: string | null;
  /** L'URL est-elle renseignée dans l'environnement ? */
  configured: boolean;
  /** Nombre de versions conservées, campagnes passées comprises. */
  versionCount: number;
};

/**
 * État de tous les référentiels, pour le centre d'administration.
 *
 * Un référentiel jamais importé apparaît quand même, avec son statut
 * « non configuré » et la phrase disant ce que Parcelys ne peut pas faire sans
 * lui. Ne montrer que les référentiels présents donnerait l'impression que la
 * liste est complète.
 */
export async function getReferentialStates(): Promise<ReferentialState[]> {
  const rows = await prisma.regulatoryReferential.findMany({
    orderBy: [{ code: 'asc' }, { appliesFrom: 'desc' }, { version: 'desc' }],
  });

  return REFERENTIAL_CATALOG.map((spec) => {
    const versions = rows.filter((row) => row.code === spec.code);
    const actif =
      versions.find((row) => row.status === 'ACTIF') ?? versions[0] ?? null;

    return {
      ...spec,
      version: actif?.version ?? null,
      status: actif?.status ?? ('NON_CONFIGURE' as ReferentialStatus),
      territory: actif?.territory ?? null,
      recordCount: actif?.recordCount ?? 0,
      importedAt: actif?.importedAt?.toISOString() ?? null,
      appliesFrom: actif?.appliesFrom?.toISOString() ?? null,
      appliesTo: actif?.appliesTo?.toISOString() ?? null,
      sourceUrl: actif?.sourceUrl ?? null,
      notes: actif?.notes ?? null,
      configured: Boolean(process.env[spec.envVar]),
      versionCount: versions.length,
    };
  });
}

/**
 * Le référentiel en vigueur pour un territoire à une date donnée.
 *
 * **La date compte autant que le territoire.** Consulter la campagne 2024 doit
 * appliquer le référentiel de 2024, même si celui de 2026 est en base et
 * marqué actif. C'est la différence entre un historique et une réécriture de
 * l'histoire.
 *
 * Le territoire est résolu du plus précis au plus général : département, puis
 * région, puis national. Une règle départementale l'emporte donc sur la règle
 * nationale, ce qui est l'ordre attendu.
 */
export async function resolveReferential(params: {
  code: string;
  /** Codes de territoire du plus précis au plus général, ex. `['45', '24', 'FR']`. */
  territories: Array<string | null>;
  /** Date à laquelle la règle doit être en vigueur. */
  at: Date;
}) {
  const candidats = params.territories.filter(
    (t): t is string => typeof t === 'string' && t.length > 0,
  );

  for (const territoire of [...candidats, null]) {
    const referentiel = await prisma.regulatoryReferential.findFirst({
      where: {
        code: params.code,
        territory: territoire,
        status: { in: ['ACTIF', 'REMPLACE'] },
        OR: [{ appliesFrom: null }, { appliesFrom: { lte: params.at } }],
        AND: [{ OR: [{ appliesTo: null }, { appliesTo: { gte: params.at } }] }],
      },
      // La plus récente parmi celles en vigueur à cette date, pas la plus
      // récente tout court.
      orderBy: [{ appliesFrom: 'desc' }, { importedAt: 'desc' }],
    });

    if (referentiel) return referentiel;
  }

  return null;
}

/** Provenance affichable à côté d'un calcul. */
export type SourceStamp = {
  referentialCode: string;
  referentialVersion: string;
  sourceLabel: string;
  territory: string | null;
  importedAt: string | null;
};

export function stampOf(referentiel: {
  code: string;
  version: string;
  sourceLabel: string;
  territory: string | null;
  importedAt: Date | null;
}): SourceStamp {
  return {
    referentialCode: referentiel.code,
    referentialVersion: referentiel.version,
    sourceLabel: referentiel.sourceLabel,
    territory: referentiel.territory,
    importedAt: referentiel.importedAt?.toISOString() ?? null,
  };
}

/**
 * Ouvre une version de référentiel et journalise l'import.
 *
 * L'ancienne version n'est pas supprimée : elle passe en `REMPLACE` et reste
 * lisible par les campagnes qui l'ont utilisée. C'est la seule façon de
 * rouvrir une campagne 2024 des années plus tard et d'y retrouver les mêmes
 * chiffres.
 */
export async function beginImport(params: {
  code: string;
  domain: RegulatoryDomain;
  name: string;
  territory: string | null;
  version: string;
  sourceLabel: string;
  sourceUrl?: string | null;
  appliesFrom?: Date | null;
  appliesTo?: Date | null;
}) {
  const referentiel = await prisma.regulatoryReferential.upsert({
    where: {
      code_territory_version: {
        code: params.code,
        territory: params.territory ?? '',
        version: params.version,
      },
    },
    create: {
      code: params.code,
      domain: params.domain,
      name: params.name,
      territory: params.territory,
      version: params.version,
      sourceLabel: params.sourceLabel,
      sourceUrl: params.sourceUrl ?? null,
      appliesFrom: params.appliesFrom ?? null,
      appliesTo: params.appliesTo ?? null,
      status: 'IMPORT_EN_COURS',
    },
    update: { status: 'IMPORT_EN_COURS', sourceUrl: params.sourceUrl ?? null },
  });

  const journal = await prisma.regulatoryImport.create({
    data: {
      referentialId: referentiel.id,
      status: 'RUNNING',
      sourceUrl: params.sourceUrl ?? null,
    },
  });

  return { referentiel, journal };
}

export async function finishImport(params: {
  referentialId: string;
  importId: string;
  recordCount: number;
  warnings: string[];
}) {
  const maintenant = new Date();

  await prisma.$transaction([
    // Les versions antérieures du même référentiel et du même territoire
    // passent en « remplacée » — jamais supprimées.
    prisma.regulatoryReferential.updateMany({
      where: {
        id: { not: params.referentialId },
        status: 'ACTIF',
        code: (
          await prisma.regulatoryReferential.findUniqueOrThrow({
            where: { id: params.referentialId },
            select: { code: true },
          })
        ).code,
      },
      data: { status: 'REMPLACE' },
    }),
    prisma.regulatoryReferential.update({
      where: { id: params.referentialId },
      data: {
        status: 'ACTIF',
        recordCount: params.recordCount,
        importedAt: maintenant,
        notes: params.warnings.length ? params.warnings.join(' | ').slice(0, 2000) : null,
      },
    }),
    prisma.regulatoryImport.update({
      where: { id: params.importId },
      data: {
        status: 'SUCCESS',
        finishedAt: maintenant,
        recordCount: params.recordCount,
        warnings: params.warnings.length ? params.warnings.join(' | ').slice(0, 2000) : null,
      },
    }),
  ]);
}

export async function failImport(params: {
  referentialId: string;
  importId: string;
  message: string;
}) {
  await prisma.$transaction([
    prisma.regulatoryReferential.update({
      where: { id: params.referentialId },
      data: { status: 'ECHEC', notes: params.message.slice(0, 2000) },
    }),
    prisma.regulatoryImport.update({
      where: { id: params.importId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: params.message.slice(0, 2000),
      },
    }),
  ]);
}
