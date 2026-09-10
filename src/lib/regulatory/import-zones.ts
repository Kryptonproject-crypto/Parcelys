import 'server-only';
import { prisma } from '@/lib/prisma';
import { beginImport, failImport, finishImport } from '@/lib/regulatory/referentials';
import type { ZoneKind } from '@prisma/client';

/**
 * Import d'un zonage réglementaire depuis un fichier officiel.
 *
 * Accepte du GeoJSON — c'est le format que servent les services WFS des
 * plateformes publiques, et celui qu'on obtient en export depuis la plupart des
 * portails. Le SHP passe par le lecteur déjà écrit pour la PAC
 * (`lib/pac/shapefile.ts`) et se ramène au même point d'entrée.
 *
 * ## Ce que l'import garantit
 *
 *  · **Rien n'est écrasé.** Une nouvelle version crée une nouvelle entrée de
 *    référentiel ; l'ancienne passe en « remplacée » et reste lisible par les
 *    campagnes qui l'ont utilisée.
 *  · **Rien n'est deviné.** Une entité sans géométrie exploitable est comptée
 *    et signalée, pas complétée.
 *  · **Tout est journalisé.** Y compris les échecs, y compris les avertissements
 *    d'un import par ailleurs réussi.
 *
 * ## Reprojection
 *
 * Les jeux français sont fréquemment en Lambert-93 (EPSG:2154). La reprojection
 * est faite par PostGIS (`ST_Transform`), pas côté application : PostGIS
 * embarque PROJ et les grilles de conversion, et refaire cela en JavaScript
 * introduirait des écarts de plusieurs mètres sur les bords de zone —
 * précisément là où se joue le classement d'une parcelle.
 */

export type ZoneFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

export type ZoneImportSource = {
  code: string;
  name: string;
  kind: ZoneKind;
  territory: string | null;
  version: string;
  sourceLabel: string;
  sourceUrl?: string | null;
  appliesFrom?: Date | null;
  /** SRID des coordonnées du fichier. 4326 par défaut, 2154 pour du Lambert-93. */
  srid?: number;
  /** Propriétés portant le code et le libellé de la zone, si connues. */
  codeField?: string;
  labelField?: string;
};

export type ZoneImportReport = {
  referentialId: string;
  imported: number;
  skipped: number;
  warnings: string[];
};

/** Champs qui portent couramment un libellé, à défaut d'indication explicite. */
const CHAMPS_LIBELLE = ['nom', 'libelle', 'label', 'name', 'lib_zone', 'nom_zone'];
const CHAMPS_CODE = ['code', 'id', 'insee', 'code_zone', 'gid', 'identifiant'];

function premierChamp(
  proprietes: Record<string, unknown> | null,
  candidats: string[],
  explicite?: string,
): string | null {
  if (!proprietes) return null;
  if (explicite && proprietes[explicite] !== undefined) {
    return String(proprietes[explicite]);
  }
  for (const cle of Object.keys(proprietes)) {
    if (candidats.includes(cle.toLowerCase())) {
      const valeur = proprietes[cle];
      if (valeur !== null && valeur !== undefined) return String(valeur);
    }
  }
  return null;
}

/**
 * Importe une collection GeoJSON dans un référentiel de zonage.
 *
 * Les géométries sont insérées en SQL brut : la colonne `geom` est un type
 * PostGIS que Prisma ne modélise pas. Le passage par `ST_Multi(ST_MakeValid(…))`
 * n'est pas décoratif — les zonages publics contiennent régulièrement des
 * polygones auto-intersectants qui font échouer `ST_Intersects` en aval, et
 * corriger à l'import vaut mieux qu'échouer à chaque calcul de contexte.
 */
