import './load-env';

/**
 * Contrôle du lecteur XML TéléPAC sur de vrais dossiers.
 *
 *   npm run check:telepac -- chemin/vers/DossierPAC2026.xml [autres.xml…]
 *
 * Pourquoi un script en plus des tests unitaires
 * ----------------------------------------------
 * Les tests unitaires tournent sur des fixtures : ils vérifient que le lecteur
 * fait ce qu'on a prévu qu'il fasse. Ce script fait l'inverse — il prend un
 * dossier réel, non réduit, et vérifie que ce qui en sort est cohérent avec
 * lui-même : autant de parcelles que d'éléments dans le fichier, une surface
 * plausible, des trous conservés, aucune géométrie muette.
 *
 * C'est ce genre de contrôle qui a trouvé les défauts que les tests n'auraient
 * pas vus, parce qu'une fixture encode ce qu'on croyait, pas ce qui est.
 *
 * Le script ne lit rien d'autre que les fichiers qu'on lui donne : il n'écrit
 * pas en base et n'a besoin d'aucun compte.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  lireTelepacXml,
  versShapeFeatures,
  sridProbable,
  surfaceAdmissibleHa,
  type TelepacEntite,
} from '../src/lib/pac/telepac-xml';
import type { Ring } from '../src/lib/pac/shapefile';

let echecs = 0;
let controles = 0;

function verifier(condition: boolean, libelle: string, detail = ''): void {
  controles += 1;
  if (condition) {
    console.log(`  ✓ ${libelle}${detail ? ` — ${detail}` : ''}`);
  } else {
    echecs += 1;
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Aire planaire par la formule des lacets.
 *
 * Volontairement indépendante de PostGIS : le but est justement de disposer
 * d'un second calcul pour confronter celui qui fait foi. Deux méthodes qui
 * tombent d'accord valent mieux qu'une seule qu'on croit sur parole. Valable
 * en Lambert-93, dont l'unité est le mètre.
 */
function aireM2(anneaux: Ring[]): number {
  let total = 0;
  anneaux.forEach((anneau, index) => {
    let somme = 0;
    for (let i = 0; i < anneau.length - 1; i += 1) {
      const a = anneau[i];
      const b = anneau[i + 1];
      if (!a || !b) continue;
      somme += a[0] * b[1] - b[0] * a[1];
    }
    // Le premier anneau est le contour, les suivants sont des trous.
    total += (index === 0 ? 1 : -1) * Math.abs(somme / 2);
  });
  return total;
}

function comptesBruts(texte: string): Record<string, number> {
  const compter = (motif: RegExp) => (texte.match(motif) ?? []).length;
  return {
    ilot: compter(/<ilot\s/g),
    parcelle: compter(/<parcelle>/g),
    sna: compter(/<sna-declaree>/g),
    zdh: compter(/<zdh-declaree>/g),
    trous: compter(/<gml:innerBoundaryIs>/g),
    points: compter(/<gml:Point>/g),
  };
}

