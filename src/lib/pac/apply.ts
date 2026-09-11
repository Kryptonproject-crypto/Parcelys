/**
 * Application d'un import PAC.
 *
 * C'est la seule étape qui écrit. Elle procède dans cet ordre, et pas un autre :
 *
 *   1. sauvegarde de l'état actuel des parcelles ;
 *   2. écriture des entités PAC ;
 *   3. création ou mise à jour des parcelles Parcelys ;
 *   4. enregistrement de ce qui a changé.
 *
 * La sauvegarde vient d'abord parce qu'une sauvegarde prise après coup ne sert
 * à rien. Elle permet de revenir en arrière si l'import s'avère être le mauvais
 * fichier, ce qui arrive.
 *
 * Ce que cette étape ne fait pas : effacer. Une parcelle absente du dossier PAC
 * n'est pas supprimée — l'agriculteur peut avoir des parcelles hors PAC, et un
 * import ne doit pas emporter ce qu'il ne connaît pas. Elle est signalée dans le
 * rapport, à lui de décider.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { notFound } from '@/lib/api/errors';
import { GEOJSON_DECIMALES, saveParcelGeometry } from '@/lib/geo/repository';
import { reverseGeocode } from '@/lib/geo/geocode';
import type { AnalyzedFeature, MatchDecision } from '@/lib/pac/analyze';

/**
 * Marque posée sur une culture créée par un import.
 *
 * Elle sert à distinguer, au réimport, ce que l'import a écrit de ce que
 * l'exploitant a saisi. Une note plutôt qu'une colonne : elle est visible dans
 * l'interface — l'exploitant voit d'où vient la ligne —, et elle disparaît dès
 * qu'il la modifie, ce qui est exactement le signal qu'on cherche.
 */
const MARQUE_IMPORT = 'Culture déclarée — import TéléPAC';

export type FeatureDecision = {
  layer: string;
  index: number;
  decision: MatchDecision;
  /** Parcelle visée par une mise à jour, quand l'utilisateur en change. */
  parcelId?: string;
};

export type ApplyResult = {
  importId: string;
  snapshotId: string;
  created: number;
  updated: number;
  ignored: number;
  ilots: number;
  /** Cultures rattachées d'après le code déclaré. */
  crops: number;
  /** Parcelles présentes dans Parcelys mais absentes du dossier importé. */
  orphans: Array<{ id: string; name: string; areaHa: number }>;
  /**
   * Parcelles dont le numéro déclaré était déjà porté par une autre.
   *
   * TéléPAC renumérote d'une campagne à l'autre, et réattribue les numéros
   * libérés. Quand deux parcelles distinctes revendiquent `13-72`, Parcelys ne
   * les fond pas — ce serait déplacer un registre sur la mauvaise parcelle — et
   * suffixe le numéro interne de la seconde. Le fait est rapporté ici plutôt
   * que laissé à découvrir dans une colonne.
   */
  renumerotees: Array<{ declare: string; attribue: string }>;
};

/** État des parcelles, figé avant que l'import n'y touche. */
async function takeSnapshot(
  tx: Prisma.TransactionClient,
  campaignId: string,
  farmId: string,
  label: string,
  userId: string | null,
): Promise<{ id: string; parcelCount: number; areaHa: number }> {
  const parcelles = await tx.$queryRaw<
    Array<{ id: string; name: string; area: number | null; geojson: string | null; pac_id: string | null }>
  >`
    SELECT p.id, p.name, p.pac_id,
           ST_Area(pg.geom::geography) / 10000.0 AS area,
           -- Pleine précision : cette sauvegarde sert à rétablir le
           -- parcellaire, donc à réécrire ces contours en base. Une
           -- sauvegarde arrondie rendrait autre chose que ce qu'elle a pris.
           ST_AsGeoJSON(pg.geom, ${GEOJSON_DECIMALES}::int) AS geojson
    FROM parcels p
    LEFT JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
    WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL
  `;

  const payload = parcelles.map((p) => ({
    id: p.id,
    name: p.name,
    pacId: p.pac_id,
    areaHa: p.area === null ? null : Number(p.area),
    geojson: p.geojson ? (JSON.parse(p.geojson) as unknown) : null,
  }));

  const areaHa = payload.reduce((sum, p) => sum + (p.areaHa ?? 0), 0);

  const snapshot = await tx.pacSnapshot.create({
    data: {
      campaignId,
      label,
      parcelCount: payload.length,
      areaHa,
      payload: payload as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
    select: { id: true },
  });

  return { id: snapshot.id, parcelCount: payload.length, areaHa };
}

/** Écrit une géométrie sur une entité PAC (colonne PostGIS, hors modèle Prisma). */
async function setFeatureGeometry(
  tx: Prisma.TransactionClient,
  featureId: string,
  geojson: unknown,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE pac_features
    SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326))
    WHERE id = ${featureId}
  `;
}

async function setIlotGeometry(
  tx: Prisma.TransactionClient,
  ilotId: string,
  geojson: unknown,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE pac_ilots
    SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326))
    WHERE id = ${ilotId}
  `;
}