export async function importZoneCollection(
  features: ZoneFeature[],
  source: ZoneImportSource,
): Promise<ZoneImportReport> {
  const { referentiel, journal } = await beginImport({
    code: source.code,
    domain: 'ZONAGE',
    name: source.name,
    territory: source.territory,
    version: source.version,
    sourceLabel: source.sourceLabel,
    sourceUrl: source.sourceUrl ?? null,
    appliesFrom: source.appliesFrom ?? null,
  });

  const warnings: string[] = [];
  const srid = source.srid ?? 4326;
  let imported = 0;
  let skipped = 0;

  try {
    // Remplacement intégral des zones de CETTE version : réimporter la même
    // version ne doit pas doubler les polygones.
    await prisma.regulatoryZone.deleteMany({ where: { referentialId: referentiel.id } });

    for (const feature of features) {
      if (!feature.geometry) {
        skipped += 1;
        continue;
      }

      // Le type est écrit dans le GeoJSON : on trie ici plutôt qu'en SQL.
      //
      // La première version filtrait dans le `WHERE` de l'UPDATE, en pensant
      // que la ligne serait simplement ignorée. PostgreSQL évalue l'expression
      // affectée pour la ligne visée avant d'appliquer ce filtre : un point se
      // retrouvait converti en `MultiPoint` puis refusé par le type de la
      // colonne, et l'import entier s'arrêtait sur la première entité non
      // surfacique. Or les fichiers de captages en sont pleins.
      const type = feature.geometry.type;
      if (type !== 'Polygon' && type !== 'MultiPolygon') {
        skipped += 1;
        continue;
      }

      const label =
        premierChamp(feature.properties, CHAMPS_LIBELLE, source.labelField) ??
        source.name;
      const code = premierChamp(feature.properties, CHAMPS_CODE, source.codeField);

      const zone = await prisma.regulatoryZone.create({
        data: {
          referentialId: referentiel.id,
          kind: source.kind,
          code,
          label,
          attributes: (feature.properties ?? {}) as object,
        },
        select: { id: true },
      });

      const geojson = JSON.stringify(feature.geometry);

      // `ST_MakeValid` avant `ST_Multi` : réparer d'abord, uniformiser ensuite.
      // Et `ST_Transform` seulement si le fichier n'est pas déjà en 4326.
      //
      // `${srid}::int` : Prisma transmet les nombres JavaScript en `bigint`, et
      // PostGIS n'a pas de surcharge `ST_SetSRID(geometry, bigint)`. Sans ce
      // transtypage, l'import échoue sur la première entité.
      const affectees = await prisma.$executeRaw`
        UPDATE regulatory_zones
        SET geom = ST_Multi(
          ST_MakeValid(
            ST_Transform(
              ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), ${srid}::int),
              4326
            )
          )
        )
        WHERE id = ${zone.id}
      `;

      if (affectees === 0) {
        await prisma.regulatoryZone.delete({ where: { id: zone.id } });
        skipped += 1;
        continue;
      }

      imported += 1;
    }

    if (skipped > 0) {
      warnings.push(
        `${skipped} entité${skipped > 1 ? 's' : ''} sans géométrie surfacique exploitable ` +
          `${skipped > 1 ? 'ont' : 'a'} été écartée${skipped > 1 ? 's' : ''} : ` +
          'seules les surfaces permettent de calculer la part d’une parcelle concernée.',
      );
    }

    if (imported === 0) {
      warnings.push(
        'Aucune zone importée : le fichier ne contient aucun polygone exploitable. ' +
          'Le référentiel reste inutilisable et le contexte des parcelles restera indéterminé.',
      );
    }

    await finishImport({
      referentialId: referentiel.id,
      importId: journal.id,
      recordCount: imported,
      warnings,
    });

    return { referentialId: referentiel.id, imported, skipped, warnings };
  } catch (erreur) {
    await failImport({
      referentialId: referentiel.id,
      importId: journal.id,
      message: erreur instanceof Error ? erreur.message : 'Erreur inconnue',
    });
    throw erreur;
  }
}

/**
 * Importe un référentiel de doses de référence IFT.
 *
 * Le format publié varie d'une édition à l'autre. On attend en entrée des
 * lignes déjà normalisées par l'appelant — c'est lui qui connaît le fichier —
 * et ce module se charge du versionnement et du journal.
 */
export async function importIftReferences(
  lignes: Array<{
    cropLabel: string;
    amm?: string | null;
    targetLabel?: string | null;
    category: string;
    doseValue: string;
    doseUnit: string;
  }>,
  source: { version: string; sourceLabel: string; sourceUrl?: string | null },
): Promise<{ referentialId: string; imported: number; warnings: string[] }> {
  const { normalizeSearchTerm } = await import('@/lib/ephy/schema');

  const { referentiel, journal } = await beginImport({
    code: 'ift-doses-reference',
    domain: 'IFT',
    name: 'Doses de référence pour le calcul de l’IFT',
    territory: null,
    version: source.version,
    sourceLabel: source.sourceLabel,
    sourceUrl: source.sourceUrl ?? null,
  });

  const warnings: string[] = [];

  try {
    await prisma.iftReference.deleteMany({ where: { referentialId: referentiel.id } });

    const valides = lignes.filter((l) => l.cropLabel && l.doseValue && l.doseUnit);
    const ecartees = lignes.length - valides.length;
    if (ecartees > 0) {
      warnings.push(
        `${ecartees} ligne${ecartees > 1 ? 's' : ''} sans culture ou sans dose exploitable.`,
      );
    }

    for (let i = 0; i < valides.length; i += 500) {
      await prisma.iftReference.createMany({
        data: valides.slice(i, i + 500).map((ligne) => ({
          referentialId: referentiel.id,
          cropLabel: ligne.cropLabel,
          cropNormalized: normalizeSearchTerm(ligne.cropLabel),
          amm: ligne.amm ?? null,
          targetLabel: ligne.targetLabel ?? null,
          category: ligne.category,
          doseValue: ligne.doseValue,
          doseUnit: ligne.doseUnit,
        })),
        skipDuplicates: true,
      });
    }

    await finishImport({
      referentialId: referentiel.id,
      importId: journal.id,
      recordCount: valides.length,
      warnings,
    });

    return { referentialId: referentiel.id, imported: valides.length, warnings };
  } catch (erreur) {
    await failImport({
      referentialId: referentiel.id,
      importId: journal.id,
      message: erreur instanceof Error ? erreur.message : 'Erreur inconnue',
    });
    throw erreur;
  }
}
