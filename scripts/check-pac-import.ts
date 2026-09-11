/**
 * Import d'un dossier TéléPAC, de bout en bout, sur une vraie base.
 *
 *   npm run check:pac -- chemin/DossierPAC2025.xml chemin/DossierPAC2026.xml
 *
 * Ce que ce script protège — et qu'aucun test unitaire ne peut protéger, parce
 * que ces garanties portent sur ce qui reste en base après coup :
 *
 *  · **les données agronomiques survivent à l'import.** Un dossier PAC redécrit
 *    le parcellaire ; il ne sait rien des traitements, des apports ni des
 *    interventions. Un import qui les emporterait ferait perdre le registre
 *    phytosanitaire — la pièce qu'on présente en contrôle ;
 *  · **l'historique des campagnes est conservé.** Importer 2026 ne doit pas
 *    effacer 2025. Ce sont deux déclarations, pas deux versions d'une même ;
 *  · **la géométrie précédente n'est pas écrasée** mais versionnée ;
 *  · **les SNA ponctuelles entrent en base.** 157 des 560 SNA de la campagne
 *    2026 sont des points ; la colonne les refusait avant d'être élargie ;
 *  · **un second import de la même campagne ne détruit rien.**
 *
 * Le script travaille sur l'exploitation d'essai de la base locale. Il n'écrit
 * jamais dans une exploitation qui n'est pas celle-là.
 */
import './load-env';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { prisma } from '@/lib/prisma';
import { readDossier } from '@/lib/pac/dossier';
import { analyzeDossier } from '@/lib/pac/analyze';
import { applyImport } from '@/lib/pac/apply';

let echecs = 0;

function attendu(condition: boolean, quoi: string, detail = ''): void {
  console.info(`${condition ? '✓' : '✗'} ${quoi}${detail ? ` — ${detail}` : ''}`);
  if (!condition) {
    echecs += 1;
    process.exitCode = 1;
  }
}

/** Ce que l'import ne doit toucher sous aucun prétexte. */
async function etatAgronomique(farmId: string) {
  const [operations, phyto, fertilisation, cropYears, geometries] = await Promise.all([
    prisma.agriculturalOperation.count({ where: { parcel: { farmId } } }),
    prisma.phytosanitaryApplication.count({ where: { cropYear: { parcel: { farmId } } } }),
    prisma.fertilizerApplication.count({ where: { cropYear: { parcel: { farmId } } } }),
    prisma.cropYear.findMany({
      where: { parcel: { farmId } },
      select: { id: true, cropId: true, campaignYear: true, parcelId: true },
    }),
    prisma.parcelGeometry.count({ where: { parcel: { farmId } } }),
  ]);
  return { operations, phyto, fertilisation, cropYears, geometries };
}

/** Année de campagne portée par le nom du fichier, à défaut par l'en-tête. */
function anneeDuFichier(nom: string, campagne: string | null): number {
  const trouve = /DossierPAC(\d{4})/i.exec(nom)?.[1];
  if (trouve) return Number(trouve);
  const annee = new Date().getFullYear();
  return campagne === 'Precedente' ? annee - 1 : annee;
}

async function importer(chemin: string, farmId: string) {
  const nom = basename(chemin);
  const fichiers = [{ name: nom, buffer: readFileSync(chemin) }];

  const dossier = await readDossier(fichiers, new Date().getFullYear());
  const year = anneeDuFichier(nom, dossier.declaration?.campagne ?? null);

  console.info(`\n▸ ${nom} → campagne ${year}`);
  attendu(
    dossier.layers.length >= 2,
    'le dossier XML produit des couches exploitables',
    `${dossier.layers.length} couches`,
  );

  const analyse = await analyzeDossier({
    farmId,
    year,
    layers: dossier.layers,
    ignoredFiles: dossier.ignored,
    problems: dossier.problems,
    provenance: dossier.provenance,
  });

  attendu(
    analyse.provenance.includes('constatée') || analyse.provenance.includes('constatées'),
    'la provenance dit que la structure est constatée, pas certifiée',
  );
  attendu(
    analyse.totals.invalid === 0,
    'aucune entité illisible',
    `${analyse.totals.invalid} sur ${analyse.features.length}`,
  );

  const resultat = await applyImport({
    farmId,
    year,
    userId: null,
    features: analyse.features,
    decisions: [],
    sourceFiles: [nom],
    detectedSrid: analyse.layers[0]?.srid ?? null,
    sridLabel: analyse.layers[0]?.sridLabel ?? '',
    ilotLayers: analyse.layers.filter((c) => c.isIlotLayer).map((c) => c.name),
  });

  return { year, analyse, resultat };
}

