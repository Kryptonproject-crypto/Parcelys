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
    prisma.cropYear.count({ where: { parcel: { farmId } } }),
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
      `${avant.phyto} traitements, ${avant.fertilisation} apports, ${avant.cropYears} cultures.`,
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
  attendu(
    apres.cropYears === avant.cropYears,
    'les cultures déjà saisies sont intactes',
    `${avant.cropYears} → ${apres.cropYears}`,
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

    console.info('\n▸ second import de la même campagne');
    await importer(dernier, farm.id);

    const apresRejeu = await etatAgronomique(farm.id);
    attendu(
      apresRejeu.operations === avantRejeu.operations &&
        apresRejeu.phyto === avantRejeu.phyto &&
        apresRejeu.fertilisation === avantRejeu.fertilisation,
      'un second import ne touche toujours pas aux données agronomiques',
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

  console.info(`\n${echecs === 0 ? '✓' : '✗'} import PAC : ${echecs} échec(s).`);
  await prisma.$disconnect();
}

main().catch(async (cause) => {
  console.error(cause);
  await prisma.$disconnect();
  process.exit(1);
});
