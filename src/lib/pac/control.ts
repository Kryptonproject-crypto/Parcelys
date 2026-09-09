/**
 * Contrôle du dossier PAC, avant export.
 *
 * Ce contrôle vérifie ce qui est vérifiable **par nous** : la cohérence
 * géométrique et interne du parcellaire. Il ne remplace pas les contrôles de
 * TéléPAC, qui portent en plus sur des règles réglementaires (admissibilité,
 * éligibilité, seuils) dont Parcelys n'a pas connaissance.
 *
 * Le dire est important : un dossier « conforme » ici est un dossier dont la
 * géométrie tient debout, pas un dossier accepté. C'est le libellé employé dans
 * l'interface, et c'est celui du rapport.
 */

import { prisma } from '@/lib/prisma';

export type ControlLevel = 'ok' | 'warning' | 'error';

export type ControlFinding = {
  level: ControlLevel;
  /** Regroupement à l'affichage. */
  category: string;
  message: string;
  /** Parcelles concernées, pour pouvoir y aller directement. */
  parcels?: Array<{ id: string; name: string }>;
};

export type ControlReport = {
  level: ControlLevel;
  checkedAt: string;
  parcelCount: number;
  areaHa: number;
  findings: ControlFinding[];
  /** Ce que ce contrôle ne couvre pas. Affiché avec le rapport. */
  disclaimer: string;
};

const DISCLAIMER =
  "Ce contrôle porte sur la cohérence géométrique et interne du parcellaire. " +
  "Il ne vérifie ni l'admissibilité des surfaces, ni l'éligibilité aux aides, " +
  "ni les règles propres à la campagne : ces contrôles-là sont ceux de TéléPAC, " +
  "et eux seuls font foi.";