async function main() {
  const fichiers = process.argv.slice(2);
  if (fichiers.length === 0) {
    console.error(
      'Usage : npm run check:pac -- <DossierPAC2025.xml> <DossierPAC2026.xml>\n' +
        'Donnez au moins deux campagnes : la conservation de l’historique est ' +
        'précisément ce que ce script vérifie.',
    );
    process.exit(2);
  }

  const farm = await prisma.farm.findFirst({
    where: { deletedAt: null, parcels: { some: { deletedAt: null } } },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!farm) {
    console.error('Aucune exploitation avec parcelles. Lancez le seed.');
    process.exit(1);
  }
  console.info(`Exploitation d'essai : ${farm.name}`);

  const avant = await etatAgronomique(farm.id);
  const parcellesAvant = await prisma.parcel.count({
    where: { farmId: farm.id, deletedAt: null },
  });
  console.info(
    `État avant : ${parcellesAvant} parcelles, ${avant.operations} interventions, ` +
      `${avant.phyto} traitements, ${avant.fertilisation} apports, ` +
      `${avant.cropYears.length} cultures.`,
  );

  const campagnes: number[] = [];
  for (const chemin of fichiers) {
    const { year, resultat } = await importer(chemin, farm.id);
    campagnes.push(year);
    console.info(
      `  ${resultat.created} parcelle(s) créée(s), ${resultat.updated} mise(s) à jour, ` +
        `${resultat.ignored} ignorée(s), ${resultat.ilots} îlot(s).`,
    );
  }

  // ---- Les données agronomiques ont-elles survécu ? ------------------------
  const apres = await etatAgronomique(farm.id);
  attendu(
    apres.operations === avant.operations,
    'les interventions sont intactes',
    `${avant.operations} → ${apres.operations}`,
  );
  attendu(
    apres.phyto === avant.phyto,
    'le registre phytosanitaire est intact',
    `${avant.phyto} → ${apres.phyto}`,
  );
  attendu(
    apres.fertilisation === avant.fertilisation,
    'les apports de fertilisation sont intacts',
    `${avant.fertilisation} → ${apres.fertilisation}`,
  );
  // L'import **ajoute** désormais la culture déclarée aux parcelles qui n'en
  // avaient pas : le compte grandit, et c'est voulu. Ce qui ne doit pas
  // bouger, c'est ce qui était déjà là — l'exploitant a pu corriger ce que la
  // déclaration disait, et sa saisie prime.
  const parId = new Map(apres.cropYears.map((c) => [c.id, c]));
  const disparues = avant.cropYears.filter((c) => !parId.has(c.id));
  const modifiees = avant.cropYears.filter((c) => {
    const apresC = parId.get(c.id);
    return (
      apresC !== undefined &&
      (apresC.cropId !== c.cropId ||
        apresC.campaignYear !== c.campaignYear ||
        apresC.parcelId !== c.parcelId)
    );
  });
  attendu(
    disparues.length === 0 && modifiees.length === 0,
    'les cultures déjà saisies ne sont ni supprimées ni modifiées',
    `${disparues.length} disparue(s), ${modifiees.length} modifiée(s) ` +
      `sur ${avant.cropYears.length}`,
  );
  attendu(
    apres.cropYears.length >= avant.cropYears.length,
    'les cultures déclarées viennent s’ajouter',
    `${avant.cropYears.length} → ${apres.cropYears.length}`,
  );
  attendu(
    apres.geometries >= avant.geometries,
    'aucune géométrie précédente supprimée (versionnées, pas écrasées)',
    `${avant.geometries} → ${apres.geometries}`,
  );

  // ---- L'historique des campagnes tient-il ? ------------------------------
  const uniques = [...new Set(campagnes)];
  const enBase = await prisma.pacCampaign.findMany({
    where: { farmId: farm.id, year: { in: uniques } },
    select: { year: true, _count: { select: { features: true, ilots: true } } },
    orderBy: { year: 'asc' },
  });
  attendu(
    enBase.length === uniques.length,
    'chaque campagne importée existe encore',
    enBase.map((c) => `${c.year}: ${c._count.features} entités`).join(', '),
  );
  for (const c of enBase) {
    attendu(c._count.features > 0, `la campagne ${c.year} a gardé ses entités`);
    attendu(c._count.ilots > 0, `la campagne ${c.year} a gardé ses îlots`);
  }

  // ---- Les SNA ponctuelles sont-elles entrées ? ---------------------------
  const points = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM pac_features f
    JOIN pac_campaigns c ON c.id = f.campaign_id
    WHERE c.farm_id = ${farm.id}
      AND f.kind = 'SNA'
      AND f.geom IS NOT NULL
      AND ST_GeometryType(f.geom) IN ('ST_Point', 'ST_MultiPoint')
  `;
  const nbPoints = Number(points[0]?.n ?? 0);
  attendu(
    nbPoints > 0,
    'les SNA ponctuelles sont stockées avec leur position',
    `${nbPoints} en base`,
  );

  // Et sans surface inventée : un point n'a pas d'aire.
  const airePoints = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM pac_features f
    JOIN pac_campaigns c ON c.id = f.campaign_id
    WHERE c.farm_id = ${farm.id}
      AND ST_GeometryType(f.geom) IN ('ST_Point', 'ST_MultiPoint')
      AND COALESCE(f.area_ha, 0) > 0
  `;
  attendu(
    Number(airePoints[0]?.n ?? 0) === 0,
    'aucune surface inventée pour un point',
    `${Number(airePoints[0]?.n ?? 0)} point(s) avec surface`,
  );

  // ---- Un second import de la même campagne détruit-il quelque chose ? ----
  const dernier = fichiers[fichiers.length - 1];
  if (dernier) {
    const avantRejeu = await etatAgronomique(farm.id);
    const entitesAvant = await prisma.pacFeature.count({
      where: { campaign: { farmId: farm.id, year: campagnes[campagnes.length - 1] } },
    });

    const parcellesAvantRejeu = await prisma.parcel.count({
      where: { farmId: farm.id, deletedAt: null },
    });

    console.info('\n▸ second import de la même campagne');
    const rejeu = await importer(dernier, farm.id);
    console.info(
      `  ${rejeu.resultat.created} créée(s), ${rejeu.resultat.updated} mise(s) à jour, ` +
        `${rejeu.resultat.ignored} ignorée(s)`,
    );

    const parcellesApresRejeu = await prisma.parcel.count({
      where: { farmId: farm.id, deletedAt: null },
    });
    attendu(
      parcellesApresRejeu === parcellesAvantRejeu,
      'le second import ne crée pas de parcelle en double',
      `${parcellesAvantRejeu} → ${parcellesApresRejeu}`,
    );

    const apresRejeu = await etatAgronomique(farm.id);
    attendu(
      apresRejeu.operations === avantRejeu.operations &&
        apresRejeu.phyto === avantRejeu.phyto &&
        apresRejeu.fertilisation === avantRejeu.fertilisation &&
        // La culture déclarée a déjà été rattachée au premier import : le
        // second ne doit pas en créer une seconde pour la même campagne.
        apresRejeu.cropYears.length === avantRejeu.cropYears.length,
      'un second import ne touche toujours pas aux données agronomiques',
      `${avantRejeu.cropYears.length} → ${apresRejeu.cropYears.length} cultures`,
    );

    const entitesApres = await prisma.pacFeature.count({
      where: { campaign: { farmId: farm.id, year: campagnes[campagnes.length - 1] } },
    });
    // Égalité stricte, et non « au moins autant ».
    //
    // La première version de ce contrôle acceptait `>=`. Elle passait au vert
    // sur un second import qui doublait toutes les entités — 769 devenaient
    // 1 538 — parce que « pas moins qu'avant » est vrai d'un doublon. Un
    // contrôle qui tolère le mode de panne qu'il est censé détecter ne sert à
    // rien.
    attendu(
      entitesApres === entitesAvant,
      'le second import ne duplique ni ne perd d’entité',
      `${entitesAvant} → ${entitesApres}`,
    );

    // Une sauvegarde est prise avant chaque import : c'est ce qui permet de
    // revenir en arrière si l'utilisateur s'est trompé de fichier.
    const sauvegardes = await prisma.pacSnapshot.count({
      where: { campaign: { farmId: farm.id } },
    });
    attendu(
      sauvegardes >= fichiers.length + 1,
      'une sauvegarde a été prise avant chaque import',
      `${sauvegardes} sauvegarde(s)`,
    );
  }

  // ---- Les données du dossier atteignent-elles la fiche parcelle ? -------
  //
  // Le dossier porte le code INSEE de la commune (sur l'îlot) et le code
  // culture (sur la parcelle). Ils restaient dans les attributs sans jamais
  // atteindre la parcelle : celle-ci arrivait sans commune et sans culture.
  const parcellesPac = await prisma.parcel.findMany({
    where: { farmId: farm.id, deletedAt: null, parcelType: 'PAC' },
    select: {
      id: true,
      inseeCode: true,
      commune: true,
      internalNumber: true,
      cropYears: { select: { campaignYear: true, crop: { select: { code: true } } } },
    },
  });

  console.info(`\n▸ ce que les parcelles importées ont reçu (${parcellesPac.length})`);

  const avecInsee = parcellesPac.filter((p) => p.inseeCode !== null);
  attendu(
    parcellesPac.length > 0 && avecInsee.length === parcellesPac.length,
    'chaque parcelle importée porte le code INSEE de sa commune',
    `${avecInsee.length}/${parcellesPac.length}`,
  );

  const avecNumero = parcellesPac.filter((p) => p.internalNumber !== null);
  attendu(
    avecNumero.length > 0,
    'le numéro îlot-parcelle de la déclaration est repris',
    `${avecNumero.length}/${parcellesPac.length}`,
  );

  const avecCulture = parcellesPac.filter((p) => p.cropYears.length > 0);
  attendu(
    avecCulture.length === parcellesPac.length,
    'chaque parcelle importée porte la culture déclarée',
    `${avecCulture.length}/${parcellesPac.length}`,
  );

  const codes = [
    ...new Set(parcellesPac.flatMap((p) => p.cropYears.map((c) => c.crop.code))),
  ].sort();
  console.info(`  codes culture rattachés : ${codes.join(', ') || '(aucun)'}`);

  // Le nom de la commune demande le réseau : son absence n'est pas un échec.
  const avecCommune = parcellesPac.filter((p) => p.commune !== null);
  console.info(
    `  commune nommée : ${avecCommune.length}/${parcellesPac.length}` +
      (avecCommune.length === 0
        ? ' (géocodeur injoignable — le code INSEE part seul, rien n’est inventé)'
        : ''),
  );

  // ---- Deux parcelles pour une seule déclaration ? -----------------------
  //
  // Le doublon que l'on cherche n'est pas « deux lignes identiques » : c'est
  // **deux parcelles Parcelys pour un même couple îlot/parcelle déclaré**.
  // C'est la forme qu'il avait pris sur le parcellaire réel — 140 parcelles
  // devenues 148 au réimport —, et le décompte global ne la voit pas dès que
  // le dossier suivant apporte de nouvelles parcelles.
  console.info('\n▸ doublons d’identité déclarée');

  const doublons = await prisma.$queryRaw<
    Array<{ numero: string; n: bigint; noms: string[] }>
  >`
    SELECT p.internal_number AS numero,
           count(*)::bigint  AS n,
           array_agg(p.name ORDER BY p.name) AS noms
    FROM parcels p
    WHERE p.farm_id = ${farm.id}
      AND p.deleted_at IS NULL
      AND p.internal_number IS NOT NULL
    GROUP BY p.internal_number
    HAVING count(*) > 1
  `;
  attendu(
    doublons.length === 0,
    'aucun couple îlot/parcelle porté par deux parcelles',
    doublons.length === 0
      ? `${parcellesPac.length} parcelles PAC contrôlées`
      : doublons.map((d) => `${d.numero} → ${d.noms.join(' / ')}`).join(' ; '),
  );

  // Et le même contrôle côté entités PAC : une campagne ne doit pas porter
  // deux fois la même parcelle déclarée.
  const entitesDoubles = await prisma.$queryRaw<
    Array<{ annee: number; ilot: string; numero: string; n: bigint }>
  >`
    SELECT c.year AS annee, i.numero AS ilot, f.numero, count(*)::bigint AS n
    FROM pac_features f
    JOIN pac_campaigns c ON c.id = f.campaign_id
    LEFT JOIN pac_ilots i ON i.id = f.ilot_id
    WHERE c.farm_id = ${farm.id} AND f.kind = 'PARCELLE' AND f.numero IS NOT NULL
    GROUP BY c.year, i.numero, f.numero
    HAVING count(*) > 1
  `;
  attendu(
    entitesDoubles.length === 0,
    'aucune parcelle déclarée présente deux fois dans une même campagne',
    entitesDoubles.length === 0
      ? ''
      : entitesDoubles
          .map((d) => `${d.annee} îlot ${d.ilot} parcelle ${d.numero} ×${d.n}`)
          .join(' ; '),
  );

  // ---- Les hectares sont-ils fiables ? -----------------------------------
  //
  // Trois valeurs cohabitent, et il faut les distinguer :
  //
  //   · `parcels.area_ha` — colonne dénormalisée, affichée partout ;
  //   · `ST_Area(geom::geography)` — la mesure PostGIS, qui fait foi ;
  //   · `surface-admissible` du dossier — ce que la déclaration porte.
  //
  // Les deux premières doivent être **identiques** : l'une est la copie de
  // l'autre, un écart signale une écriture qui a manqué sa mise à jour.
  //
  // La troisième, non. Sur le dossier réel examiné, neuf parcelles sur 113
  // portent une surface admissible supérieure à leur propre géométrie — jusqu'à
  // 1,08 ha — alors qu'au niveau de l'îlot les deux totaux se rejoignent. La
  // cause n'a pas pu être vérifiée faute de notice ; elle n'est donc écrite
  // nulle part comme un fait, et un écart parcelle à parcelle n'est pas traité
  // ici comme une anomalie. Ce qui est contrôlé, c'est le **total**.
  console.info('\n▸ fiabilité des hectares');

  const surfaces = await prisma.$queryRaw<
    Array<{ nom: string; colonne: number; mesure: number }>
  >`
    SELECT p.name AS nom,
           p.area_ha::float8 AS colonne,
           (ST_Area(pg.geom::geography) / 10000.0)::float8 AS mesure
    FROM parcels p
    JOIN parcel_geometries pg ON pg.parcel_id = p.id AND pg.is_current = true
    WHERE p.farm_id = ${farm.id} AND p.deleted_at IS NULL
  `;

  // Un mètre carré : c'est la précision de la colonne (quatre décimales d'ha).
  const desaccords = surfaces.filter((s) => Math.abs(s.colonne - s.mesure) >= 0.0001);
  attendu(
    desaccords.length === 0,
    'la surface affichée est exactement celle que mesure PostGIS',
    desaccords.length === 0
      ? `${surfaces.length} parcelles, écart maximal ${(
          surfaces.reduce((m, s) => Math.max(m, Math.abs(s.colonne - s.mesure)), 0) * 10000
        ).toFixed(2)} m²`
      : desaccords
          .slice(0, 5)
          .map((s) => `${s.nom} : ${s.colonne.toFixed(4)} ≠ ${s.mesure.toFixed(4)}`)
          .join(' ; '),
  );

  const totaux = await prisma.$queryRaw<
    Array<{ annee: number; declaree: number | null; mesuree: number | null; n: bigint }>
  >`
    SELECT c.year AS annee,
           SUM(f.area_ha)::float8 AS declaree,
           SUM(ST_Area(f.geom::geography) / 10000.0)::float8 AS mesuree,
           count(*)::bigint AS n
    FROM pac_features f
    JOIN pac_campaigns c ON c.id = f.campaign_id
    WHERE c.farm_id = ${farm.id} AND f.kind = 'PARCELLE' AND f.geom IS NOT NULL
    GROUP BY c.year
    ORDER BY c.year
  `;

  for (const total of totaux) {
    const declaree = total.declaree ?? 0;
    const mesuree = total.mesuree ?? 0;
    if (declaree === 0) {
      console.info(`  campagne ${total.annee} : aucune surface déclarée dans le dossier`);
      continue;
    }
    const ecart = Math.abs(declaree - mesuree) / declaree;
    attendu(
      ecart < 0.02,
      `campagne ${total.annee} : le total déclaré et le total mesuré concordent`,
      `${declaree.toFixed(2)} ha déclarés contre ${mesuree.toFixed(2)} ha mesurés ` +
        `sur ${total.n} parcelles (${(ecart * 100).toFixed(2)} %)`,
    );
  }

  // ---- Chaque campagne est-elle indépendante ? ---------------------------
  //
  // Ce que l'on vérifie ici ne peut se voir que sur plusieurs campagnes
  // réelles : la rotation. Deux campagnes voisines ne portent pas les mêmes
  // cultures sur les mêmes parcelles ; si elles le faisaient toutes, c'est
  // qu'un import aurait recouvert les autres.
  console.info('\n▸ indépendance des campagnes');

  const parCampagne = await prisma.$queryRaw<
    Array<{ annee: number; parcelles: bigint; cultures: bigint }>
  >`
    SELECT cy.campaign_year AS annee,
           count(DISTINCT cy.parcel_id)::bigint AS parcelles,
           count(DISTINCT cy.crop_id)::bigint   AS cultures
    FROM crop_years cy
    JOIN parcels p ON p.id = cy.parcel_id
    WHERE p.farm_id = ${farm.id} AND p.deleted_at IS NULL
    GROUP BY cy.campaign_year
    ORDER BY cy.campaign_year
  `;
  for (const ligne of parCampagne) {
    console.info(
      `  campagne ${ligne.annee} : ${ligne.parcelles} parcelles, ` +
        `${ligne.cultures} cultures distinctes`,
    );
  }
  attendu(
    parCampagne.length >= uniques.length,
    'chaque campagne importée porte ses propres cultures',
    `${parCampagne.length} campagne(s) renseignée(s)`,
  );

  // Une parcelle qui change de culture d'une campagne à l'autre : la preuve
  // que les campagnes ne se recopient pas l'une sur l'autre.
  const rotations = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*)::bigint AS n FROM (
      SELECT cy.parcel_id
      FROM crop_years cy
      JOIN parcels p ON p.id = cy.parcel_id
      WHERE p.farm_id = ${farm.id} AND p.deleted_at IS NULL
      GROUP BY cy.parcel_id
      HAVING count(DISTINCT cy.campaign_year) > 1
         AND count(DISTINCT cy.crop_id) > 1
    ) t
  `;
  const enRotation = Number(rotations[0]?.n ?? 0);
  if (uniques.length > 1) {
    attendu(
      enRotation > 0,
      'des parcelles portent des cultures différentes selon la campagne',
      `${enRotation} parcelle(s) en rotation`,
    );
  }

  console.info(`\n${echecs === 0 ? '✓' : '✗'} import PAC : ${echecs} échec(s).`);
  await prisma.$disconnect();
}

main().catch(async (cause) => {
  console.error(cause);
  await prisma.$disconnect();
  process.exit(1);
});
