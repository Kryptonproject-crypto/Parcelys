/**
 * Import des référentiels réglementaires d'Auvergne-Rhône-Alpes.
 *
 *   npm run referentiels:aura                         # tout, dans l'ordre
 *   npm run referentiels:aura -- --seulement cours-eau,captages
 *   npm run referentiels:aura -- --sans ephy
 *   npm run referentiels:aura -- --dossier ./data/referentiels-aura
 *
 * Les fichiers source sont ceux du dépôt, dans `data/referentiels-aura/`.
 * `docs/referentiels-aura.md` dit ce que chacun contient, et ce qui manque.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE SCRIPT S'INTERDIT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il ne suppose aucune version. Chaque millésime est lu **dans la source** :
 * métadonnées ISO des zones vulnérables, horodatage interne des GeoPackage,
 * date des entrées d'archive, nom de fichier du catalogue E-Phy, colonne de
 * campagne de l'IFT. Quand une source ne dit rien, l'import s'arrête plutôt
 * que d'inventer une date.
 *
 * Il ne découpe rien. Les jeux nationaux sont filtrés sur la région par
 * intersection, et les entités qui franchissent la limite régionale sont
 * gardées entières.
 *
 * Il ne traduit aucun code qu'aucun fichier fourni ne documente — les usages
 * des ouvrages de prélèvement restent des codes.
 */

// En premier : c'est lui qui charge `.env` pour un script hors de Next.
import './load-env';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Open } from 'unzipper';
import { prisma } from '@/lib/prisma';
import {
  cloreImport,
  echouerImport,
  ouvrirImport,
  verserTable,
  type SessionDImport,
} from '@/lib/regulatory/import-staging';
import { recomputeFarmContexts } from '@/lib/regulatory/geography';
import {
  beginImport,
  enregistrerIntegration,
  finishImport,
  type FichierVerifie,
  type Integration,
} from '@/lib/regulatory/referentials';
import { chargerCouche, connexionGdal, lireValeur, verifierGdal } from './lib/ogr';
import { importerReglesAura } from './lib/regles-aura';

const ETAPES = [
  'ephy',
  'ift',
  'limites',
  'zones-vulnerables',
  'aires-alimentation-captage',
  'cours-eau',
  'captages',
  'regles',
  'contextes',
] as const;
type Etape = (typeof ETAPES)[number];

/** Emprise de la région, en WGS 84 : préfiltre des jeux nationaux. */
const EMPRISE_AURA: [number, number, number, number] = [2.06, 44.11, 7.19, 46.81];

/** Table intermédiaire portant le contour régional. */
const TABLE_REGION = 'stg_region_aura';

// ---------------------------------------------------------------------------

