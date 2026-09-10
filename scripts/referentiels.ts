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

  const version = String(args.version ?? '');
  if (!version) {
    console.error(
      '✗ --version est obligatoire.\n' +
        "  Sans version, impossible de savoir quelle édition a servi à classer une\n" +
        '  parcelle, ni de rouvrir une campagne passée avec le bon zonage.',
    );
    process.exitCode = 1;
    return;
  }

  const urlEnv = process.env[spec.envVar];
  const url = typeof args.url === 'string' ? args.url : urlEnv;
  const fichier = typeof args.fichier === 'string' ? args.fichier : null;

  if (!fichier && !url) {
    console.error(
      [
        '',
        `✗ Aucune source pour « ${code} ».`,
        '',
        '  Parcelys ne génère aucune donnée réglementaire : ce zonage doit venir',
        `  d'une source officielle (${spec.sourceLabel}).`,
        '',
        `  1. Renseignez ${spec.envVar} dans .env, ou`,
        '  2. passez --fichier ./zonage.geojson',
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
    sourceLabel: spec.sourceLabel,
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

async function main(): Promise<void> {
  const { commande, args } = parseArgs(process.argv.slice(2));

  switch (commande) {
    case 'etat':
      await etat();
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
          '  npm run referentiels -- importer-zonage --code <code> --version <v>',
          '                          [--fichier f.geojson | --url https://…]',
          '                          [--territoire 24] [--srid 2154]',
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
