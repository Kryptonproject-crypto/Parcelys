/**
 * Vérification des couches réglementaires de la carte.
 *
 * Ce que ce script protège :
 *
 *  · **la provenance ne quitte jamais la couche** — une couche affichée sans
 *    source laisserait croire à une vérité intemporelle, alors qu'un zonage
 *    est daté et révisé ;
 *  · **on ne charge pas le zonage entier** — une région compte des milliers de
 *    polygones, et les envoyer rendrait la carte inutilisable au champ ;
 *  · **les zones lointaines sont écartées**, celles qui recoupent l'emprise
 *    sont gardées.
 *
 *     npm run check:carte
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import { couchesPourExploitation } from '@/lib/regulatory/map-layers';
import { beginImport, finishImport } from '@/lib/regulatory/referentials';

function attendu(condition: boolean, quoi: string) {
  console.info(`${condition ? '✓' : '✗'} ${quoi}`);
  if (!condition) process.exitCode = 1;
}

/** Un carré de `taille` degrés centré sur (lng, lat). */
function carre(lng: number, lat: number, taille: number) {
  const d = taille / 2;
  return {
    type: 'MultiPolygon',
    coordinates: [[[
      [lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d],
      [lng - d, lat + d], [lng - d, lat - d],
    ]]],
  };
}

async function main() {
  const farm = await prisma.farm.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  if (!farm) { console.error('Aucune exploitation. Lancez le seed.'); process.exit(1); }

  const emprise = await prisma.$queryRaw<Array<{ lng: number; lat: number }>>`
    SELECT ST_X(ST_Centroid(ST_Extent(pg.geom)::geometry)) AS lng,
           ST_Y(ST_Centroid(ST_Extent(pg.geom)::geometry)) AS lat
    FROM parcel_geometries pg
    JOIN parcels p ON p.id = pg.parcel_id
    WHERE p.farm_id = ${farm.id} AND p.deleted_at IS NULL AND pg.is_current = true
  `;
  const centre = emprise[0];
  if (!centre?.lng) { console.error('Aucune géométrie de parcelle.'); process.exit(1); }
  console.info(`Exploitation : ${farm.name} · centre ${centre.lng.toFixed(3)}, ${centre.lat.toFixed(3)}`);

  await prisma.regulatoryReferential.deleteMany({ where: { version: 'VERIF-CARTE' } });

  const { referentiel, journal } = await beginImport({
    code: 'zones-vulnerables',
    domain: 'ZONAGE',
    name: 'Zones vulnérables (vérification)',
    territory: 'FR',
    version: 'VERIF-CARTE',
    sourceLabel: 'DREAL de vérification',
  });

  // Une zone sur les parcelles, une zone à 5 degrés de là (~550 km).
  for (const [nom, geom] of [
    ['Zone proche', carre(centre.lng, centre.lat, 0.05)],
    ['Zone lointaine', carre(centre.lng + 5, centre.lat + 5, 0.05)],
  ] as const) {
    await prisma.$executeRaw`
      INSERT INTO regulatory_zones (id, referential_id, kind, code, label, geom, created_at)
      VALUES (
        ${`verif-${nom.replace(/\s/g, '-')}`},
        ${referentiel.id},
        'ZONE_VULNERABLE',
        NULL,
        ${nom},
        ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326::int)),
        NOW()
      )
    `;
  }
  await finishImport({ referentialId: referentiel.id, importId: journal.id, recordCount: 2, warnings: [] });

  const couches = await couchesPourExploitation({ farmId: farm.id });
  const zv = couches.find((c) => c.code === 'zones-vulnerables');

  attendu(Boolean(zv), 'la couche zones vulnérables est proposée');
  attendu(
    zv?.source.label === 'DREAL de vérification' && zv?.source.version === 'VERIF-CARTE',
    `la provenance accompagne la couche : ${zv?.source.label} — ${zv?.source.version}`,
  );
  attendu(zv?.rendues === 1, `seule la zone proche est renvoyée (${zv?.rendues} sur ${zv?.total})`);
  attendu(
    zv?.total === 2 && (zv?.rendues ?? 0) < (zv?.total ?? 0),
    'l’écart entre affiché et total est connu, donc affichable',
  );
  attendu(
    zv?.features[0]?.properties.label === 'Zone proche',
    'c’est bien la zone qui recoupe l’emprise',
  );
  attendu(Boolean(zv?.color), 'la couche porte une couleur stable');

  // Le poids : une couche doit rester transportable au champ.
  const poids = JSON.stringify(zv?.features ?? []).length;
  attendu(poids < 500_000, `poids de la couche : ${(poids / 1024).toFixed(1)} Ko`);

  await prisma.regulatoryReferential.deleteMany({ where: { version: 'VERIF-CARTE' } });

  console.info(process.exitCode ? '\n✗ des vérifications ont échoué' : '\n✓ tout est vérifié sur une vraie base');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
