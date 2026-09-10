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
import { saveParcelGeometry } from '@/lib/geo/repository';
import type { AnalyzedFeature, MatchDecision } from '@/lib/pac/analyze';

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
  /** Parcelles présentes dans Parcelys mais absentes du dossier importé. */
  orphans: Array<{ id: string; name: string; areaHa: number }>;
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
           ST_AsGeoJSON(pg.geom) AS geojson
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
        ilotCount += 1;
      }

      // --- Entités et parcelles -------------------------------------------
      let created = 0;
      let updated = 0;
      let ignored = 0;
      const touchees = new Set<string>();

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
          const cible = parDecision.get(cle)?.parcelId ?? feature.match?.parcelId ?? null;

          if (decision === 'update' && cible) {
            const avant = await tx.$queryRaw<Array<{ area: number | null; geojson: string | null }>>`
              SELECT ST_Area(geom::geography) / 10000.0 AS area, ST_AsGeoJSON(geom) AS geojson
              FROM parcel_geometries WHERE parcel_id = ${cible} AND is_current = true
            `;

            await tx.parcel.update({
              where: { id: cible },
              data: {
                pacId: feature.externalId ?? feature.numero ?? undefined,
                parcelType: 'PAC',
              },
            });

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
              },
              select: { id: true },
            });

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
        orphans: orphelines.map((o) => ({
          id: o.id,
          name: o.name,
          areaHa: Number(o.areaHa),
        })),
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
