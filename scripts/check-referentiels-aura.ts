/**
 * Les référentiels AURA, éprouvés sur les données réellement importées.
 *
 *     npm run check:referentiels-aura
 *
 * Les tests automatiques emploient des zonages fictifs. Ce script pose une
 * exploitation **fictive** sur des emplacements **réels** d'Auvergne-Rhône-Alpes
 * — une commune classée en zone vulnérable, une commune classée « quelques
 * sections », une commune retirée du zonage en 2024, une zone d'actions
 * renforcée reconstituée, une autre indéterminée, un secteur hors zone, le bord
 * d'un cours d'eau — puis interroge les moteurs, et confronte chaque réponse à
 * ce que disent directement les tables importées.
 *
 * Il supprime son exploitation en partant, qu'il réussisse ou non. Il ne
 * touche à aucune autre donnée.
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import { saveParcelGeometry } from '@/lib/geo/repository';
import { computeParcelContext, getOrComputeParcelContext, statutZonage } from '@/lib/regulatory/geography';
import { controleBandeEnherbee, controlerApportPar, situationParcelle } from '@/lib/regulatory/programme-actions';
import { classementDuProduit } from '@/lib/regulatory/classement-produit';
import { calculerPlan } from '@/lib/regulatory/gren';
import { computeFarmIft } from '@/lib/regulatory/ift';
import { buildPhytoWarnings } from '@/lib/services/phyto-control';
import { buildComplianceReport } from '@/lib/regulatory/compliance';
import { getReferentialStates } from '@/lib/regulatory/referentials';

const NOM = 'Audit référentiels AURA (exploitation fictive)';
let echecs = 0;

function attendu(condition: boolean, quoi: string, detail = ''): void {
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
  if (!condition) {
    echecs += 1;
    process.exitCode = 1;
  }
}

/** Un carré d'environ 80 m de côté, coin sud-ouest au point donné. */
function carre(lon: number, lat: number, cote = 0.001) {
  return {
    type: 'Polygon' as const,
    coordinates: [
      [
        [lon, lat],
        [lon + cote, lat],
        [lon + cote, lat + cote],
        [lon, lat + cote],
        [lon, lat],
      ],
    ] as Array<Array<[number, number]>>,
  };
}

async function point(sql: string): Promise<{ lon: number; lat: number; code: string | null }> {
  const lignes = await prisma.$queryRawUnsafe<Array<{ lon: number; lat: number; code: string | null }>>(sql);
  const p = lignes[0];
  if (!p) throw new Error(`Aucun emplacement trouvé : ${sql}`);
  return p;
}

