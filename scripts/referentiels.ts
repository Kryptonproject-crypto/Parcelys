/**
 * Import des référentiels réglementaires.
 *
 *   npm run referentiels -- etat
 *   npm run referentiels -- importer-zonage --code zones-vulnerables \
 *        --fichier ./zv.geojson --version 2024-07 --territoire 24 [--srid 2154]
 *   npm run referentiels -- importer-zonage --code cours-eau --url https://…
 *   npm run referentiels -- recalculer-contextes
 *
 * ## Pourquoi aucune URL n'est codée en dur
 *
 * Les adresses des jeux de données officiels changent, et une URL périmée écrite
 * dans le code produit soit une erreur, soit — bien pire — l'import silencieux
 * d'une version obsolète que plus personne ne remarque. Chaque référentiel lit
 * son adresse dans une variable d'environnement, et sans elle il reste
 * « non configuré », ce que l'interface affiche en toutes lettres.
 *
 * ## Pourquoi ce script existe séparément de l'interface
 *
 * Un import de zonage, c'est parfois plusieurs centaines de milliers de
 * polygones à reprojeter. Sur un Raspberry Pi, cela prend des minutes et ne doit
 * pas passer par une requête HTTP qui expirerait à mi-parcours en laissant le
 * référentiel à moitié importé.
 */
import './load-env';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import {
  REFERENTIAL_CATALOG,
  findSpec,
  getReferentialStates,
} from '@/lib/regulatory/referentials';
import { importZoneCollection, type ZoneFeature } from '@/lib/regulatory/import-zones';
import { recomputeFarmContexts } from '@/lib/regulatory/geography';
import {
  DatagouvError,
  findCandidates,
  getDataset,
  pickResource,
  versionOf,
  type DatagouvResource,
} from '@/lib/regulatory/datagouv';
import type { ZoneKind } from '@prisma/client';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): { commande: string; args: Args } {
  const commande = argv[0] ?? 'etat';
  const args: Args = {};
  for (let i = 1; i < argv.length; i += 1) {
    const cle = argv[i];
    if (!cle?.startsWith('--')) continue;
    const suivant = argv[i + 1];
    if (suivant && !suivant.startsWith('--')) {
      args[cle.slice(2)] = suivant;
      i += 1;
    } else {
      args[cle.slice(2)] = true;
    }
  }
  return { commande, args };
}

/** Nature de zonage attendue pour chaque référentiel géographique. */
const NATURES: Record<string, ZoneKind> = {
  'zones-vulnerables': 'ZONE_VULNERABLE',
  'zones-action-renforcee': 'ZONE_ACTION_RENFORCEE',
  captages: 'CAPTAGE',
  'cours-eau': 'COURS_EAU',
};

async function etat(): Promise<void> {
  const etats = await getReferentialStates();

  console.info('\nRéférentiels réglementaires\n');
  for (const e of etats) {
    const badge =
      e.status === 'ACTIF'
        ? '✓'
        : e.status === 'ECHEC'
          ? '✗'
          : e.status === 'NON_CONFIGURE'
            ? '·'
            : '~';

    console.info(`  ${badge} ${e.name}`);
    console.info(`      code       : ${e.code}`);
    console.info(`      statut     : ${e.status}`);
    if (e.version) {
      console.info(
        `      version    : ${e.version}${e.territory ? ` (territoire ${e.territory})` : ''}`,
      );
      console.info(`      entrées    : ${e.recordCount.toLocaleString('fr-FR')}`);
      console.info(
        `      importé le : ${e.importedAt ? new Date(e.importedAt).toLocaleString('fr-FR') : '—'}`,
      );
    }
    if (e.versionCount > 1) {
      console.info(`      versions   : ${e.versionCount} conservées`);
    }
    if (e.status === 'NON_CONFIGURE') {
      console.info(`      source     : ${e.sourceLabel}`);
      console.info(`      variable   : ${e.envVar}${e.configured ? ' (renseignée)' : ' (absente)'}`);
      console.info(`      sans lui   : ${e.degradedWithout}`);
    }
    if (e.notes) console.info(`      ⚠ ${e.notes}`);
    console.info('');
  }

  const manquants = etats.filter((e) => e.status === 'NON_CONFIGURE').length;
  if (manquants > 0) {
    console.info(
      `  ${manquants} référentiel(s) non importé(s). Parcelys ne calcule rien à leur place :\n` +
        '  les vérifications correspondantes restent « indéterminées », et le disent.\n',
    );
  }
}