/** Centre approximatif d'une géométrie GeoJSON, pour interroger le géocodeur. */
function centreApproximatif(geojson: unknown): { lat: number; lng: number } | null {
  const points: Array<[number, number]> = [];
  const parcourir = (noeud: unknown): void => {
    if (!Array.isArray(noeud)) return;
    if (typeof noeud[0] === 'number' && typeof noeud[1] === 'number') {
      points.push([noeud[0], noeud[1]]);
      return;
    }
    for (const enfant of noeud) parcourir(enfant);
  };
  const geom = geojson as { coordinates?: unknown } | null;
  parcourir(geom?.coordinates);
  if (points.length === 0) return null;

  const somme = points.reduce(
    (acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }),
    { x: 0, y: 0 },
  );
  return { lng: somme.x / points.length, lat: somme.y / points.length };
}

/**
 * Nom de chaque commune citée par le dossier, par code INSEE.
 *
 * Une requête par commune distincte, pas une par parcelle : le dossier 2026
 * examiné compte 134 parcelles pour 6 communes.
 */
async function resolveCommunes(
  features: AnalyzedFeature[],
): Promise<Map<string, string>> {
  const parInsee = new Map<string, { lat: number; lng: number }>();

  for (const feature of features) {
    const code = feature.attributes['commune'];
    if (typeof code !== 'string' || !/^\d[\dAB]\d{3}$/i.test(code.trim())) continue;
    const insee = code.trim();
    if (parInsee.has(insee) || !feature.geojson) continue;
    const centre = centreApproximatif(feature.geojson);
    if (centre) parInsee.set(insee, centre);
  }

  const noms = new Map<string, string>();
  for (const [insee, centre] of parInsee) {
    try {
      const lieu = await reverseGeocode(centre.lat, centre.lng);
      // Le géocodeur doit tomber sur la même commune que la déclaration.
      // S'il n'est pas d'accord, c'est la déclaration qui fait foi et on
      // n'écrit pas de nom : mieux vaut un code seul qu'un nom qui ne
      // correspond pas à la parcelle.
      if (lieu?.city && lieu.citycode === insee) noms.set(insee, lieu.city);
    } catch {
      // Pas de réseau : le code INSEE partira seul.
    }
  }
  return noms;
}