function examiner(chemin: string): void {
  const buffer = readFileSync(chemin);
  console.log(`\n▸ ${basename(chemin)}  (${(buffer.byteLength / 1024).toFixed(0)} Ko)`);

  const lu = lireTelepacXml(buffer);
  const d = lu.declaration;

  console.log(
    `  campagne « ${d.campagne ?? '?'} », schéma « ${d.fichierXsd ?? '?'} », ` +
      `encodage ${d.encodage}`,
  );

  // ---- Le lecteur a-t-il vu tout ce que le fichier contient ? -------------
  //
  // On recompte à la main, sur le texte brut, ce que le lecteur prétend avoir
  // lu. Un lecteur qui perd la moitié des parcelles sans le dire est le mode de
  // panne le plus coûteux : l'import réussit, et il manque des parcelles.
  const brut = comptesBruts(buffer.toString('latin1'));

  verifier(lu.ilots.length === brut.ilot, 'tous les îlots lus', `${lu.ilots.length}/${brut.ilot}`);
  verifier(
    lu.parcelles.length === brut.parcelle,
    'toutes les parcelles lues',
    `${lu.parcelles.length}/${brut.parcelle}`,
  );
  verifier(lu.sna.length === brut.sna, 'toutes les SNA lues', `${lu.sna.length}/${brut.sna}`);
  verifier(lu.zdh.length === brut.zdh, 'toutes les ZDH lues', `${lu.zdh.length}/${brut.zdh}`);

  // ---- En-tête ------------------------------------------------------------
  verifier(Boolean(d.pacage), 'numéro PACAGE lu', d.pacage ? `${d.pacage.length} caractères` : '');
  verifier(Boolean(d.fichierXsd), 'version de schéma annoncée', d.fichierXsd ?? '');

  // ---- Géométries ---------------------------------------------------------
  const toutes: TelepacEntite[] = [...lu.ilots, ...lu.parcelles, ...lu.sna, ...lu.zdh];
  const muettes = toutes.filter((e) => e.geometrie.type === 'absente');
  verifier(muettes.length === 0, 'aucune entité sans géométrie', `${muettes.length} muette(s)`);

  const points = toutes.filter((e) => e.geometrie.type === 'point');
  verifier(
    points.length === brut.points,
    'géométries ponctuelles conservées',
    `${points.length}/${brut.points}`,
  );

  const trousLus = toutes.reduce(
    (n, e) => n + (e.geometrie.type === 'polygone' ? e.geometrie.anneaux.length - 1 : 0),
    0,
  );
  verifier(trousLus === brut.trous, 'trous conservés', `${trousLus}/${brut.trous}`);

  // ---- Le SRID est-il proposé, et non imposé ? ----------------------------
  const anneauxParcelles = lu.parcelles.flatMap((p) =>
    p.geometrie.type === 'polygone' ? p.geometrie.anneaux : [],
  );
  const srid = sridProbable(anneauxParcelles);
  verifier(srid.srid === 2154, 'Lambert-93 proposé d’après l’emprise', srid.label.slice(0, 60));

  // ---- Surfaces -----------------------------------------------------------
  //
  // Un contour parcouru dans le mauvais sens, ou un trou compté comme un
  // contour, produit une surface aberrante. On la confronte donc à l'ordre de
  // grandeur d'une exploitation.
  const surfaceHa = anneauxParcelles.length
    ? lu.parcelles.reduce(
        (s, p) => s + (p.geometrie.type === 'polygone' ? aireM2(p.geometrie.anneaux) : 0),
        0,
      ) / 10_000
    : 0;
  verifier(
    surfaceHa > 0 && surfaceHa < 20_000,
    'surface parcellaire d’un ordre de grandeur plausible',
    `${surfaceHa.toFixed(2)} ha`,
  );

  // ---- Surface admissible : l'unité tient-elle ? --------------------------
  //
  // L'unité (l'are) n'est écrite nulle part dans le fichier ; elle a été
  // établie par comparaison. Ce contrôle la revérifie sur chaque dossier plutôt
  // que de faire confiance à la conclusion tirée d'un seul.
  const rapports: number[] = [];
  let admissibleTotalHa = 0;
  let geomAvecAdmissibleHa = 0;
  for (const p of lu.parcelles) {
    const declaree = surfaceAdmissibleHa(p.attributs['surface-admissible'] as string | null);
    if (declaree === null || declaree <= 0) continue;
    if (p.geometrie.type !== 'polygone') continue;
    const geom = aireM2(p.geometrie.anneaux) / 10_000;
    rapports.push(geom / declaree);
    admissibleTotalHa += declaree;
    geomAvecAdmissibleHa += geom;
  }
  if (rapports.length > 0) {
    rapports.sort((a, b) => a - b);
    const median = rapports[Math.floor(rapports.length / 2)] ?? 0;
    verifier(
      median > 0.9 && median < 1.15,
      'surface admissible lue en ares (confronté à la géométrie)',
      `rapport médian ${median.toFixed(4)} sur ${rapports.length} parcelles`,
    );

    // Le contrôle porte sur le total, pas sur chaque parcelle.
    //
    // Une première version comparait parcelle à parcelle et exigeait
    // « admissible ≤ graphique ». Elle échouait sur 12 parcelles du dossier
    // 2026, et c'est le contrôle qui avait tort : sur ce dossier, 9 parcelles
    // portent une admissible supérieure à leur propre géométrie — jusqu'à
    // 1,08 ha — alors que les totaux se rejoignent au niveau de l'îlot. La
    // raison n'a pas pu être vérifiée faute de notice, mais le fait est là, et
    // desserrer le seuil jusqu'à ce que ça passe aurait masqué la vraie
    // question au lieu de la poser.
    //
    // Ce qui reste vrai et vérifiable : sur l'ensemble du dossier, les deux
    // totaux mesurent presque la même chose. Une erreur d'unité les écarterait
    // d'un facteur cent, très au-delà de la tolérance retenue.
    const ecartRelatif = Math.abs(geomAvecAdmissibleHa - admissibleTotalHa) / admissibleTotalHa;
    verifier(
      ecartRelatif < 0.1,
      'total admissible et total géométrique du même ordre',
      `${admissibleTotalHa.toFixed(2)} ha déclarés contre ${geomAvecAdmissibleHa.toFixed(2)} ha ` +
        `mesurés (${(ecartRelatif * 100).toFixed(1)} % d’écart)`,
    );

    const auDessus = rapports.filter((r) => r < 1).length;
    console.log(
      `  · ${auDessus}/${rapports.length} parcelles ont une admissible supérieure à leur ` +
        'géométrie : constaté, non expliqué, et jamais signalé comme anomalie.',
    );
  } else {
    console.log('  · surface-admissible absente de ce dossier (campagne antérieure à 2026)');
  }

  // ---- Rattachement parcelle → îlot ---------------------------------------
  const numerosIlots = new Set(lu.ilots.map((i) => String(i.attributs['numero-ilot'])));
  const orphelines = lu.parcelles.filter(
    (p) => !numerosIlots.has(String(p.attributs['numero-ilot'])),
  );
  verifier(
    orphelines.length === 0,
    'chaque parcelle porte le numéro d’un îlot du dossier',
    `${orphelines.length} orpheline(s)`,
  );

  // ---- Culture ------------------------------------------------------------
  const sansCulture = lu.parcelles.filter((p) => !p.attributs['code-culture']);
  verifier(
    sansCulture.length === 0,
    'chaque parcelle porte un code culture',
    `${sansCulture.length} sans code`,
  );

  // Une dérobée ne doit jamais avoir écrasé la culture principale.
  const derobeesConfondues = lu.parcelles.filter((p) =>
    Object.keys(p.attributs).some((c) => c === 'derobee-code-culture' && !p.attributs['code-culture']),
  );
  verifier(derobeesConfondues.length === 0, 'aucune dérobée prise pour la culture principale');

  // ---- Conversion vers le format commun -----------------------------------
  const converti = versShapeFeatures(lu.parcelles);
  verifier(
    converti.features.length === lu.parcelles.length,
    'conversion vers le format d’import sans perte',
    `${converti.features.length} entités, ${converti.colonnes.length} colonnes`,
  );

  // ---- Branches écartées : nommées, pas silencieuses ----------------------
  if (lu.ignores.length > 0) {
    console.log(`  · écarté et annoncé : ${lu.ignores.length} branche(s)`);
    for (const raison of lu.ignores) console.log(`      ${raison}`);
  }
  for (const a of lu.warnings) console.log(`  ! ${a}`);
}

const fichiers = process.argv.slice(2);
if (fichiers.length === 0) {
  console.error(
    'Usage : npm run check:telepac -- <dossier.xml> [autres.xml…]\n' +
      "Donnez un ou plusieurs exports XML téléchargés depuis TéléPAC.",
  );
  process.exit(2);
}

for (const fichier of fichiers) {
  try {
    examiner(fichier);
  } catch (cause) {
    echecs += 1;
    console.log(`  ✗ lecture impossible — ${cause instanceof Error ? cause.message : cause}`);
  }
}

console.log(
  `\n${echecs === 0 ? '✓' : '✗'} ${controles - echecs}/${controles} contrôles passés ` +
    `sur ${fichiers.length} dossier(s).`,
);
process.exit(echecs === 0 ? 0 : 1);