async function importerZonage(args: Args): Promise<void> {
  const code = String(args.code ?? '');
  const spec = findSpec(code);
  if (!spec) {
    console.error(
      `✗ Référentiel inconnu : « ${code} ».\n  Connus : ${REFERENTIAL_CATALOG.map((s) => s.code).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  const kind = NATURES[code];
  if (!kind) {
    console.error(`✗ « ${code} » n'est pas un référentiel géographique.`);
    process.exitCode = 1;
    return;
  }

  let version = String(args.version ?? '');
  let url = typeof args.url === 'string' ? args.url : process.env[spec.envVar];
  const fichier = typeof args.fichier === 'string' ? args.fichier : null;
  let provenance = spec.sourceLabel;
  let ressource: DatagouvResource | null = null;

  // --- Résolution par l'API data.gouv.fr ----------------------------------
  // `--dataset` prend le pas sur tout le reste : c'est le chemin recommandé,
  // parce qu'il apporte aussi la date de publication — donc la version — et
  // le producteur, qu'aucune URL nue ne porte.
  if (typeof args.dataset === 'string') {
    console.info(`→ Lecture du jeu de données ${args.dataset} sur data.gouv.fr`);
    const dataset = await getDataset(args.dataset);

    ressource =
      typeof args.ressource === 'string'
        ? (dataset.resources.find((r) => r.id === args.ressource) ?? null)
        : pickResource(dataset, spec.datagouv?.formats);

    if (!ressource) {
      console.error(
        `✗ Aucune ressource exploitable dans « ${dataset.title} ».\n` +
          `  Formats présents : ${[...new Set(dataset.resources.map((r) => r.format))].join(', ') || '—'}\n` +
          `  Formats attendus : ${(spec.datagouv?.formats ?? []).join(', ')}\n\n` +
          '  Choisissez explicitement avec --ressource <identifiant>, ou téléchargez\n' +
          '  le fichier et passez --fichier.',
      );
      process.exitCode = 1;
      return;
    }

    console.info(`  jeu       : ${dataset.title}`);
    console.info(`  producteur: ${dataset.organization?.name ?? '—'}`);
    console.info(`  licence   : ${dataset.license ?? '—'}`);
    console.info(`  ressource : ${ressource.title} [${ressource.format}]`);

    // `latest` pointe toujours la dernière version du fichier ; `url` peut
    // désigner un dépôt figé. On préfère `latest` quand il existe.
    url = ressource.latest ?? ressource.url;
    provenance = dataset.organization?.name
      ? `${dataset.organization.name} — via data.gouv.fr`
      : 'data.gouv.fr';

    // La version se déduit de la date de la ressource : c'est ce qui distingue
    // deux éditions d'un même zonage. On ne l'invente pas si elle manque.
    if (!version) {
      const deduite = versionOf(ressource);
      if (!deduite) {
        console.error(
          '✗ La ressource ne porte pas de date de modification : impossible d’en\n' +
            '  déduire une version. Passez --version explicitement.',
        );
        process.exitCode = 1;
        return;
      }
      version = deduite;
      console.info(`  version   : ${version} (date de la ressource)`);
    }
  }

  if (!version) {
    console.error(
      '✗ --version est obligatoire.\n' +
        "  Sans version, impossible de savoir quelle édition a servi à classer une\n" +
        '  parcelle, ni de rouvrir une campagne passée avec le bon zonage.\n\n' +
        '  Avec --dataset, la version est déduite de la date de la ressource.',
    );
    process.exitCode = 1;
    return;
  }

  if (!fichier && !url) {
    console.error(
      [
        '',
        `✗ Aucune source pour « ${code} ».`,
        '',
        '  Parcelys ne génère aucune donnée réglementaire : ce zonage doit venir',
        `  d'une source officielle (${spec.sourceLabel}).`,
        '',
        '  Trois chemins, du plus recommandé au moins :',
        `    1. npm run referentiels -- chercher --code ${code} --territoire "votre région"`,
        '       puis  --dataset <identifiant>',
        `    2. renseignez ${spec.envVar} dans .env`,
        '    3. passez --fichier ./zonage.geojson',
        '',
      ].join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  let brut: string;
  if (fichier) {
    console.info(`→ Lecture de ${fichier}`);
    brut = await readFile(path.resolve(fichier), 'utf8');
  } else {
    console.info(`↓ Téléchargement : ${url}`);
    const reponse = await fetch(url as string, {
      headers: { 'User-Agent': 'Parcelys/referentiels' },
      redirect: 'follow',
    });
    if (!reponse.ok) {
      throw new Error(`Téléchargement impossible (HTTP ${reponse.status}) : ${url}`);
    }
    brut = await reponse.text();
  }

  const collection = JSON.parse(brut) as {
    type?: string;
    features?: ZoneFeature[];
  };

  const features = collection.features ?? [];
  if (features.length === 0) {
    console.error(
      '✗ Le fichier ne contient aucune entité. Rien n’a été importé — mieux vaut\n' +
        '  un référentiel absent, qui se signale, qu’un référentiel vide qui passe\n' +
        '  pour importé.',
    );
    process.exitCode = 1;
    return;
  }

  console.info(`  ${features.length.toLocaleString('fr-FR')} entités lues`);

  const rapport = await importZoneCollection(features, {
    code,
    name: spec.name,
    kind,
    territory: typeof args.territoire === 'string' ? args.territoire : null,
    version,
    sourceLabel: provenance,
    sourceUrl: typeof url === 'string' ? url : null,
    srid: args.srid ? Number(args.srid) : 4326,
    ...(typeof args['champ-libelle'] === 'string'
      ? { labelField: args['champ-libelle'] }
      : {}),
    ...(typeof args['champ-code'] === 'string' ? { codeField: args['champ-code'] } : {}),
  });

  console.info('');
  console.info(`✓ Import terminé — version ${version}`);
  console.info(`  zones importées : ${rapport.imported.toLocaleString('fr-FR')}`);
  if (rapport.skipped > 0) {
    console.info(`  écartées        : ${rapport.skipped.toLocaleString('fr-FR')}`);
  }
  for (const a of rapport.warnings) console.warn(`  ⚠ ${a}`);

  console.info('');
  console.info(
    '  Le contexte des parcelles n’est pas recalculé automatiquement : lancez\n' +
      '    npm run referentiels -- recalculer-contextes',
  );
}

/**
 * Recalcule le contexte de toutes les parcelles.
 *
 * Nécessaire après tout import de zonage : les contextes déjà calculés l'ont
 * été avec l'ancien référentiel, et les laisser en place les rendrait faux
 * sans que rien ne le signale.
 */
async function recalculerContextes(): Promise<void> {
  const exploitations = await prisma.farm.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  console.info(`\n→ ${exploitations.length} exploitation(s)\n`);

  let total = 0;
  for (const exploitation of exploitations) {
    const faites = await recomputeFarmContexts(exploitation.id);
    total += faites;
    console.info(`  ✓ ${exploitation.name} — ${faites} parcelle(s)`);
  }

  console.info(`\n✓ ${total} contexte(s) recalculé(s)\n`);
}

/**
 * Cherche les jeux candidats sur data.gouv.fr, et les montre.
 *
 * **Ne choisit pas.** Une recherche « zones vulnérables » ramène des dizaines
 * de jeux régionaux et départementaux, de millésimes différents. En retenir un
 * automatiquement reviendrait à tirer au sort le zonage d'une région — et à
 * classer des parcelles à tort sans que rien ne le signale.
 *
 * On affiche donc les candidats avec leur producteur, leur licence, leur
 * dernière mise à jour et la ressource exploitable ; l'exploitant reconnaît le
 * sien, et l'identifiant technique retenu est conservé à l'import.
 */
async function chercher(args: Args): Promise<void> {
  const code = String(args.code ?? '');
  const spec = findSpec(code);

  if (!spec) {
    console.error(
      `✗ Référentiel inconnu : « ${code} ».\n  Connus : ${REFERENTIAL_CATALOG.map((s) => s.code).join(', ')}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!spec.datagouv) {
    console.error(
      `✗ « ${code} » n'est pas publié sur data.gouv.fr sous une forme importable.\n` +
        `  Source : ${spec.sourceLabel}`,
    );
    process.exitCode = 1;
    return;
  }

  // Les termes du catalogue, affinés par le territoire quand il est donné :
  // « zones vulnérables nitrates » + « Centre-Val de Loire ».
  const territoire = typeof args.territoire === 'string' ? args.territoire : '';
  const requete = [spec.datagouv.query, territoire].filter(Boolean).join(' ');

  console.info(`\n→ Recherche sur data.gouv.fr : « ${requete} »\n`);
  if (spec.datagouv.note) console.info(`  ⚠ ${spec.datagouv.note}\n`);

  // Piste relevée à la rédaction du catalogue. On la vérifie plutôt que de
  // l'annoncer : un slug peut avoir changé depuis, et l'afficher sans le
  // contrôler enverrait vers un jeu qui n'existe plus.
  if (spec.datagouv.slugConnu) {
    try {
      const connu = await getDataset(spec.datagouv.slugConnu);
      const ressourceConnue = pickResource(connu, spec.datagouv.formats);
      console.info('  Piste connue, vérifiée à l’instant :');
      console.info(`    ${connu.title}`);
      console.info(`    identifiant : ${connu.id}`);
      console.info(`    producteur  : ${connu.organization?.name ?? '—'}`);
      if (ressourceConnue) {
        console.info(
          `    ressource   : ${ressourceConnue.title} [${ressourceConnue.format}]` +
            `${versionOf(ressourceConnue) ? ` — ${versionOf(ressourceConnue)}` : ''}`,
        );
      }
      console.info('');
    } catch (erreur) {
      // Distinguer « le slug a disparu » de « on n'a pas pu demander ».
      // Confondre les deux enverrait chercher un nouveau slug alors que le
      // problème est le réseau — ou l'inverse.
      const introuvable = erreur instanceof DatagouvError && erreur.status === 404;
      console.info(
        introuvable
          ? `  (la piste « ${spec.datagouv.slugConnu} » n’existe plus — les slugs\n` +
              '   changent, c’est pourquoi Parcelys cherche plutôt que de les coder.)\n'
          : `  (piste « ${spec.datagouv.slugConnu} » non vérifiée —\n` +
              `   ${erreur instanceof Error ? erreur.message : 'erreur inconnue'})\n`,
      );
    }
  }

  const candidats = await findCandidates({
    query: requete,
    formats: spec.datagouv.formats,
    limit: Number(args.limite) || 10,
  });

  if (candidats.length === 0) {
    console.info(
      '  Aucun résultat. Élargissez les termes, ou cherchez directement sur\n' +
        '  https://www.data.gouv.fr puis relancez avec --dataset <identifiant>.\n',
    );
    return;
  }

  for (const [index, c] of candidats.entries()) {
    console.info(`  ${index + 1}. ${c.title}`);
    console.info(`     identifiant : ${c.datasetId}`);
    console.info(`     producteur  : ${c.organization ?? '—'}`);
    console.info(`     licence     : ${c.license ?? '—'}`);
    console.info(
      `     mise à jour : ${c.lastUpdate ? new Date(c.lastUpdate).toLocaleDateString('fr-FR') : '—'}`,
    );
    if (c.resource) {
      console.info(
        `     ressource   : ${c.resource.title} [${c.resource.format}]` +
          `${c.resource.filesize ? ` — ${(c.resource.filesize / 1024 / 1024).toFixed(1)} Mo` : ''}`,
      );
    } else {
      console.info(
        `     ressource   : aucune exploitable (formats présents : ${c.availableFormats.join(', ') || '—'})`,
      );
    }
    console.info('');
  }

  console.info(
    '  Pour importer celui qui correspond à VOTRE territoire :\n' +
      `    npm run referentiels -- importer-zonage --code ${code} \\\n` +
      '        --dataset <identifiant> --territoire <code INSEE>\n',
  );
}

async function main(): Promise<void> {
  const { commande, args } = parseArgs(process.argv.slice(2));

  switch (commande) {
    case 'etat':
      await etat();
      break;
    case 'chercher':
      await chercher(args);
      break;
    case 'importer-zonage':
      await importerZonage(args);
      break;
    case 'recalculer-contextes':
      await recalculerContextes();
      break;
    default:
      console.info(
        [
          '',
          'Référentiels réglementaires Parcelys',
          '',
          '  npm run referentiels -- etat',
          '      Ce qui est importé, dans quelle version, et ce qui manque.',
          '',
          '  npm run referentiels -- chercher --code <code> [--territoire "Centre-Val de Loire"]',
          '      Interroge data.gouv.fr et montre les jeux candidats.',
          '      Ne choisit pas : les zonages sont régionaux, se tromper de',
          '      région classerait des parcelles à tort.',
          '',
          '  npm run referentiels -- importer-zonage --code <code>',
          '                          --dataset <identifiant data.gouv.fr>',
          '                          [--ressource <id>] [--territoire 24] [--srid 2154]',
          '      La version est déduite de la date de la ressource.',
          '',
          '      Sans data.gouv.fr :',
          '                          --version <v> [--fichier f.geojson | --url https://…]',
          '',
          '  npm run referentiels -- recalculer-contextes',
          '      À lancer après chaque import de zonage.',
          '',
          `  Codes : ${REFERENTIAL_CATALOG.map((s) => s.code).join(', ')}`,
          '',
        ].join('\n'),
      );
  }
}

main()
  .catch((erreur) => {
    console.error('✗ Échec :', erreur instanceof Error ? erreur.message : erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