export async function applyImport(params: {
  farmId: string;
  year: number;
  userId: string | null;
  features: AnalyzedFeature[];
  decisions: FeatureDecision[];
  sourceFiles: string[];
  detectedSrid: number | null;
  sridLabel: string;
  ilotLayers: string[];
}): Promise<ApplyResult> {
  const { farmId, year, userId } = params;

  const parDecision = new Map(
    params.decisions.map((d) => [`${d.layer}#${d.index}`, d]),
  );

  // Noms de commune, résolus **avant** d'ouvrir la transaction.
  //
  // Le dossier TéléPAC porte le code INSEE, jamais le nom. Celui-ci est
  // retrouvé par le même service que la saisie manuelle, une requête par
  // commune distincte — une quinzaine pour une exploitation, pas une par
  // parcelle. Les faire dans la transaction la tiendrait ouverte le temps
  // d'appels réseau, ce qui bloque la base pour tout le monde.
  //
  // Un échec n'interrompt rien : le code INSEE sera écrit sans le nom. Une
  // commune manquante est un confort en moins, pas une donnée fausse.
  const communes = await resolveCommunes(params.features);

  return prisma.$transaction(
    async (tx) => {
      const campaign = await tx.pacCampaign.upsert({
        where: { farmId_year: { farmId, year } },
        create: { farmId, year },
        update: {},
        select: { id: true },
      });

      const snapshot = await takeSnapshot(
        tx,
        campaign.id,
        farmId,
        `PAC ${year} — avant import`,
        userId,
      );

      // --- Les entités que cet import réécrit -----------------------------
      //
      // Réimporter la même campagne est un geste courant : on redépose son
      // dossier pour vérifier que ça a bien marché, ou après avoir corrigé une
      // correspondance. Les entités étaient jusqu'ici créées sans condition —
      // un second import doublait donc tout le contenu PAC de la campagne (769
      // entités devenaient 1 538, mesuré sur un dossier réel). Rien ne le
      // signalait : la carte affichait les mêmes contours deux fois, et le
      // décompte des SNA était faux.
      //
      // Une entité PAC est **dérivée** du fichier, elle ne porte aucune saisie
      // de l'exploitant : la remplacer ne perd rien, contrairement à une
      // parcelle, qui porte cultures, traitements et apports et n'est donc
      // jamais supprimée ici.
      //
      // Le remplacement est limité aux natures présentes dans cet import. Un
      // dépôt qui n'apporte que des parcelles ne doit pas emporter les SNA de
      // la campagne, importées séparément — ce que permet le format Shapefile,
      // couche par couche.
      const naturesReecrites = [
        ...new Set(
          params.features
            .filter((f) => !params.ilotLayers.includes(f.layer))
            .map((f) => f.kind),
        ),
      ];
      if (naturesReecrites.length > 0) {
        await tx.pacFeature.deleteMany({
          where: { campaignId: campaign.id, kind: { in: naturesReecrites } },
        });
      }

      // --- Îlots ---------------------------------------------------------
      const ilotsParNumero = new Map<string, string>();
      /** Code INSEE de la commune, par numéro d'îlot. */
      const inseeParIlot = new Map<string, string>();
      let ilotCount = 0;

      for (const feature of params.features) {
        if (!params.ilotLayers.includes(feature.layer)) continue;
        const numero = feature.ilot ?? feature.numero ?? feature.externalId;
        if (!numero) continue;

        const ilot = await tx.pacIlot.upsert({
          where: { campaignId_numero: { campaignId: campaign.id, numero } },
          create: {
            campaignId: campaign.id,
            numero,
            areaHa: feature.areaHa ?? undefined,
            attributes: feature.attributes as unknown as Prisma.InputJsonValue,
          },
          update: {
            areaHa: feature.areaHa ?? undefined,
            attributes: feature.attributes as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        if (feature.geojson) await setIlotGeometry(tx, ilot.id, feature.geojson);
        ilotsParNumero.set(numero, ilot.id);

        // Le code INSEE de la commune est porté par l'îlot, pas par la
        // parcelle : il faut le descendre, sinon il reste dans les attributs
        // sans jamais atteindre la fiche parcelle.
        const commune = feature.attributes['commune'];
        if (typeof commune === 'string' && /^\d[\dAB]\d{3}$/i.test(commune.trim())) {
          inseeParIlot.set(numero, commune.trim());
        }

        ilotCount += 1;
      }

      /**
       * Localisation administrative à écrire sur la parcelle.
       *
       * Le code INSEE vient du fichier : il est sûr, et c'est lui qu'un
       * contrôle regarde. Le nom de la commune, lui, n'est **pas** dans le
       * dossier TéléPAC — il est résolu avant la transaction, par le même
       * service que celui de la saisie manuelle. Quand il manque (pas de
       * réseau), on écrit le code sans le nom plutôt que d'inventer, et sans
       * effacer un nom déjà saisi.
       */
      const localisation = (
        feature: AnalyzedFeature,
      ): { inseeCode: string; commune?: string } | null => {
        const insee = feature.ilot ? inseeParIlot.get(feature.ilot) : undefined;
        if (!insee) return null;
        const nom = communes.get(insee);
        return nom ? { inseeCode: insee, commune: nom } : { inseeCode: insee };
      };

      /**
       * Les parcelles que cet import a le droit de viser.
       *
       * ───────────────────────────────────────────────────────────────────
       * POURQUOI CETTE LISTE EXISTE
       * ───────────────────────────────────────────────────────────────────
       *
       * `decisions[].parcelId` vient du navigateur : c'est la parcelle que
       * l'utilisateur a désignée dans l'aperçu quand la correspondance
       * proposée ne lui convenait pas. Elle était employée telle quelle, et
       * `tx.parcel.update({ where: { id } })` ne regarde pas à qui la parcelle
       * appartient.
       *
       * Conséquence, mesurée sur la base avant correction : un import fait
       * depuis l'exploitation A, avec l'identifiant d'une parcelle de
       * l'exploitation B glissé dans les décisions, réécrivait cette
       * parcelle-là — code INSEE, type, `pacId`, superficie (12,3456 ha
       * devenus 2,6702), une géométrie et une culture créées chez le voisin.
       * Aucune des deux exploitations n'en voyait rien.
       *
       * Deux garde-fous plutôt qu'un, parce qu'ils ne protègent pas la même
       * chose :
       *   · celui-ci refuse la demande et le dit — une décision qui ne porte
       *     pas sur le parcellaire de l'exploitation n'est pas une erreur de
       *     saisie, c'est une requête qui n'aurait pas dû être formée ;
       *   · l'écriture elle-même est bornée à `farmId` (`updateMany`), de
       *     sorte que la base refuse la ligne étrangère même si un futur
       *     chemin de code contournait la vérification.
       *
       * L'analyse ne propose jamais qu'une parcelle de l'exploitation, non
       * supprimée : ce filtre-ci est exactement le même, aucun rapprochement
       * légitime n'y perd quoi que ce soit.
       */
      const parcellesAutorisees = new Set(
        (
          await tx.parcel.findMany({
            where: { farmId, deletedAt: null },
            select: { id: true },
          })
        ).map((p) => p.id),
      );

      const cibleAutorisee = (id: string | null): string | null => {
        if (id === null) return null;
        if (!parcellesAutorisees.has(id)) {
          throw notFound(
            'Une des parcelles visées par cet import est introuvable dans cette ' +
              "exploitation. Relancez l'analyse du dossier : le parcellaire a pu " +
              "changer depuis l'aperçu.",
          );
        }
        return id;
      };

      // Numéros internes déjà employés sur l'exploitation : la contrainte
      // d'unicité est (farmId, internalNumber), et un import qui la violerait
      // ferait échouer toute la transaction — donc tout l'import — pour un
      // champ de confort.
      const numerosPris = new Set(
        (
          await tx.parcel.findMany({
            where: { farmId, internalNumber: { not: null } },
            select: { internalNumber: true },
          })
        )
          .map((p) => p.internalNumber)
          .filter((n): n is string => n !== null),
      );

      /**
       * Cultures de l'exploitation, par code.
       *
       * Le code culture de la déclaration (« BTH ») et celui de Parcelys
       * (« BLE_TENDRE ») sont deux référentiels distincts : il n'existe aucune
       * correspondance officielle entre eux dans le dossier, et l'inventer
       * serait écrire une équivalence réglementaire qu'on n'a pas vérifiée.
       *
       * Ce qui est fait à la place : une culture portant le **code déclaré**
       * est créée si elle n'existe pas, et l'exploitant la renomme une fois —
       * le rattachement vaut alors pour toutes les campagnes, puisque c'est le
       * code qui fait la clé.
       */
      const culturesParCode = new Map(
        (
          await tx.crop.findMany({
            where: { OR: [{ farmId: null }, { farmId }] },
            select: { id: true, code: true },
          })
        ).map((c) => [c.code, c.id]),
      );

      // --- Entités et parcelles -------------------------------------------
      let created = 0;
      let culturesRattachees = 0;
      let updated = 0;
      let ignored = 0;
      const touchees = new Set<string>();
      const renumerotees: ApplyResult['renumerotees'] = [];

      for (const feature of params.features) {
        if (params.ilotLayers.includes(feature.layer)) continue;

        const cle = `${feature.layer}#${feature.index}`;
        const decision = parDecision.get(cle)?.decision ?? (feature.match ? 'update' : 'create');

        if (decision === 'ignore' || feature.error) {
          ignored += 1;
          continue;
        }

        // Un îlot cité par une parcelle mais absent de la couche des îlots est
        // créé sans géométrie : mieux vaut un îlot connu sans contour qu'une
        // parcelle rattachée à rien.
        let ilotId: string | null = null;
        if (feature.ilot) {
          ilotId = ilotsParNumero.get(feature.ilot) ?? null;
          if (!ilotId) {
            const cree = await tx.pacIlot.upsert({
              where: { campaignId_numero: { campaignId: campaign.id, numero: feature.ilot } },
              create: { campaignId: campaign.id, numero: feature.ilot },
              update: {},
              select: { id: true },
            });
            ilotId = cree.id;
            ilotsParNumero.set(feature.ilot, cree.id);
          }
        }

        // Seules les parcelles culturales alimentent le parcellaire Parcelys.
        // Une SNA ou une ZDH n'est pas une parcelle : elle reste une entité PAC.
        let parcelId: string | null = null;

        if (feature.kind === 'PARCELLE') {
          const cible = cibleAutorisee(
            parDecision.get(cle)?.parcelId ?? feature.match?.parcelId ?? null,
          );

          if (decision === 'update' && cible) {
            const avant = await tx.$queryRaw<Array<{ area: number | null; geojson: string | null }>>`
              SELECT ST_Area(geom::geography) / 10000.0 AS area,
                     ST_AsGeoJSON(geom, ${GEOJSON_DECIMALES}::int) AS geojson
              FROM parcel_geometries WHERE parcel_id = ${cible} AND is_current = true
            `;

            // `updateMany` et non `update` : la clause porte alors sur
            // `farmId` autant que sur l'identifiant, et c'est la base qui
            // refuse une parcelle étrangère, sans dépendre de la vérification
            // faite plus haut.
            const ecrites = await tx.parcel.updateMany({
              where: { id: cible, farmId, deletedAt: null },
              data: {
                pacId: feature.externalId ?? feature.numero ?? undefined,
                parcelType: 'PAC',
                // La déclaration fait foi pour la localisation administrative :
                // c'est elle qu'on présentera en contrôle. En revanche on
                // n'écrase pas un nom de commune déjà saisi par un `null`
                // faute de réseau.
                ...(localisation(feature) ?? {}),
              },
            });
            if (ecrites.count !== 1) {
              throw notFound(
                'Une des parcelles visées par cet import est introuvable dans ' +
                  "cette exploitation. Relancez l'analyse du dossier.",
              );
            }

            if (feature.geojson) {
              await saveParcelGeometry(
                tx,
                cible,
                feature.geojson as never,
                `telepac-${year}`,
              );
            }

            await tx.pacChange.create({
              data: {
                campaignId: campaign.id,
                parcelId: cible,
                userId,
                changeType: 'import.update',
                previousGeojson: avant[0]?.geojson
                  ? (JSON.parse(avant[0].geojson) as Prisma.InputJsonValue)
                  : undefined,
                newGeojson: (feature.geojson ?? undefined) as Prisma.InputJsonValue | undefined,
                previousAreaHa: avant[0]?.area ?? undefined,
                newAreaHa: feature.areaHa ?? undefined,
                newCrop: feature.cropCode ?? undefined,
              },
            });

            parcelId = cible;
            touchees.add(cible);
            updated += 1;
          } else {
            /**
             * Le numéro interne, même quand la place est déjà prise.
             *
             * ───────────────────────────────────────────────────────────────
             * CE QUI SE PASSAIT
             * ───────────────────────────────────────────────────────────────
             *
             * Quand `13-72` était déjà porté par une autre parcelle, le champ
             * restait **vide**. Mesuré sur les cinq campagnes réelles
             * 2022→2026 : 6 parcelles sur 150 sans aucun numéro interne. Une
             * parcelle sans numéro ne se retrouve pas en tapant son numéro,
             * n'affiche rien dans la colonne, et rien ne disait pourquoi.
             *
             * D'où vient la collision : TéléPAC renumérote. Un même champ est
             * l'îlot 13 parcelle 72 en 2022 et l'îlot 13 parcelle 10 en 2024 ;
             * le numéro 72 est ensuite réattribué à un autre champ. Deux
             * parcelles finissent par revendiquer `13-72`, et Parcelys refuse
             * — à raison — de les fondre en une seule : ce serait déplacer un
             * registre phytosanitaire sur la mauvaise parcelle.
             *
             * ───────────────────────────────────────────────────────────────
             * CE QUI EST FAIT
             * ───────────────────────────────────────────────────────────────
             *
             * Le numéro est suffixé de la campagne qui l'apporte : `13-72`
             * puis `13-72 (2025)`. Ce n'est pas une valeur inventée en
             * remplacement d'une donnée déclarée — le numéro d'îlot et le
             * numéro de parcelle restent intacts dans les entités PAC, qui
             * font foi en contrôle. C'est un libellé interne à Parcelys, que
             * l'exploitant remplace d'un clic par « la Croix Rouge ».
             */
            const numeroDeclare =
              feature.ilot && feature.numero ? `${feature.ilot}-${feature.numero}` : null;

            let numeroInterne = numeroDeclare;
            if (numeroDeclare && numerosPris.has(numeroDeclare)) {
              const candidat = `${numeroDeclare} (${year})`;
              let suffixe = candidat;
              let rang = 2;
              while (numerosPris.has(suffixe)) {
                suffixe = `${candidat}-${rang}`;
                rang += 1;
              }
              numeroInterne = suffixe;
              renumerotees.push({ declare: numeroDeclare, attribue: suffixe });
            }

            const nom =
              feature.numero && feature.ilot
                ? `Îlot ${feature.ilot} — parcelle ${feature.numero}`
                : feature.numero
                  ? `Parcelle ${feature.numero}`
                  : `Parcelle PAC ${feature.index + 1}`;

            const parcelle = await tx.parcel.create({
              data: {
                farmId,
                name: nom,
                pacId: feature.externalId ?? feature.numero ?? null,
                parcelType: 'PAC',
                areaHa: feature.areaHa ?? 0,
                ...(localisation(feature) ?? {}),
                // Le numéro interne reprend la numérotation de la déclaration
                // — c'est celle que l'exploitant a en tête et qu'un contrôle
                // emploiera. Jamais au prix d'un doublon : la contrainte
                // d'unicité porte sur (farmId, internalNumber), et le numéro a
                // été rendu unique juste au-dessus.
                ...(numeroInterne ? { internalNumber: numeroInterne } : {}),
              },
              select: { id: true },
            });
            if (numeroInterne) numerosPris.add(numeroInterne);

            if (feature.geojson) {
              await saveParcelGeometry(
                tx,
                parcelle.id,
                feature.geojson as never,
                `telepac-${year}`,
              );
            }

            await tx.pacChange.create({
              data: {
                campaignId: campaign.id,
                parcelId: parcelle.id,
                userId,
                changeType: 'import.create',
                newGeojson: (feature.geojson ?? undefined) as Prisma.InputJsonValue | undefined,
                newAreaHa: feature.areaHa ?? undefined,
                newCrop: feature.cropCode ?? undefined,
              },
            });

            parcelId = parcelle.id;
            touchees.add(parcelle.id);
            created += 1;
          }
        }

        // --- Culture déclarée -------------------------------------------
        //
        // Sans cela, une parcelle importée arrivait sans culture : le dossier
        // la déclare pourtant, et c'est elle qui commande le contrôle de dose,
        // le bilan azoté et le registre.
        //
        // La campagne existante n'est jamais écrasée : si l'exploitant a déjà
        // renseigné une culture pour cette année, c'est la sienne qui vaut —
        // il a pu corriger ce que la déclaration disait.
        if (parcelId && feature.cropCode) {
          const code = feature.cropCode.trim().toUpperCase();
          let cropId = culturesParCode.get(code);

          if (!cropId) {
            const creee = await tx.crop.create({
              data: {
                farmId,
                code,
                // Le libellé du dossier quand il y en a un ; sinon le code
                // lui-même. Jamais un nom deviné à partir du code.
                name: feature.cropLabel?.trim() || code,
                isCustom: true,
              },
              select: { id: true },
            });
            cropId = creee.id;
            culturesParCode.set(code, cropId);
          }

          const dejaLa = await tx.cropYear.findFirst({
            where: { parcelId, campaignYear: year },
            select: { id: true, cropId: true, notes: true },
          });

          if (!dejaLa) {
            await tx.cropYear.create({
              data: { parcelId, cropId, campaignYear: year, notes: MARQUE_IMPORT },
            });
            culturesRattachees += 1;
          } else if (dejaLa.notes === MARQUE_IMPORT && dejaLa.cropId !== cropId) {
            // Celle-ci vient d'un import précédent, pas de l'exploitant : une
            // déclaration corrigée doit pouvoir la corriger. La marque est
            // écrite à la création et disparaît dès que quelqu'un modifie la
            // ligne — on ne devine donc jamais l'origine, on la lit.
            await tx.cropYear.update({
              where: { id: dejaLa.id },
              data: { cropId },
            });
            culturesRattachees += 1;
          }
          // Sinon : la culture a été saisie ou corrigée à la main. Elle prime,
          // et l'import n'y touche pas.
        }

        const entite = await tx.pacFeature.create({
          data: {
            campaignId: campaign.id,
            ilotId,
            parcelId,
            kind: feature.kind,
            externalId: feature.externalId,
            numero: feature.numero,
            cropCode: feature.cropCode,
            cropLabel: feature.cropLabel,
            areaHa: feature.areaHa ?? undefined,
            sourceWkt: feature.sourceWkt,
            sourceSrid: feature.sourceSrid,
            attributes: feature.attributes as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        if (feature.geojson) await setFeatureGeometry(tx, entite.id, feature.geojson);
      }

      // --- Parcelles que le dossier ne mentionne pas -----------------------
      const orphelines = await tx.parcel.findMany({
        where: { farmId, deletedAt: null, id: { notIn: [...touchees] } },
        select: { id: true, name: true, areaHa: true },
      });

      const importe = await tx.pacImport.create({
        data: {
          campaignId: campaign.id,
          status: 'APPLIED',
          sourceFiles: params.sourceFiles as unknown as Prisma.InputJsonValue,
          detectedSrid: params.detectedSrid,
          srcLabel: params.sridLabel,
          featureCount: created + updated,
          ilotCount,
          areaHa: params.features.reduce((s, f) => s + (f.areaHa ?? 0), 0),
          report: {
            created,
            updated,
            ignored,
            orphans: orphelines.map((o) => ({ id: o.id, name: o.name })),
            renumerotees,
          } as unknown as Prisma.InputJsonValue,
          snapshotId: snapshot.id,
          createdById: userId,
          appliedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.pacCampaign.update({
        where: { id: campaign.id },
        data: { lastImportAt: new Date() },
      });

      return {
        importId: importe.id,
        snapshotId: snapshot.id,
        created,
        updated,
        ignored,
        ilots: ilotCount,
        crops: culturesRattachees,
        orphans: orphelines.map((o) => ({
          id: o.id,
          name: o.name,
          areaHa: Number(o.areaHa),
        })),
        renumerotees,
      };
    },
    // Un dossier PAC peut compter plusieurs centaines de parcelles, chacune
    // avec sa géométrie : la transaction est longue par nature.
    { timeout: 120_000, maxWait: 10_000 },
  );
}

/**
 * Rétablit l'état sauvegardé avant un import.
 *
 * Les parcelles créées depuis la sauvegarde ne sont pas détruites : elles sont
 * marquées supprimées, comme partout ailleurs dans Parcelys. Une restauration
 * qui effacerait pour de bon serait aussi dangereuse que l'import qu'elle
 * répare.
 */
export async function restoreSnapshot(params: {
  farmId: string;
  snapshotId: string;
  userId: string | null;
}): Promise<{ restored: number; softDeleted: number }> {
  return prisma.$transaction(
    async (tx) => {
      const snapshot = await tx.pacSnapshot.findFirstOrThrow({
        where: { id: params.snapshotId, campaign: { farmId: params.farmId } },
        select: { id: true, payload: true, campaignId: true },
      });

      const payload = snapshot.payload as unknown as Array<{
        id: string;
        name: string;
        pacId: string | null;
        areaHa: number | null;
        geojson: unknown | null;
      }>;

      const connus = new Set(payload.map((p) => p.id));
      let restored = 0;

      for (const parcelle of payload) {
        const existe = await tx.parcel.findFirst({
          where: { id: parcelle.id, farmId: params.farmId },
          select: { id: true },
        });
        if (!existe) continue;

        await tx.parcel.update({
          where: { id: parcelle.id },
          data: { name: parcelle.name, pacId: parcelle.pacId, deletedAt: null },
        });
        if (parcelle.geojson) {
          await saveParcelGeometry(tx, parcelle.id, parcelle.geojson as never, 'restauration');
        }
        restored += 1;
      }

      const surnumeraires = await tx.parcel.updateMany({
        where: { farmId: params.farmId, deletedAt: null, id: { notIn: [...connus] } },
        data: { deletedAt: new Date() },
      });

      await tx.pacSnapshot.update({
        where: { id: snapshot.id },
        data: { restoredAt: new Date() },
      });

      await tx.pacChange.create({
        data: {
          campaignId: snapshot.campaignId,
          userId: params.userId,
          changeType: 'snapshot.restore',
        },
      });

      return { restored, softDeleted: surnumeraires.count };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