export async function controlDossier(params: {
  farmId: string;
  year: number;
}): Promise<ControlReport> {
  const { farmId, year } = params;
  const findings: ControlFinding[] = [];

  const parcelles = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      area: number | null;
      valid: boolean | null;
      reason: string | null;
      pac_id: string | null;
      geom_present: boolean;
    }>
  >`
    SELECT
      p.id, p.name, p.pac_id,
      ST_Area(pg.geom::geography) / 10000.0 AS area,
      ST_IsValid(pg.geom) AS valid,
      CASE WHEN ST_IsValid(pg.geom) THEN NULL ELSE ST_IsValidReason(pg.geom) END AS reason,
      (pg.geom IS NOT NULL) AS geom_present
    FROM parcels p
    LEFT JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
    WHERE p.farm_id = ${farmId} AND p.deleted_at IS NULL
    ORDER BY p.name
  `;

  const areaHa = parcelles.reduce((s, p) => s + Number(p.area ?? 0), 0);

  // --- Géométrie -----------------------------------------------------------
  const sansGeom = parcelles.filter((p) => !p.geom_present);
  if (sansGeom.length > 0) {
    findings.push({
      level: 'error',
      category: 'Géométrie',
      message: `${sansGeom.length} parcelle(s) sans contour. Une parcelle sans géométrie ne peut pas figurer dans un export graphique.`,
      parcels: sansGeom.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  const invalides = parcelles.filter((p) => p.geom_present && p.valid === false);
  if (invalides.length > 0) {
    findings.push({
      level: 'error',
      category: 'Géométrie',
      message:
        `${invalides.length} géométrie(s) invalide(s) — ` +
        invalides
          .slice(0, 3)
          .map((p) => `« ${p.name} » : ${p.reason ?? 'raison inconnue'}`)
          .join(' ; '),
      parcels: invalides.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  const minuscules = parcelles.filter(
    (p) => p.geom_present && Number(p.area ?? 0) > 0 && Number(p.area ?? 0) < 0.01,
  );
  if (minuscules.length > 0) {
    findings.push({
      level: 'warning',
      category: 'Surfaces',
      message: `${minuscules.length} parcelle(s) de moins d'un are. Vérifiez qu'il ne s'agit pas de résidus de découpage.`,
      parcels: minuscules.map((p) => ({ id: p.id, name: p.name })),
    });
  }

  // --- Chevauchements ------------------------------------------------------
  // Deux parcelles déclarées ne doivent pas se recouvrir : la surface serait
  // comptée deux fois. On tolère un filet de recouvrement (un are) qui relève
  // de la précision de numérisation, pas d'une erreur de déclaration.
  const chevauchements = await prisma.$queryRaw<
    Array<{ a_id: string; a_name: string; b_id: string; b_name: string; area: number }>
  >`
    SELECT a.id AS a_id, a.name AS a_name, b.id AS b_id, b.name AS b_name,
           ST_Area(ST_Intersection(ga.geom, gb.geom)::geography) / 10000.0 AS area
    FROM parcels a
    JOIN parcel_geometries ga ON ga.parcel_id = a.id AND ga.is_current = true
    JOIN parcels b ON b.farm_id = a.farm_id AND b.id > a.id AND b.deleted_at IS NULL
    JOIN parcel_geometries gb ON gb.parcel_id = b.id AND gb.is_current = true
    WHERE a.farm_id = ${farmId} AND a.deleted_at IS NULL
      AND ST_Overlaps(ga.geom, gb.geom)
      AND ST_Area(ST_Intersection(ga.geom, gb.geom)::geography) / 10000.0 > 0.01
    ORDER BY area DESC
    LIMIT 20
  `;

  if (chevauchements.length > 0) {
    const total = chevauchements.reduce((s, c) => s + Number(c.area), 0);
    findings.push({
      level: 'error',
      category: 'Chevauchements',
      message:
        `${chevauchements.length} chevauchement(s), ${total.toFixed(2)} ha au total. ` +
        chevauchements
          .slice(0, 3)
          .map((c) => `« ${c.a_name} » et « ${c.b_name} » (${Number(c.area).toFixed(2)} ha)`)
          .join(' ; '),
      parcels: chevauchements.flatMap((c) => [
        { id: c.a_id, name: c.a_name },
        { id: c.b_id, name: c.b_name },
      ]),
    });
  }

  // --- Doublons ------------------------------------------------------------
  const doublons = new Map<string, Array<{ id: string; name: string }>>();
  for (const p of parcelles) {
    if (!p.pac_id) continue;
    const liste = doublons.get(p.pac_id) ?? [];
    liste.push({ id: p.id, name: p.name });
    doublons.set(p.pac_id, liste);
  }
  const enDouble = [...doublons.entries()].filter(([, l]) => l.length > 1);
  if (enDouble.length > 0) {
    findings.push({
      level: 'error',
      category: 'Identifiants',
      message: `${enDouble.length} identifiant(s) PAC porté(s) par plusieurs parcelles : ${enDouble
        .slice(0, 3)
        .map(([id, l]) => `« ${id} » (${l.map((p) => p.name).join(', ')})`)
        .join(' ; ')}`,
      parcels: enDouble.flatMap(([, l]) => l),
    });
  }

  // --- Rattachement et cultures --------------------------------------------
  const campaign = await prisma.pacCampaign.findUnique({
    where: { farmId_year: { farmId, year } },
    select: { id: true, lastImportAt: true },
  });

  if (!campaign) {
    findings.push({
      level: 'warning',
      category: 'Dossier',
      message: `Aucun import PAC pour la campagne ${year} : l'export partira du parcellaire Parcelys seul, sans îlots ni identifiants PAC.`,
    });
  } else {
    const sansIlot = await prisma.pacFeature.count({
      where: { campaignId: campaign.id, kind: 'PARCELLE', ilotId: null },
    });
    if (sansIlot > 0) {
      findings.push({
        level: 'warning',
        category: 'Îlots',
        message: `${sansIlot} parcelle(s) PAC ne sont rattachées à aucun îlot.`,
      });
    }

    const sansCulture = await prisma.pacFeature.count({
      where: { campaignId: campaign.id, kind: 'PARCELLE', cropCode: null },
    });
    if (sansCulture > 0) {
      findings.push({
        level: 'warning',
        category: 'Cultures',
        message: `${sansCulture} parcelle(s) PAC sans code culture. La déclaration en exige un pour chacune.`,
      });
    }
  }

  // Cultures déclarées dans Parcelys pour la campagne : c'est ce que
  // l'agriculteur a saisi, et c'est ce qui partira.
  const cultures = await prisma.cropYear.count({
    where: { campaignYear: year, parcel: { farmId, deletedAt: null } },
  });
  const avecGeom = parcelles.filter((p) => p.geom_present).length;
  if (cultures < avecGeom) {
    findings.push({
      level: 'warning',
      category: 'Cultures',
      message: `${avecGeom - cultures} parcelle(s) sans culture renseignée pour la campagne ${year}.`,
    });
  }

  if (parcelles.length === 0) {
    findings.push({
      level: 'error',
      category: 'Dossier',
      message: "L'exploitation ne compte aucune parcelle : il n'y a rien à exporter.",
    });
  }

  const level: ControlLevel = findings.some((f) => f.level === 'error')
    ? 'error'
    : findings.some((f) => f.level === 'warning')
      ? 'warning'
      : 'ok';

  return {
    level,
    checkedAt: new Date().toISOString(),
    parcelCount: parcelles.length,
    areaHa,
    findings,
    disclaimer: DISCLAIMER,
  };
}