async function main(): Promise<void> {
  const etats = await getReferentialStates();
  const absents = ['zones-vulnerables', 'zones-action-renforcee', 'programme-actions-nitrates', 'gren', 'cours-eau', 'limites-administratives', 'ift-doses-reference', 'ephy']
    .filter((code) => !etats.find((e) => e.code === code)?.versions.some((v) => v.status === 'ACTIF'));
  if (absents.length > 0) {
    console.error(`✗ Référentiels non importés : ${absents.join(', ')}. Lancez d’abord « npm run referentiels:aura ».`);
    process.exitCode = 1;
    return;
  }
  attendu(
    etats.filter((e) => e.versions.length > 0).every((e) => e.status !== 'NON_CONFIGURE'),
    'Aucun référentiel intégré ne se présente comme « non importé »',
  );

  await prisma.farm.deleteMany({ where: { name: NOM } });
  const farm = await prisma.farm.create({ data: { name: NOM, department: '03' } });

  try {
    const parcelle = async (nom: string, lon: number, lat: number, insee: string | null) => {
      const p = await prisma.parcel.create({ data: { farmId: farm.id, name: nom, areaHa: 0, inseeCode: insee } });
      await saveParcelGeometry(prisma, p.id, carre(lon, lat));
      await computeParcelContext(p.id);
      return p.id;
    };
    const intersecte = async (parcelId: string, code: string, zoneCode: string) => {
      const r = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM regulatory_zones z
        JOIN regulatory_referentials r ON r.id = z.referential_id AND r.status = 'ACTIF' AND r.code = ${code}
        JOIN parcel_geometries pg ON pg.parcel_id = ${parcelId} AND pg.is_current
        WHERE z.code = ${zoneCode} AND ST_Intersects(z.geom, pg.geom)`;
      return (r[0]?.n ?? 0) > 0;
    };

    // --- Zones vulnérables -------------------------------------------------
    const zvSql = (filtre: string) => `
      SELECT ST_X(p) AS lon, ST_Y(p) AS lat, code FROM (
        SELECT z.code, ST_PointOnSurface(z.geom) AS p FROM regulatory_zones z
        JOIN regulatory_referentials r ON r.id = z.referential_id AND r.code = 'zones-vulnerables' AND r.status = 'ACTIF'
        WHERE ${filtre} ORDER BY z.code LIMIT 1) s`;
    const classee = await point(zvSql(`z.code LIKE '03%' AND z.attributes->'classements'->-1->>'valeur' = 'toutes sections'`));
    const partielle = await point(zvSql(`z.code LIKE '03%' AND z.attributes->'classements'->-1->>'valeur' = 'quelques sections'`));
    const retiree = await point(zvSql(`z.attributes->'classements'->-1->>'valeur' = 'suppression'`));

    const pClassee = await parcelle('ZV toutes sections', classee.lon, classee.lat, classee.code);
    const pPartielle = await parcelle('ZV quelques sections', partielle.lon, partielle.lat, partielle.code);
    const pRetiree = await parcelle('ZV retirée en 2024', retiree.lon, retiree.lat, retiree.code);

    const ctx = (id: string) => getOrComputeParcelContext(id);

    attendu(await intersecte(pClassee, 'zones-vulnerables', classee.code!), `La parcelle « toutes sections » recoupe la commune ${classee.code} (SQL)`);
    attendu(statutZonage(await ctx(pClassee), 'ZONE_VULNERABLE', new Date('2026-03-01')) === 'dedans', 'Commune « toutes sections » : en zone vulnérable');
    attendu(statutZonage(await ctx(pPartielle), 'ZONE_VULNERABLE', new Date('2026-03-01')) === 'indetermine', 'Commune « quelques sections » : appartenance indéterminée');
    const avant = statutZonage(await ctx(pRetiree), 'ZONE_VULNERABLE', new Date('2024-03-01'));
    const apres = statutZonage(await ctx(pRetiree), 'ZONE_VULNERABLE', new Date('2026-03-01'));
    attendu(avant === 'dedans' && apres !== 'dedans', `Commune retirée par le tribunal administratif : classée en 2024-03 (${avant}), plus en 2026 (${apres})`);

    // --- Programme d'actions : une vraie période d'interdiction -------------
    const crop = await prisma.crop.create({ data: { farmId: farm.id, code: 'AUDIT_MAIS', name: 'Maïs grain' } });
    await prisma.cropYear.create({
      data: { parcelId: pClassee, cropId: crop.id, campaignYear: 2026, sowingDate: new Date('2026-04-20T00:00:00Z'), expectedHarvestDate: new Date('2026-10-10T00:00:00Z') },
    });
    const { controles } = await controlerApportPar({
      parcelId: pClassee,
      date: new Date('2026-02-20T00:00:00Z'),
      nature: 'MINERAL',
      libelle: 'Ammonitrate 33,5 %',
      azoteTotalKgHa: 60,
      classement: classementDuProduit({ inputType: 'MINERAL', nPercent: 33.5 }),
    });
    const periode = controles.find((c) => c.sujet === 'Période d’épandage');
    attendu(periode?.verdict === 'alerte', 'Type III le 20 février avant un maïs, en zone vulnérable : interdit (PAR7)', periode?.detail);
    attendu(Boolean(periode?.trace?.texte?.includes('24-135')), 'Le constat cite l’arrêté n° 24-135', periode?.trace?.texte ?? '');
    const horsPeriode = await controlerApportPar({
      parcelId: pRetiree,
      date: new Date('2026-02-20T00:00:00Z'),
      nature: 'MINERAL',
      libelle: 'Ammonitrate 33,5 %',
      azoteTotalKgHa: 60,
      classement: classementDuProduit({ inputType: 'MINERAL', nPercent: 33.5 }),
    });
    attendu(
      horsPeriode.controles.every((c) => c.verdict !== 'alerte'),
      'Commune retirée : aucune interdiction du programme d’actions opposée en 2026',
    );

    // --- Zones d'actions renforcées -----------------------------------------
    const zarSql = (reconstitue: boolean) => `
      SELECT ST_X(p) AS lon, ST_Y(p) AS lat, code FROM (
        SELECT z.code, ST_PointOnSurface(z.geom) AS p FROM regulatory_zones z
        JOIN regulatory_referentials r ON r.id = z.referential_id AND r.code = 'zones-action-renforcee' AND r.status = 'ACTIF'
        WHERE (z.attributes->>'reconstitue')::boolean = ${reconstitue} ORDER BY z.code LIMIT 1) s`;
    const zarAac = await point(zarSql(true));
    const zarIncertaine = await point(zarSql(false));
    const pZar = await parcelle('Dans une ZAR reconstituée', zarAac.lon, zarAac.lat, null);
    const pZarInc = await parcelle('Dans une ZAR indéterminée', zarIncertaine.lon, zarIncertaine.lat, null);
    const sZar = await situationParcelle(pZar, new Date('2026-03-01T00:00:00Z'));
    const sZarInc = await situationParcelle(pZarInc, new Date('2026-03-01T00:00:00Z'));
    attendu(await intersecte(pZar, 'zones-action-renforcee', zarAac.code!), `La parcelle recoupe la ZAR « ${zarAac.code} » (SQL)`);
    attendu(sZar.zar.statut === 'dedans' && sZar.zar.reconstitue, 'ZAR reconstituée depuis l’AAC : dedans, signalée comme reconstituée', sZar.zar.statut);
    attendu(sZarInc.zar.statut === 'indetermine', 'ZAR sans aire d’alimentation fournie : indéterminée', sZarInc.zar.statut);

    // --- Hors zone ------------------------------------------------------------
    const horsZone = await point(`
      SELECT ST_X(p) AS lon, ST_Y(p) AS lat, NULL::text AS code FROM (
        SELECT ST_PointOnSurface(ST_Difference(r.geom, (SELECT ST_Union(z.geom) FROM regulatory_zones z
          JOIN regulatory_referentials rz ON rz.id = z.referential_id AND rz.code = 'zones-vulnerables' AND rz.status = 'ACTIF'))) AS p
        FROM regulatory_zones r JOIN regulatory_referentials rr ON rr.id = r.referential_id AND rr.code = 'limites-administratives'
        WHERE r.kind = 'REGION_ADMINISTRATIVE' LIMIT 1) s`);
    const pHors = await parcelle('Hors zone vulnérable', horsZone.lon, horsZone.lat, null);
    attendu(statutZonage(await ctx(pHors), 'ZONE_VULNERABLE', new Date('2026-03-01')) === 'dehors', 'Parcelle en AURA hors des communes classées : hors zone vulnérable');

    // --- Cours d'eau : distance et bande enherbée -----------------------------
    const ecoulement = await point(`
      SELECT ST_X(p) AS lon, ST_Y(p) AS lat, code FROM (
        SELECT z.code, ST_LineInterpolatePoint(ST_GeometryN(z.geom, 1), 0.5) AS p FROM regulatory_zones z
        JOIN regulatory_referentials r ON r.id = z.referential_id AND r.code = 'cours-eau' AND r.status = 'ACTIF'
        WHERE z.kind = 'TRONCON_HYDROGRAPHIQUE' AND z.code LIKE '%' AND ST_Within(z.geom, (SELECT geom FROM regulatory_zones WHERE code = '${classee.code}' LIMIT 1))
        ORDER BY z.code LIMIT 1) s`);
    // Le coin sud-ouest à 3 m à l'est du point de l'écoulement.
    const decalage = 3 / (111_320 * Math.cos((ecoulement.lat * Math.PI) / 180));
    const pEau = await parcelle('Bord de cours d’eau', ecoulement.lon + decalage, ecoulement.lat, classee.code);
    const [{ d } = { d: -1 }] = await prisma.$queryRaw<Array<{ d: number }>>`
      SELECT MIN(ST_Distance(z.geom::geography, pg.geom::geography))::float AS d
      FROM regulatory_zones z
      JOIN regulatory_referentials r ON r.id = z.referential_id AND r.code = 'cours-eau' AND r.status = 'ACTIF'
      JOIN parcel_geometries pg ON pg.parcel_id = ${pEau} AND pg.is_current
      WHERE z.kind = 'TRONCON_HYDROGRAPHIQUE' AND ST_DWithin(z.geom::geography, pg.geom::geography, 500)
        -- Les tronçons fictifs (raccords tracés à travers une surface en eau)
        -- ne figurent pas une berge : le moteur les écarte, le contrôle aussi.
        AND COALESCE(z.attributes->>'TronconFic', '0') <> '1'`;
    const proche = (await ctx(pEau))?.proximites.find((p) => p.kind === 'TRONCON_HYDROGRAPHIQUE');
    attendu(
      proche !== undefined && Math.abs(proche.distanceM - Math.round(d)) <= 1,
      'Distance au tronçon le plus proche : moteur et SQL concordent',
      `${proche?.distanceM} m / ${d.toFixed(1)} m`,
    );
    // L'élément hydrographique le plus proche, toutes natures confondues.
    const [{ dh } = { dh: -1 }] = await prisma.$queryRaw<Array<{ dh: number }>>`
      SELECT MIN(ST_Distance(z.geom::geography, pg.geom::geography))::float AS dh
      FROM regulatory_zones z
      JOIN regulatory_referentials r ON r.id = z.referential_id AND r.code = 'cours-eau' AND r.status = 'ACTIF'
      JOIN parcel_geometries pg ON pg.parcel_id = ${pEau} AND pg.is_current
      WHERE z.kind IN ('TRONCON_HYDROGRAPHIQUE', 'COURS_EAU', 'SURFACE_HYDROGRAPHIQUE', 'PLAN_EAU')
        AND COALESCE(z.attributes->>'TronconFic', '0') <> '1'
        AND ST_DWithin(z.geom::geography, pg.geom::geography, 500)`;
    const bande = await controleBandeEnherbee(pEau, new Date('2026-03-01T00:00:00Z'));
    attendu(
      dh <= 5 ? bande?.verdict === 'verification' : bande?.verdict !== 'alerte',
      `Bande enherbée (élément hydrographique à ${dh.toFixed(1)} m) : ${dh <= 5 ? 'à vérifier' : 'rien à opposer'}, jamais une alerte déduite de la seule carte`,
      bande?.detail ?? 'aucun point',
    );

    // --- GREN : une dose calculée sur une vraie commune de l'Allier -----------
    const ble = await prisma.crop.create({ data: { farmId: farm.id, code: 'AUDIT_BLE', name: 'Blé tendre d’hiver' } });
    const cyBle = await prisma.cropYear.create({
      data: { parcelId: pPartielle, cropId: ble.id, campaignYear: 2026, sowingDate: new Date('2025-10-15T00:00:00Z') },
    });
    const plan = await calculerPlan({
      cropYearId: cyBle.id,
      farmId: farm.id,
      saisie: {
        culture: 'cereales-paille',
        typeSol: 'argilo-calcaire-moyen-a-profond',
        espece: 'ble-tendre',
        besoin: { mode: 'variete-non-referencee' },
        objectif: { mode: 'declare', valeur: 80, justification: 'audit' },
        choix: {
          Pi: { stade: '2-talles' },
          Ri: { precedent: 'colza-cereales-betterave' },
          Mh: { systeme: 'enfouis-1-sur-2-sans-mo' },
          Mr: { precedent: 'betterave-colza-luzerne-2ans-pois-soja-haricot-pdt' },
        },
        sansObjet: ['Mhp', 'Nirr'],
      },
    });
    attendu(plan.calcul.doseKgHa === 140, 'GREN : blé tendre, Allier, argilo-calcaire profond — 140 kg N/ha', JSON.stringify(plan.calcul.bloquants));
    attendu(plan.referentiel?.code === 'gren' && Boolean(plan.traces['gren-ft2-ri-allier']), 'GREN : la dose cite les règles employées (reliquats de l’Allier)');

    // --- IFT : une vraie dose de référence 2026, et une culture absente en 2025 -
    const [ref] = await prisma.$queryRaw<Array<{ amm: string; crop_label: string; dose_value: string; dose_unit: string }>>`
      SELECT i.amm, i.crop_label, i.dose_value, i.dose_unit FROM ift_references i
      JOIN regulatory_referentials r ON r.id = i.referential_id AND r.code = 'ift-doses-reference' AND r.version = '2026'
      WHERE i.amm IS NOT NULL AND i.dose_value ~ '^[0-9]+(\\.[0-9]+)?$' AND upper(i.dose_unit) = 'L/HA'
        AND i.target_label IS NULL AND i.category <> 'Traitement de semences'
      ORDER BY i.amm LIMIT 1`;
    attendu(Boolean(ref), 'IFT 2026 : une dose de référence à la culture en L/HA existe dans le fichier importé');
    if (ref) {
      const surface = Number((await prisma.parcel.findUniqueOrThrow({ where: { id: pHors } })).areaHa);
      await prisma.phytosanitaryApplication.create({
        data: {
          parcelId: pHors,
          appliedOn: new Date('2026-04-15T00:00:00Z'),
          productName: 'Produit d’audit',
          amm: ref.amm,
          cropLabel: ref.crop_label,
          dose: Number(ref.dose_value),
          // L'unité telle que Parcelys la saisit : le fichier écrit « L/HA ».
          doseUnit: 'L/ha',
          quantityUsed: Number(ref.dose_value) * surface,
          quantityUnit: 'L',
          treatedAreaHa: surface,
        },
      });
      const ift = await computeFarmIft({ farmId: farm.id, campaignYear: 2026 });
      attendu(ift.source?.version === '2026' && ift.total === 1, `IFT 2026 : la dose de référence pleine sur toute la parcelle vaut 1 (${ref.crop_label}, AMM ${ref.amm})`, `total ${ift.total}`);
    }
    const ift2024 = await computeFarmIft({ farmId: farm.id, campaignYear: 2024 });
    attendu(ift2024.configured === false && ift2024.total === null, 'IFT 2024 : pas de doses de cette campagne, pas d’IFT (aucune autre campagne employée)');

    // --- E-Phy : ZNT, DAR et écoulement voisin ---------------------------------
    const usage = await prisma.phytoUsage.findFirst({
      where: { zntAquaticM: { in: ['5', '5.0', '20', '20.0'] }, preHarvestDelay: { not: null }, cropLabel: { not: null }, product: { withdrawnAt: null } },
      select: { productId: true, cropLabel: true, doseValue: true, doseUnit: true, zntAquaticM: true, preHarvestDelay: true, product: { select: { name: true } } },
    });
    if (usage) {
      const avertissements = await buildPhytoWarnings({
        parcelId: pEau,
        productId: usage.productId,
        cropLabel: usage.cropLabel,
        cropYearId: null,
        dose: Number(usage.doseValue ?? 0) || 0.1,
        doseUnit: usage.doseUnit ?? 'L/ha',
        appliedOn: new Date('2026-04-15T00:00:00Z'),
      });
      attendu(
        avertissements.some((a) => a.includes('Zones non traitées') && a.includes(usage.zntAquaticM!)),
        `E-Phy : la ZNT aquatique de l’usage (${usage.zntAquaticM} m, ${usage.product.name}) est rappelée`,
      );
      const eau = avertissements.find((a) => a.startsWith('ZNT aquatique de'));
      attendu(
        dh <= Number(usage.zntAquaticM) ? Boolean(eau?.includes('Parcelys ne sait pas lequel l’est')) : eau === undefined,
        'E-Phy + BD TOPAGE : l’écoulement à portée de ZNT est nommé, sans conclure que la ZNT s’applique',
        eau ?? 'aucun écoulement à portée',
      );
    }

    // --- Synthèse : jamais « conforme » -----------------------------------------
    const rapport = await buildComplianceReport({ farmId: farm.id, campaignYear: 2026 });
    attendu(!/légalement conforme/i.test(rapport.summary), 'La synthèse ne déclare jamais l’exploitation « légalement conforme »', rapport.summary);
    attendu(
      rapport.findings.some((f) => f.code === 'ppf.absent' && f.parcelId === pClassee),
      'Plan prévisionnel de fumure demandé pour la parcelle en zone vulnérable',
    );
    attendu(
      !rapport.findings.some((f) => f.code === 'ppf.absent' && f.parcelId === pHors),
      'Aucun plan demandé hors zone vulnérable',
    );
  } finally {
    await prisma.farm.delete({ where: { id: farm.id } }).catch(() => undefined);
  }

  console.info(echecs === 0 ? '\n✓ Tout concorde.' : `\n✗ ${echecs} écart(s).`);
}

main()
  .catch((erreur) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