function args(): { dossier: string; etapes: Etape[] } {
  const argv = process.argv.slice(2);
  const valeur = (nom: string): string | null => {
    const i = argv.indexOf(`--${nom}`);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const liste = (nom: string): string[] =>
    (valeur(nom) ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

  const seulement = liste('seulement');
  const sans = new Set(liste('sans'));
  for (const e of [...seulement, ...sans]) {
    if (!ETAPES.includes(e as Etape)) {
      throw new Error(`Étape inconnue : « ${e} ». Connues : ${ETAPES.join(', ')}`);
    }
  }

  let etapes = (seulement.length ? seulement : [...ETAPES]) as Etape[];
  etapes = etapes.filter((e) => !sans.has(e));
  // Les étapes géographiques nationales ont besoin du contour régional.
  if (
    etapes.some((e) => e === 'aires-alimentation-captage' || e === 'captages') &&
    !etapes.includes('limites')
  ) {
    etapes.unshift('limites');
  }

  return {
    dossier: path.resolve(valeur('dossier') ?? 'data/referentiels-aura'),
    etapes: ETAPES.filter((e) => etapes.includes(e)),
  };
}

function titre(texte: string): void {
  console.info(`\n▸ ${texte}`);
}

function npm(script: string, ...params: string[]): void {
  const r = spawnSync('npm', ['run', '--silent', script, '--', ...params], {
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error(`« npm run ${script} » a échoué.`);
}

/** Entrées d'une archive ZIP, avec leur date. */
async function entrees(zip: string) {
  const archive = await Open.file(zip);
  return archive.files.map((f) => ({
    chemin: f.path,
    date: f.lastModifiedDateTime,
    lire: () => f.buffer(),
  }));
}

/** Date AAAA-MM-JJ, ou erreur : une version ne se devine pas. */
function jour(brut: string | Date | null | undefined, quoi: string): string {
  const d = brut instanceof Date ? brut : brut ? new Date(brut.replace(/\//g, '-')) : null;
  if (!d || Number.isNaN(d.getTime())) {
    throw new Error(`Impossible de lire la date de ${quoi} dans la source : import arrêté.`);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Empreinte et taille d'un fichier source, lues en flux : les archives de
 * BD TOPAGE pèsent plusieurs dizaines de mégaoctets, et le Raspberry Pi n'a
 * pas à les tenir en mémoire pour les hacher.
 */
async function fichierVerifie(dossier: string, chemin: string): Promise<FichierVerifie> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(chemin)
      .on('data', (morceau) => hash.update(morceau))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return {
    chemin: path.relative(dossier, chemin),
    sha256: hash.digest('hex'),
    octets: statSync(chemin).size,
  };
}

/** Nombre d'entités versées, par nature, pour une version de référentiel. */
async function elementsVerses(referentialId: string, libelles: Record<string, string>) {
  const lignes = await prisma.$queryRaw<Array<{ kind: string; n: number }>>`
    SELECT kind::text AS kind, COUNT(*)::int AS n FROM regulatory_zones
    WHERE referential_id = ${referentialId} GROUP BY 1 ORDER BY 1
  `;
  return lignes.map((l) => ({ quoi: libelles[l.kind] ?? l.kind, nombre: l.n }));
}

/** Exécute une étape d'import géographique, et marque l'échec s'il survient. */
async function avecSession(
  ouverture: Parameters<typeof ouvrirImport>[0],
  corps: (
    session: SessionDImport,
  ) => Promise<{ notes?: string[]; integration?: Integration } | void>,
): Promise<void> {
  const session = await ouvrirImport(ouverture);
  try {
    const resultat = await corps(session);
    await cloreImport(session, { notes: resultat?.notes ?? [] });
    if (resultat?.integration) {
      await enregistrerIntegration(session.referentialId, resultat.integration);
    }
    console.info(
      `  ✓ ${ouverture.code} v${ouverture.version} : ${session.versees.toLocaleString('fr-FR')} entité(s)` +
        (session.ecartees ? `, ${session.ecartees} écartée(s)` : ''),
    );
    for (const avertissement of session.avertissements) console.info(`    ⚠ ${avertissement}`);
  } catch (erreur) {
    await echouerImport(session, erreur);
    throw erreur;
  }
}

// ---------------------------------------------------------------------------
// E-Phy et IFT : les importeurs existants, avec les fichiers fournis.
// ---------------------------------------------------------------------------

async function etapeEphy(dossier: string): Promise<void> {
  titre('Catalogue E-Phy');
  // Deux millésimes ont été fournis, à la racine et dans 01_EPHY. Le plus
  // récent fait foi ; on dit lesquels sont écartés.
  const candidats: Array<{ chemin: string; date: string }> = [];
  for (const sous of ['', '01_EPHY']) {
    const ici = path.join(dossier, sous);
    if (!existsSync(ici)) continue;
    for (const nom of await readdir(ici)) {
      const m = nom.match(/^decisionamm-intrant-format-csv-(\d{8})-utf8\.zip$/);
      if (m?.[1]) candidats.push({ chemin: path.join(ici, nom), date: m[1] });
    }
  }
  if (candidats.length === 0) throw new Error('Aucune archive E-Phy dans le dossier.');
  candidats.sort((a, b) => b.date.localeCompare(a.date));
  const [retenu, ...ecartes] = candidats;
  console.info(`  retenu  : ${path.relative(dossier, retenu!.chemin)} (${retenu!.date})`);
  for (const e of ecartes) {
    console.info(`  écarté  : ${path.relative(dossier, e.chemin)} (${e.date}) — millésime antérieur`);
  }
  npm('ephy:sync', '--zip', retenu!.chemin);
  await integrerEphy(dossier, retenu!, ecartes);
}

/**
 * Le catalogue E-Phy comme référentiel : sa version est la date de l'archive
 * (dans son nom), et ce qu'il contient est compté en base après la
 * synchronisation — pas recopié du journal.
 */
async function integrerEphy(
  dossier: string,
  retenu: { chemin: string; date: string },
  ecartes: Array<{ chemin: string; date: string }>,
): Promise<void> {
  const run = await prisma.ephySyncRun.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { startedAt: 'desc' },
  });
  if (!run) throw new Error('La synchronisation E-Phy n’a laissé aucun résultat enregistré.');
  const millesime = `${retenu.date.slice(0, 4)}-${retenu.date.slice(4, 6)}-${retenu.date.slice(6, 8)}`;
  const fichier = await fichierVerifie(dossier, retenu.chemin);
  const [produits, autorises, substances, usages, avecZnt, avecDar, conditions] = await Promise.all([
    prisma.phytosanitaryProduct.count(),
    prisma.phytosanitaryProduct.count({ where: { withdrawnAt: null } }),
    prisma.activeSubstance.count(),
    prisma.phytoUsage.count(),
    prisma.phytoUsage.count({ where: { zntAquaticM: { not: null } } }),
    prisma.phytoUsage.count({ where: { preHarvestDelay: { not: null } } }),
    prisma.phytoCondition.count(),
  ]);
  const { referentiel, journal } = await beginImport({
    code: 'ephy',
    domain: 'PHYTO',
    name: 'Catalogue des produits phytopharmaceutiques (E-Phy)',
    territory: 'FR',
    version: millesime,
    sourceLabel: `ANSES — catalogue E-Phy des produits phytopharmaceutiques (décisions d’AMM, données ouvertes), archive ${path.basename(retenu.chemin)}`,
    sourceUrl: run.sourceUrl,
  });
  const avertissements = (run.errorMessage ?? '').split(' | ').filter(Boolean);
  await finishImport({
    referentialId: referentiel.id,
    importId: journal.id,
    recordCount: produits,
    warnings: [
      ...ecartes.map((e) => `Archive ${path.relative(dossier, e.chemin)} (${e.date}) écartée : millésime antérieur.`),
      ...avertissements,
    ],
  });
  await enregistrerIntegration(referentiel.id, {
    etat: avertissements.length === 0 ? 'complet' : 'partiel',
    millesime,
    fichiers: [fichier],
    elements: [
      { quoi: 'produits (toutes décisions)', nombre: produits },
      { quoi: 'produits sans date de retrait', nombre: autorises },
      { quoi: 'substances actives', nombre: substances },
      { quoi: 'usages (culture, cible, dose)', nombre: usages },
      { quoi: 'usages avec ZNT aquatique', nombre: avecZnt },
      { quoi: 'usages avec délai avant récolte', nombre: avecDar },
      { quoi: 'conditions d’emploi', nombre: conditions },
    ],
    manques: [
      ...avertissements.map((a) => ({ quoi: 'Avertissement de la synchronisation', pourquoi: a, consequence: 'Voir le journal des imports.' })),
      {
        quoi: 'Points d’eau à prendre en compte pour les ZNT (arrêtés préfectoraux)',
        pourquoi: 'La cartographie départementale des points d’eau n’est pas fournie.',
        consequence:
          'La ZNT d’un usage est connue, mais aucun écoulement n’est désigné comme « point d’eau » : les distances au réseau hydrographique sont affichées, jamais converties en ZNT.',
      },
    ],
  });
  console.info(`  ✓ ephy v${millesime} : ${produits.toLocaleString('fr-FR')} produit(s), ${usages.toLocaleString('fr-FR')} usage(s)`);
}

async function etapeIft(dossier: string): Promise<void> {
  titre('Doses de référence IFT');
  const ici = path.join(dossier, '02_IFT');
  const campagnes = [
    ...new Set(
      (await readdir(ici))
        .map((nom) => nom.match(/^DosesReference(\d{4})-GCU\d+\.csv$/i)?.[1])
        .filter((c): c is string => Boolean(c)),
    ),
  ].sort();
  if (campagnes.length === 0) throw new Error('Aucun fichier DosesReference<AAAA>-GCU<n>.csv.');
  // Une campagne à la fois : chacune est vérifiée ligne à ligne.
  for (const campagne of campagnes) {
    npm('referentiels', 'importer-ift', '--dossier', ici, '--campagne', campagne);
  }

  // Ce que chaque campagne contient, et ce qui lui manque. Les fichiers sont
  // publiés par groupe de cultures (GCU1, GCU2…) : une campagne qui n'a pas
  // les mêmes groupes que la plus complète n'a pas les doses de ces cultures.
  const groupes = new Map<string, string[]>();
  for (const nom of await readdir(ici)) {
    const m = nom.match(/^DosesReference(\d{4})-(GCU\d+)\.csv$/i);
    if (m?.[1] && m[2]) groupes.set(m[1], [...(groupes.get(m[1]) ?? []), m[2].toUpperCase()].sort());
  }
  const tous = [...new Set([...groupes.values()].flat())].sort();
  for (const campagne of campagnes) {
    const referentiel = await prisma.regulatoryReferential.findFirst({
      where: { code: 'ift-doses-reference', version: campagne, status: 'ACTIF' },
      select: { id: true, recordCount: true },
    });
    if (!referentiel) throw new Error(`Campagne IFT ${campagne} introuvable après import.`);
    const presents = groupes.get(campagne) ?? [];
    const absents = tous.filter((g) => !presents.includes(g));
    const fichiers: FichierVerifie[] = [];
    for (const g of presents) fichiers.push(await fichierVerifie(dossier, path.join(ici, `DosesReference${campagne}-${g}.csv`)));
    const comptage = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT crop_normalized)::int AS n FROM ift_references WHERE referential_id = ${referentiel.id}
    `;
    const cultures = comptage[0]?.n ?? 0;
    await enregistrerIntegration(referentiel.id, {
      etat: absents.length === 0 ? 'complet' : 'partiel',
      millesime: campagne,
      fichiers,
      elements: [
        { quoi: 'doses de référence', nombre: referentiel.recordCount },
        { quoi: 'cultures', nombre: cultures },
        { quoi: 'groupes de cultures fournis', nombre: presents.length },
      ],
      manques: absents.length
        ? [
            {
              quoi: `Groupes de cultures ${absents.join(', ')} de la campagne ${campagne}`,
              pourquoi: `Seuls ${presents.join(', ')} ont été fournis pour ${campagne} (${tous.join(', ')} pour la campagne la plus complète).`,
              consequence: `L’IFT ${campagne} des cultures de ces groupes n’est pas calculé : le traitement est signalé comme non pris en compte.`,
            },
          ]
        : [],
    });
    console.info(`  ✓ IFT ${campagne} : intégration enregistrée (${presents.join(', ')})`);
  }
}

// ---------------------------------------------------------------------------
// Contour régional
// ---------------------------------------------------------------------------

async function etapeLimites(dossier: string, gdal: ReturnType<typeof connexionGdal>) {
  titre('Contour régional');
  const source = path.join(dossier, '00_LIMITES', 'region_aura.geojson');
  chargerCouche(gdal, { source, table: TABLE_REGION });
  const [{ n }] = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "${TABLE_REGION}"`,
  )) as [{ n: number }];
  if (n !== 1) throw new Error(`Le contour régional devrait compter une entité, il en compte ${n}.`);

  // Le fichier ne porte ni date ni producteur : sa version est son empreinte.
  // On ne lui prête pas de millésime qu'il ne déclare pas.
  const fichier = await fichierVerifie(dossier, source);
  await avecSession(
    {
      code: 'limites-administratives',
      name: 'Limites administratives (région)',
      territory: '84',
      version: `contour-${fichier.sha256.slice(0, 12)}`,
      sourceLabel: 'Contour de la région Auvergne-Rhône-Alpes fourni avec les référentiels (00_LIMITES, sans métadonnées)',
    },
    async (session) => {
      await verserTable(session, {
        table: TABLE_REGION,
        kind: 'REGION_ADMINISTRATIVE',
        champCode: 'code',
        champLibelle: 'nom',
        libelleParDefaut: 'Région',
      });
      return {
        notes: [
          'Le fichier ne déclare ni producteur, ni date, ni millésime : la version est son empreinte SHA-256.',
          'Le contour comporte une enclave (anneau intérieur), conservée telle quelle.',
        ],
        integration: {
          etat: 'partiel',
          millesime: null,
          fichiers: [fichier],
          elements: [{ quoi: 'contour régional (code INSEE 84)', nombre: session.versees }],
          manques: [
            {
              quoi: 'Millésime et producteur du contour',
              pourquoi: 'Le fichier GeoJSON fourni ne porte aucune métadonnée.',
              consequence: 'La version affichée est l’empreinte du fichier, pas une date de découpage administratif.',
            },
          ],
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Zones vulnérables
// ---------------------------------------------------------------------------

/**
 * Arrêtés de délimitation, par bassin.
 *
 * Transcrits du résumé des métadonnées ISO du jeu de la DREAL — et **vérifiés
 * à chaque import** : si une édition future ne cite plus ces textes, l'import
 * s'arrête au lieu de rattacher aux communes des références périmées.
 *
 * La date retenue est celle de l'arrêté. La source ne publie pas de date
 * d'entrée en vigueur distincte ; c'est dit dans les notes du référentiel.
 */
const ARRETES_ZV: Record<string, { reference: string; date: string; temoin: string }> = {
  rm: {
    reference:
      'Arrêté n° 21-323 du 23 juillet 2021 du préfet coordonnateur du bassin Rhône-Méditerranée',
    date: '2021-07-23',
    temoin: '21-323 du 23 juillet 2021',
  },
  lb: {
    reference: 'Arrêté du 30 août 2021 du préfet coordonnateur du bassin Loire-Bretagne',
    date: '2021-08-30',
    temoin: '30 août 2021',
  },
};
const DECISION_TA = {
  reference: 'Décisions du tribunal administratif du 6 juin 2024',
  date: '2024-06-06',
  temoin: 'tribunal administratif du 6 juin 2024',
};

/** Nom des bassins tels que BD TOPAGE les écrit, pour le code employé par la DREAL. */
const BASSINS_ZV: Record<string, string> = {
  rm: 'Rhône-Méditerranée',
  lb: 'Loire-Bretagne',
  ag: 'Adour-Garonne',
};

async function etapeZonesVulnerables(dossier: string, gdal: ReturnType<typeof connexionGdal>) {
  titre('Zones vulnérables aux nitrates');
  const ici = path.join(dossier, '03_ZONES_VULNERABLES');
  const zip = (await readdir(ici)).find((n) => n.endsWith('.zip'));
  if (!zip) throw new Error('Archive des zones vulnérables introuvable.');
  const archive = path.join(ici, zip);
  const contenu = await entrees(archive);

  const json = contenu.find((e) => /\/data\/.+\.json$/i.test(e.chemin));
  const xml = contenu.find((e) => /\/metadata\/[^/]+\.xml$/i.test(e.chemin));
  if (!json || !xml) throw new Error('Archive incomplète : données ou métadonnées absentes.');

  const metadonnees = (await xml.lire()).toString('utf8');
  const revision = metadonnees.match(
    /<gco:DateTime>([^<]+)<\/gco:DateTime>\s*<\/gmd:date>\s*<gmd:dateType>\s*<gmd:CI_DateTypeCode[^>]*codeListValue="revision"/,
  )?.[1];
  const intitule = metadonnees.match(
    /<gmd:title>\s*<gco:CharacterString>([^<]+)<\/gco:CharacterString>/,
  )?.[1];
  const millesime = intitule?.match(/\b(20\d{2})\b/)?.[1];
  if (!millesime) throw new Error('Millésime introuvable dans le titre des métadonnées.');
  for (const t of [...Object.values(ARRETES_ZV), DECISION_TA]) {
    if (!metadonnees.includes(t.temoin)) {
      throw new Error(
        `Les métadonnées ne citent plus « ${t.temoin} ». L'édition a changé : ` +
          'relisez-la avant de rattacher les communes à leurs arrêtés.',
      );
    }
  }
  const version = `${millesime}-maj-${jour(revision, 'la révision des zones vulnérables')}`;

  chargerCouche(gdal, { source: `/vsizip/${archive}/${json.chemin}`, table: 'stg_zv' });

  await avecSession(
    {
      code: 'zones-vulnerables',
      name: 'Zones vulnérables aux nitrates',
      territory: '84',
      version,
      sourceLabel: 'DREAL Auvergne-Rhône-Alpes — zones vulnérables aux nitrates',
      appliesFrom: new Date(`${ARRETES_ZV.rm!.date}T00:00:00Z`),
    },
    async (session) => {
      await verserTable(session, {
        table: 'stg_zv',
        kind: 'ZONE_VULNERABLE',
        champCode: 'insee_com',
        champLibelle: 'nom_com',
        libelleParDefaut: 'Commune classée en zone vulnérable',
      });

      // Arrêté de délimitation et historique du classement, commune par
      // commune : c'est ce que le moteur lit pour juger à une date.
      for (const [bassin, arrete] of Object.entries(ARRETES_ZV)) {
        await prisma.$executeRaw`
          UPDATE regulatory_zones
          SET attributes = attributes || jsonb_build_object(
            'arrete', ${arrete.reference}::text,
            'bassin_nom', ${BASSINS_ZV[bassin] ?? bassin}::text,
            'classements',
              jsonb_build_array(
                jsonb_build_object('depuis', ${arrete.date}::text,
                                   'valeur', attributes->>'classement',
                                   'source', ${arrete.reference}::text)
              )
              || CASE WHEN attributes ? 'modif2024'
                   THEN jsonb_build_array(
                          jsonb_build_object('depuis', ${DECISION_TA.date}::text,
                                             'valeur', attributes->>'modif2024',
                                             'source', ${DECISION_TA.reference}::text))
                   ELSE '[]'::jsonb END
          )
          WHERE referential_id = ${session.referentialId}
            AND attributes->>'bassin' = ${bassin}
        `;
      }

      const sansArrete = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM regulatory_zones
        WHERE referential_id = ${session.referentialId} AND NOT (attributes ? 'arrete')
      `;
      if ((sansArrete[0]?.n ?? 0) > 0) {
        throw new Error(
          `${sansArrete[0]?.n} commune(s) relèvent d'un bassin sans arrêté connu dans les métadonnées.`,
        );
      }

      const bassins = await prisma.$queryRaw<Array<{ bassin: string; n: number }>>`
        SELECT attributes->>'bassin' AS bassin, COUNT(*)::int AS n FROM regulatory_zones
        WHERE referential_id = ${session.referentialId} GROUP BY 1 ORDER BY 1
      `;
      const partielles = await prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM regulatory_zones
        WHERE referential_id = ${session.referentialId}
          AND (attributes->>'classement' ILIKE '%quelques%' OR attributes->>'modif2024' ILIKE '%quelques%')
      `;
      const couverts = new Set(bassins.map((b) => b.bassin));
      const absents = Object.entries(BASSINS_ZV).filter(([code]) => !couverts.has(code));
      return {
        integration: {
          etat: 'partiel',
          millesime,
          fichiers: [await fichierVerifie(dossier, archive)],
          elements: [
            ...bassins.map((b) => ({
              quoi: `communes classées — bassin ${BASSINS_ZV[b.bassin] ?? b.bassin}`,
              nombre: b.n,
            })),
            { quoi: 'communes classées « quelques sections » (appartenance indéterminée)', nombre: partielles[0]?.n ?? 0 },
          ],
          manques: [
            ...absents.map(([, nom]) => ({
              quoi: `Zones vulnérables du bassin ${nom}`,
              pourquoi: `Le fichier de la DREAL ne contient aucune commune du bassin ${nom}, dont l’arrêté de délimitation est pourtant cité par le PAR7.`,
              consequence: `Le classement d’une parcelle située dans le bassin ${nom} reste indéterminé ; il n’est jamais déduit des autres bassins.`,
            })),
            {
              quoi: 'Sections cadastrales des communes classées « quelques sections »',
              pourquoi: 'Le zonage est publié à la commune ; les sections visées par les arrêtés ne sont pas fournies.',
              consequence: 'Une parcelle de ces communes est « indéterminée » pour la zone vulnérable.',
            },
            {
              quoi: 'Date d’entrée en vigueur distincte de la date des arrêtés',
              pourquoi: 'Les métadonnées ne la publient pas.',
              consequence: 'La date de chaque arrêté de délimitation sert de date d’effet.',
            },
          ],
        },
        notes: [
          `Bassins couverts : ${bassins.map((b) => `${BASSINS_ZV[b.bassin] ?? b.bassin} (${b.n} communes)`).join(', ')}.`,
          `${ARRETES_ZV.rm!.reference} ; ${ARRETES_ZV.lb!.reference}.`,
          `${DECISION_TA.reference} : classements modifiés pris en compte à cette date.`,
          'Zonage établi à la commune (1:50 000) : une commune classée « quelques sections » laisse l’appartenance indéterminée.',
          'Dates d’effet : celles des arrêtés ; la source ne publie pas de date d’entrée en vigueur distincte.',
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Aires d'alimentation de captage
// ---------------------------------------------------------------------------

async function etapeAac(dossier: string, gdal: ReturnType<typeof connexionGdal>) {
  titre('Aires d’alimentation de captage');
  const ici = path.join(dossier, '07_AAC');
  const notes: string[] = [];

  // Deux archives ont été fournies ; l'une est tronquée. On le constate, on ne
  // tente pas d'en tirer une partie.
  let source: string | null = null;
  for (const nom of (await readdir(ici)).filter((n) => n.endsWith('.zip')).sort()) {
    const chemin = `/vsizip/${path.join(ici, nom)}`;
    const date = lireValeur(chemin, 'SELECT last_change FROM gpkg_contents', 'last_change');
    if (!date) {
      console.info(`  écarté  : ${nom} — archive illisible (tronquée ?), rien n’en est tiré`);
      notes.push(`${nom} : archive illisible, écartée.`);
      continue;
    }
    if (nom.includes('FRA')) source = chemin;
    else source ??= chemin;
  }
  if (!source) throw new Error('Aucune archive d’AAC lisible.');

  const version = jour(
    lireValeur(source, 'SELECT last_change FROM gpkg_contents', 'last_change'),
    'la dernière modification du GeoPackage des AAC',
  );
  chargerCouche(gdal, { source, table: 'stg_aac', emprise: EMPRISE_AURA });

  await avecSession(
    {
      code: 'aires-alimentation-captage',
      name: 'Aires d’alimentation de captage',
      territory: '84',
      version,
      sourceLabel: 'Agences de l’eau — référentiel national des aires d’alimentation de captage',
    },
    async (session) => {
      await verserTable(session, {
        table: 'stg_aac',
        kind: 'AIRE_ALIMENTATION_CAPTAGE',
        champCode: 'CdAAC',
        champLibelle: 'NomDeAACAdministratif',
        libelleParDefaut: 'Aire d’alimentation de captage',
        filtreTable: TABLE_REGION,
      });
      const arretes = await prisma.$queryRaw<Array<{ arrete: string | null; n: number }>>`
        SELECT attributes->>'ArreteDelimitationAAC' AS arrete, COUNT(*)::int AS n
        FROM regulatory_zones WHERE referential_id = ${session.referentialId} GROUP BY 1
      `;
      const archives = (await readdir(ici)).filter((n) => n.endsWith('.zip')).sort();
      return {
        integration: {
          etat: 'partiel',
          millesime: version.slice(0, 4),
          fichiers: await Promise.all(archives.map((n) => fichierVerifie(dossier, path.join(ici, n)))),
          elements: [{ quoi: 'aires d’alimentation de captage recoupant la région', nombre: session.versees }],
          manques: [
            ...notes.map((note) => ({
              quoi: note.split(' :')[0] ?? note,
              pourquoi: 'Archive illisible (tronquée).',
              consequence: 'Rien n’en est tiré ; le référentiel national AAC_FRA est employé.',
            })),
            {
              quoi: 'Arrêtés de délimitation des AAC',
              pourquoi: `Attribut ArreteDelimitationAAC : ${arretes.map((a) => `${a.arrete ?? 'non renseigné'} pour ${a.n}`).join(', ')}.`,
              consequence: 'Une AAC sans arrêté de délimitation n’est pas opposable telle quelle : elle situe, elle ne contraint pas.',
            },
            {
              quoi: 'Zones de protection des AAC',
              pourquoi: 'Aucune zone de protection d’AAC n’est fournie.',
              consequence: 'La nature « zone de protection d’AAC » reste vide.',
            },
          ],
        },
        notes: [
          ...notes,
          `Arrêté de délimitation : ${arretes.map((a) => `${a.arrete ?? 'non renseigné'} pour ${a.n}`).join(', ')}.`,
          'Sans arrêté de délimitation, le périmètre d’une AAC n’est pas opposable tel quel.',
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// BD TOPAGE
// ---------------------------------------------------------------------------

/**
 * Attributs repris des tronçons.
 *
 * 402 215 lignes : recopier les 36 colonnes doublerait le volume en base sur un
 * Raspberry Pi pour des champs techniques (méthodes d'acquisition, codes pays,
 * nœuds amont et aval) qu'aucun contrôle n'emploie. La source complète reste
 * dans `data/` ; rien n'est perdu.
 */
const COLONNES_TRONCONS = [
  'CdOH',
  'TopoOH',
  'NatureTH',
  'Persistanc',
  'TronconFic',
  'PositionPa',
  'ClasseLarg',
  'CdCoursEau',
  'StatutOH',
  'DateMajOH',
  'OrigineTH',
];

async function etapeBdTopage(dossier: string, gdal: ReturnType<typeof connexionGdal>) {
  titre('Hydrographie — BD TOPAGE');
  const ici = path.join(dossier, '08_BD_TOPAGE_AURA');
  const lisezmoi = await readFile(path.join(ici, 'LISEZMOI.txt'), 'utf8');
  const millesime = lisezmoi.match(/BD TOPAGE (\d{4})/)?.[1];
  if (!millesime) throw new Error('Millésime de BD TOPAGE introuvable dans LISEZMOI.txt.');

  const fichier = (nom: string) => `/vsizip/${path.join(ici, nom)}`;
  const troncons = (await readdir(ici))
    .filter((n) => /^TronconHydrographique_AURA_.+\.gpkg\.zip$/.test(n))
    .sort();
  if (troncons.length === 0) throw new Error('Aucun fichier de tronçons hydrographiques.');

  console.info('  chargement dans PostGIS (plusieurs minutes sur un Raspberry Pi)…');
  chargerCouche(gdal, { source: fichier('BassinHydrographique_AURA.gpkg.zip'), table: 'stg_bassins' });
  // Une table par fichier : ogr2ogr refuse de restreindre les colonnes d'une
  // couche ajoutée à une table existante (`-append` exclut `-select`).
  const tablesTroncons = troncons.map((nom, i) => {
    const table = `stg_troncons_${i}`;
    chargerCouche(gdal, { source: fichier(nom), table, colonnes: COLONNES_TRONCONS });
    return table;
  });
  chargerCouche(gdal, { source: fichier('SurfaceElementaire_AURA.gpkg.zip'), table: 'stg_surfaces' });
  chargerCouche(gdal, { source: fichier('CoursEau_AURA.gpkg.zip'), table: 'stg_cours_eau' });
  chargerCouche(gdal, { source: fichier('PlanEau_AURA.gpkg.zip'), table: 'stg_plans_eau' });

  await avecSession(
    {
      code: 'cours-eau',
      name: 'Hydrographie — BD TOPAGE',
      territory: '84',
      version: millesime,
      sourceLabel: `IGN / OFB — BD TOPAGE ${millesime}, extrait Auvergne-Rhône-Alpes`,
    },
    async (session) => {
      await verserTable(session, {
        table: 'stg_bassins',
        kind: 'BASSIN_HYDROGRAPHIQUE',
        champCode: 'CdBH',
        champLibelle: 'LbBH',
        libelleParDefaut: 'Bassin hydrographique',
      });
      for (const table of tablesTroncons) {
        await verserTable(session, {
          table,
          kind: 'TRONCON_HYDROGRAPHIQUE',
          champCode: 'CdOH',
          champLibelle: 'TopoOH',
          libelleParDefaut: 'Écoulement sans nom',
          attributs: COLONNES_TRONCONS,
        });
      }
      await verserTable(session, {
        table: 'stg_surfaces',
        kind: 'SURFACE_HYDROGRAPHIQUE',
        champCode: 'CdOH',
        libelleParDefaut: 'Surface en eau',
        attributs: ['CdOH', 'NatureSE', 'Persistanc', 'StatutOH', 'DateMajOH', 'CdPlanEau_'],
      });
      await verserTable(session, {
        table: 'stg_cours_eau',
        kind: 'COURS_EAU',
        champCode: 'CdOH',
        champLibelle: 'TopoOH',
        libelleParDefaut: 'Cours d’eau sans nom',
      });
      await verserTable(session, {
        table: 'stg_plans_eau',
        kind: 'PLAN_EAU',
        champCode: 'CdOH',
        champLibelle: 'TopoOH',
        libelleParDefaut: 'Plan d’eau sans nom',
      });
      const sources = [
        path.join(ici, 'LISEZMOI.txt'),
        ...['BassinHydrographique_AURA.gpkg.zip', ...troncons, 'SurfaceElementaire_AURA.gpkg.zip', 'CoursEau_AURA.gpkg.zip', 'PlanEau_AURA.gpkg.zip'].map(
          (n) => path.join(ici, n),
        ),
      ];
      return {
        integration: {
          etat: 'partiel',
          millesime,
          fichiers: await Promise.all(sources.map((f) => fichierVerifie(dossier, f))),
          elements: await elementsVerses(session.referentialId, {
            BASSIN_HYDROGRAPHIQUE: 'bassins hydrographiques',
            TRONCON_HYDROGRAPHIQUE: 'tronçons hydrographiques',
            SURFACE_HYDROGRAPHIQUE: 'surfaces hydrographiques élémentaires',
            COURS_EAU: 'cours d’eau',
            PLAN_EAU: 'plans d’eau',
          }),
          manques: [
            {
              quoi: 'Qualification des écoulements « cours d’eau » au sens de la police de l’eau et couche « BCAE »',
              pourquoi: 'BD TOPAGE localise les écoulements ; la cartographie départementale des cours d’eau et la couche BCAE ne sont pas fournies.',
              consequence: 'Une distance à un écoulement est mesurée et montrée ; elle ne crée jamais de ZNT ni de bande enherbée : la règle se vérifie sur la cartographie officielle.',
            },
          ],
        },
        notes: [
          'BD TOPAGE localise les écoulements ; elle ne dit pas lesquels sont des cours d’eau au sens d’un arrêté.',
          'Couches non importées : nœuds hydrographiques et bassins versants topographiques, qu’aucun contrôle n’emploie.',
        ],
      };
    },
  );

  // Les tables intermédiaires des tronçons pèsent lourd : on ne les garde pas.
  for (const t of [...tablesTroncons, 'stg_surfaces', 'stg_cours_eau', 'stg_plans_eau', 'stg_bassins']) {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${t}"`);
  }
}

// ---------------------------------------------------------------------------
// Points et ouvrages de prélèvement
// ---------------------------------------------------------------------------

async function etapeCaptages(dossier: string, gdal: ReturnType<typeof connexionGdal>) {
  titre('Points et ouvrages de prélèvement');
  const ici = path.join(dossier, '09_CAPTAGES');

  const couches = [
    { archive: 'PointPrelevement_FXX-shp.zip', shp: 'PointPrelevement_FXX.shp', table: 'stg_points' },
    { archive: 'OuvragePrel_FXX-shp.zip', shp: 'OuvragePrel_FXX.shp', table: 'stg_ouvrages' },
  ];
  const dates: string[] = [];
  for (const c of couches) {
    const entree = (await entrees(path.join(ici, c.archive))).find((e) => e.chemin === c.shp);
    dates.push(jour(entree?.date ?? null, `l'archive ${c.archive}`));
    chargerCouche(gdal, {
      source: `/vsizip/${path.join(ici, c.archive)}/${c.shp}`,
      table: c.table,
      emprise: EMPRISE_AURA,
    });
  }
  const version = dates.sort().at(-1)!;

  await avecSession(
    {
      code: 'captages',
      name: 'Points et ouvrages de prélèvement',
      territory: '84',
      version,
      sourceLabel: 'Sandre — référentiel des points et ouvrages de prélèvement',
    },
    async (session) => {
      await verserTable(session, {
        table: 'stg_points',
        kind: 'POINT_PRELEVEMENT',
        champCode: 'CdPointPre',
        champLibelle: 'NomPointPr',
        libelleParDefaut: 'Point de prélèvement sans nom',
        filtreTable: TABLE_REGION,
      });
      await verserTable(session, {
        table: 'stg_ouvrages',
        kind: 'OUVRAGE_PRELEVEMENT',
        champCode: 'CdOuvrageP',
        champLibelle: 'NomOuvrage',
        libelleParDefaut: 'Ouvrage de prélèvement sans nom',
        filtreTable: TABLE_REGION,
      });
      return {
        integration: {
          etat: 'partiel',
          millesime: version.slice(0, 4),
          fichiers: await Promise.all(couches.map((c) => fichierVerifie(dossier, path.join(ici, c.archive)))),
          elements: await elementsVerses(session.referentialId, {
            POINT_PRELEVEMENT: 'points de prélèvement',
            OUVRAGE_PRELEVEMENT: 'ouvrages de prélèvement',
          }),
          manques: [
            {
              quoi: 'Signification des codes d’usage et de nature des prélèvements',
              pourquoi: 'Aucun fichier fourni ne documente ces codes Sandre.',
              consequence: 'Ils sont conservés tels quels, non traduits ; l’usage « eau potable » d’un point n’est pas déduit.',
            },
            {
              quoi: 'Périmètres de protection de captage',
              pourquoi: 'Aucun jeu des ARS n’est fourni.',
              consequence: 'Un point de prélèvement situe ; il ne délimite aucune interdiction.',
            },
          ],
        },
        notes: [
          `Date des fichiers : ${dates.join(' et ')}.`,
          'Les codes d’usage (UsagePrinE) et de nature des points ne sont documentés par aucun fichier fourni : ils sont conservés tels quels, non traduits.',
          'Un point ou un ouvrage de prélèvement n’est ni une aire d’alimentation de captage, ni un périmètre de protection.',
        ],
      };
    },
  );
  for (const c of couches) await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${c.table}"`);
}

// ---------------------------------------------------------------------------

async function etapeContextes(): Promise<void> {
  titre('Contexte réglementaire des parcelles');
  const exploitations = await prisma.farm.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  let total = 0;
  for (const e of exploitations) total += await recomputeFarmContexts(e.id);
  console.info(`  ✓ ${total} parcelle(s) recalculée(s) sur ${exploitations.length} exploitation(s)`);
}

async function main(): Promise<void> {
  const { dossier, etapes } = args();
  if (!existsSync(dossier)) throw new Error(`Dossier introuvable : ${dossier}`);
  console.info(`Référentiels AURA — ${dossier}`);
  console.info(`Étapes : ${etapes.join(', ')}`);

  const geographiques = etapes.some((e) =>
    ['limites', 'zones-vulnerables', 'aires-alimentation-captage', 'cours-eau', 'captages'].includes(e),
  );
  const gdal = connexionGdal(process.env.DATABASE_URL ?? '');
  if (geographiques) console.info(`GDAL : ${verifierGdal()}`);

  for (const etape of etapes) {
    switch (etape) {
      case 'ephy':
        await etapeEphy(dossier);
        break;
      case 'ift':
        await etapeIft(dossier);
        break;
      case 'limites':
        await etapeLimites(dossier, gdal);
        break;
      case 'zones-vulnerables':
        await etapeZonesVulnerables(dossier, gdal);
        break;
      case 'aires-alimentation-captage':
        await etapeAac(dossier, gdal);
        break;
      case 'cours-eau':
        await etapeBdTopage(dossier, gdal);
        break;
      case 'captages':
        await etapeCaptages(dossier, gdal);
        break;
      case 'regles':
        titre('Règles transcrites des textes (ZAR, programme d’actions, GREN)');
        await importerReglesAura(dossier);
        break;
      case 'contextes':
        await etapeContextes();
        break;
    }
  }
  console.info('\n✓ Référentiels AURA importés.');
}

main()
  .catch((erreur) => {
    console.error(`\n✗ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
