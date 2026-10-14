/**
 * Chargement de fichiers géographiques dans PostGIS par `ogr2ogr` (GDAL).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI GDAL, ET POURQUOI EN DEHORS DE NODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les référentiels fournis arrivent en GeoPackage, en Shapefile et en GeoJSON,
 * en Lambert 93 comme en WGS 84, parfois zippés deux fois. GDAL lit tout cela,
 * reprojette, et écrit **en flux** dans PostGIS : 402 215 tronçons ne passent
 * jamais par la mémoire de Node, ce qu'un Raspberry Pi ne supporterait pas.
 *
 * GDAL n'est pas une dépendance npm : c'est un paquet système.
 *
 *     sudo apt install gdal-bin
 *
 * Son absence arrête l'import avec cette commande, plutôt que de laisser un
 * référentiel à moitié chargé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE MOT DE PASSE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il passe par `PGPASSWORD`, dans l'environnement du processus fils, et non
 * dans la chaîne de connexion : les arguments d'un processus se lisent dans
 * `ps` par n'importe quel utilisateur de la machine.
 */

import { spawnSync } from 'node:child_process';

export class GdalAbsent extends Error {
  constructor() {
    super(
      'ogr2ogr (GDAL) est introuvable. Il lit les GeoPackage et Shapefile des ' +
        'référentiels.\n  Installez-le :  sudo apt install gdal-bin',
    );
    this.name = 'GdalAbsent';
  }
}

/** Version de GDAL, ou erreur explicite s'il manque. */
export function verifierGdal(): string {
  const r = spawnSync('ogr2ogr', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new GdalAbsent();
  return r.stdout.trim();
}

type Connexion = { chaine: string; env: NodeJS.ProcessEnv };

/** Chaîne de connexion PostgreSQL pour GDAL, sans le mot de passe. */
export function connexionGdal(databaseUrl: string): Connexion {
  const url = new URL(databaseUrl);
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const morceaux = [
    `dbname='${base.replace(/'/g, "\\'")}'`,
    `host='${url.hostname}'`,
    `port='${url.port || '5432'}'`,
    `user='${decodeURIComponent(url.username).replace(/'/g, "\\'")}'`,
  ];
  return {
    chaine: `PG:${morceaux.join(' ')}`,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  };
}

export type ChargementCouche = {
  /** Chemin GDAL de la source, `/vsizip/…` compris. */
  source: string;
  /** Nom de la couche dans la source, si elle en a plusieurs. */
  couche?: string;
  /** Table intermédiaire à créer (écrasée si elle existe). */
  table: string;
  /** Ajouter à la table plutôt que l'écraser (couche découpée en plusieurs fichiers). */
  ajouter?: boolean;
  /** Colonnes à reprendre ; toutes par défaut. */
  colonnes?: string[];
  /**
   * Préfiltre par emprise, en WGS 84 : [ouest, sud, est, nord]. Sert aux jeux
   * nationaux — on ne charge pas toute la France pour en garder une région.
   * Le filtre exact, par intersection avec le contour, se fait ensuite en SQL.
   */
  emprise?: [number, number, number, number];
};

/** Charge une couche dans une table intermédiaire PostGIS, reprojetée en WGS 84. */
export function chargerCouche(connexion: Connexion, params: ChargementCouche): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(params.table)) {
    throw new Error(`Nom de table intermédiaire refusé : « ${params.table} ».`);
  }
  if (params.ajouter && params.colonnes?.length) {
    // ogr2ogr le refuse (« if -append is specified, -select cannot be used ») :
    // on le dit avant de lancer, plutôt que d'afficher son mode d'emploi.
    throw new Error('Ajout à une table existante et restriction de colonnes sont incompatibles : chargez chaque fichier dans sa table.');
  }

  const args = [
    '-f',
    'PostgreSQL',
    connexion.chaine,
    params.source,
    ...(params.couche ? [params.couche] : []),
    '-nln',
    params.table,
    ...(params.ajouter ? ['-append'] : ['-overwrite']),
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'FID=ogc_fid',
    '-lco',
    'PRECISION=NO',
    // Les noms de colonnes de la source sont gardés tels quels (`CdAAC`,
    // `TronconFic`…). Sans cela le pilote PostgreSQL les met en minuscules, et
    // les attributs conservés ne porteraient plus les noms de la source — ceux
    // que la documentation du producteur et le moteur emploient.
    '-lco',
    'LAUNDER=NO',
    '-nlt',
    'GEOMETRY',
    '-dim',
    'XY',
    '-t_srs',
    'EPSG:4326',
    '-gt',
    '65536',
    '--config',
    'PG_USE_COPY',
    'YES',
    ...(params.colonnes?.length ? ['-select', params.colonnes.join(',')] : []),
    ...(params.emprise
      ? ['-spat', ...params.emprise.map(String), '-spat_srs', 'EPSG:4326']
      : []),
  ];

  const r = spawnSync('ogr2ogr', args, {
    env: connexion.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === 'ENOENT') throw new GdalAbsent();
    throw r.error;
  }
  if (r.status !== 0) {
    throw new Error(
      `ogr2ogr a échoué sur ${params.source}${params.couche ? ` (${params.couche})` : ''} :\n` +
        (r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n'),
    );
  }
}

/**
 * Exécute une requête SQL de lecture sur une source par `ogrinfo`, et rend la
 * première valeur trouvée. Sert à lire ce que la source dit d'elle-même — la
 * date de dernière modification d'un GeoPackage — plutôt que de la supposer.
 */
export function lireValeur(source: string, sql: string, champ: string): string | null {
  const r = spawnSync('ogrinfo', ['-q', '-ro', source, '-sql', sql], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const motif = new RegExp(`^\\s*${champ} \\([^)]*\\) = (.+)$`, 'm');
  return r.stdout.match(motif)?.[1]?.trim() ?? null;
}
