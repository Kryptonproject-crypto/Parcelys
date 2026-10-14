import 'server-only';
import type { RegulatoryDomain, ZoneKind } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { beginImport, failImport, finishImport } from '@/lib/regulatory/referentials';

/**
 * Versement d'un référentiel géographique depuis une table intermédiaire.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS PAR UN FICHIER GEOJSON
 * ───────────────────────────────────────────────────────────────────────────
 *
 * L'import historique (`importZoneCollection`) lit un GeoJSON entier en mémoire
 * puis insère entité par entité. C'est très bien pour 1 125 communes. Pour les
 * 402 215 tronçons de BD TOPAGE, le fichier pèse plusieurs centaines de
 * mégaoctets : Node le chargerait en entier, et un Raspberry Pi n'y survivrait
 * pas.
 *
 * Ici, la donnée arrive dans PostGIS par `ogr2ogr` (en flux, sans passer par
 * Node), dans une table intermédiaire ; puis une seule requête SQL la verse
 * dans `regulatory_zones`. Le versement est testable sans GDAL — il suffit
 * d'une table — et c'est lui qui porte les règles : géométries corrigées,
 * entités vides écartées et comptées, attributs conservés.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CE QUI EST CONSERVÉ
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Les attributs de la source, tels quels — tous par défaut. Pour les couches
 * massives, une liste explicite peut restreindre ce qui est recopié ; la
 * source complète reste dans `data/`, rien n'est perdu, et la liste est écrite
 * dans le code qui l'emploie.
 *
 * La géométrie, sans autre transformation que :
 *   - le passage en 2D (BD TOPAGE porte une altitude que les calculs
 *     planimétriques n'emploient pas) ;
 *   - la correction des polygones invalides (`ST_MakeValid`), sans laquelle
 *     `ST_Intersects` échoue en aval ;
 *   - la promotion en multi- pour les surfaces et les lignes.
 * Les points restent des points.
 */

/** Un identifiant SQL que l'on a écrit soi-même : rien d'autre ne passe. */
function identifiant(nom: string): Prisma.Sql {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(nom)) {
    throw new Error(`Identifiant SQL refusé : « ${nom} ».`);
  }
  return Prisma.raw(`"${nom}"`);
}

export type SessionDImport = {
  referentialId: string;
  importId: string;
  versees: number;
  ecartees: number;
  avertissements: string[];
};

/**
 * Ouvre l'import d'un référentiel : crée ou reprend la version, et vide les
 * zones de **cette** version — réimporter ne doit pas doubler les entités.
 */
export async function ouvrirImport(referentiel: {
  code: string;
  domain?: RegulatoryDomain;
  name: string;
  territory: string | null;
  version: string;
  sourceLabel: string;
  sourceUrl?: string | null;
  appliesFrom?: Date | null;
  appliesTo?: Date | null;
}): Promise<SessionDImport> {
  const { referentiel: ref, journal } = await beginImport({
    code: referentiel.code,
    domain: referentiel.domain ?? 'ZONAGE',
    name: referentiel.name,
    territory: referentiel.territory,
    version: referentiel.version,
    sourceLabel: referentiel.sourceLabel,
    sourceUrl: referentiel.sourceUrl ?? null,
    appliesFrom: referentiel.appliesFrom ?? null,
    appliesTo: referentiel.appliesTo ?? null,
  });

  await prisma.regulatoryZone.deleteMany({ where: { referentialId: ref.id } });

  return {
    referentialId: ref.id,
    importId: journal.id,
    versees: 0,
    ecartees: 0,
    avertissements: [],
  };
}

/**
 * Verse une table intermédiaire dans le référentiel ouvert.
 *
 * `filtreTable` désigne une seconde table intermédiaire portant un contour
 * (celui de la région) : seules les entités qui le recoupent sont versées,
 * **entières**. On ne découpe pas une aire de captage à la frontière
 * régionale — le contour d'une zone réglementaire ne s'arrête pas là où
 * s'arrête l'administration qui l'utilise.
 */
export async function verserTable(
  session: SessionDImport,
  params: {
    table: string;
    kind: ZoneKind;
    /** Colonne portant le code officiel de l'entité. */
    champCode?: string | null;
    /** Colonne portant son nom. */
    champLibelle?: string | null;
    /** Libellé employé quand la source n'en donne aucun. */
    libelleParDefaut: string;
    /** Attributs recopiés. Absent : tous. */
    attributs?: string[];
    filtreTable?: string | null;
  },
): Promise<{ versees: number; ecartees: number }> {
  const table = identifiant(params.table);

  const code = params.champCode
    ? Prisma.sql`NULLIF(btrim(s.${identifiant(params.champCode)}::text), '')`
    : Prisma.sql`NULL`;
  const libelle = params.champLibelle
    ? Prisma.sql`COALESCE(NULLIF(btrim(s.${identifiant(params.champLibelle)}::text), ''), ${params.libelleParDefaut})`
    : Prisma.sql`${params.libelleParDefaut}`;

  const attributs = params.attributs
    ? Prisma.sql`jsonb_strip_nulls(jsonb_build_object(${Prisma.join(
        params.attributs.flatMap((nom) => [
          Prisma.sql`${nom}::text`,
          Prisma.sql`s.${identifiant(nom)}`,
        ]),
      )}))`
    : Prisma.sql`jsonb_strip_nulls(to_jsonb(s) - 'geom' - 'ogc_fid')`;

  const filtre = params.filtreTable
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM ${identifiant(params.filtreTable)} f
        WHERE ST_Intersects(f.geom, s.geom)
      )`
    : Prisma.empty;

  const comptage = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total FROM ${table} s WHERE true ${filtre}
  `;
  const total = Number(comptage[0]?.total ?? 0);

  const versees = await prisma.$executeRaw`
    INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, attributes, created_at)
    SELECT
      'z' || replace(gen_random_uuid()::text, '-', ''),
      ${session.referentialId},
      ${params.kind}::"ZoneKind",
      ${code},
      ${libelle},
      CASE ST_Dimension(g.geom)
        WHEN 2 THEN ST_Multi(ST_CollectionExtract(ST_MakeValid(g.geom), 3))
        WHEN 1 THEN ST_Multi(g.geom)
        ELSE g.geom
      END,
      ${attributs},
      now()
    FROM ${table} s
    CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_Force2D(s.geom), 4326) AS geom) g
    WHERE s.geom IS NOT NULL
      AND NOT ST_IsEmpty(s.geom)
      ${filtre}
  `;

  const ecartees = total - versees;
  session.versees += versees;
  session.ecartees += ecartees;
  if (ecartees > 0) {
    session.avertissements.push(
      `${params.table} : ${ecartees} entité(s) sans géométrie exploitable, écartée(s).`,
    );
  }
  return { versees, ecartees };
}

/** Clôt l'import : la version devient active, et le journal dit ce qui s'est passé. */
export async function cloreImport(
  session: SessionDImport,
  options: { remplaceLesVersionsAnterieures?: boolean; notes?: string[] } = {},
): Promise<void> {
  await finishImport({
    referentialId: session.referentialId,
    importId: session.importId,
    recordCount: session.versees,
    warnings: [...(options.notes ?? []), ...session.avertissements],
    remplaceLesVersionsAnterieures: options.remplaceLesVersionsAnterieures ?? true,
  });
}

/** Signale l'échec de l'import, sans rien laisser croire de plus. */
export async function echouerImport(session: SessionDImport, erreur: unknown): Promise<void> {
  await failImport({
    referentialId: session.referentialId,
    importId: session.importId,
    message: erreur instanceof Error ? erreur.message : String(erreur),
  });
}
