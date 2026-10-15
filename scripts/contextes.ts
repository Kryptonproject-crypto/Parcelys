/**
 * Met à jour le contexte réglementaire des parcelles qui en ont besoin.
 *
 *   npm run contextes
 *
 * Un contexte n'est recalculé que si ce dont il dépend a changé — contour,
 * commune, référentiels, version du calcul (cf. `getOrComputeParcelContext`).
 * Les autres sont laissés tels quels : relancer la commande ne coûte presque
 * rien.
 *
 * Lancée par la mise à jour du Raspberry Pi, juste après le redémarrage : sans
 * elle, le premier rapport de conformité après une mise à jour qui change le
 * calcul recalculerait toutes les parcelles d'un coup, pendant que
 * l'exploitant attend devant l'écran.
 */
// En premier : c'est lui qui charge `.env` pour un script hors de Next.
import './load-env';
import { prisma } from '@/lib/prisma';
import { getOrComputeParcelContext } from '@/lib/regulatory/geography';

async function main(): Promise<void> {
  const parcelles = await prisma.parcel.findMany({
    where: { deletedAt: null, farm: { deletedAt: null } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const debut = Date.now();
  let echecs = 0;
  for (const [i, parcelle] of parcelles.entries()) {
    // Une à une : en parallèle, les découpes PostGIS mettraient la base à
    // genoux pendant que l'application sert.
    const contexte = await getOrComputeParcelContext(parcelle.id).catch(() => null);
    if (!contexte) echecs += 1;
    if ((i + 1) % 25 === 0) console.info(`  · ${i + 1} / ${parcelles.length}`);
  }

  const secondes = Math.round((Date.now() - debut) / 1000);
  console.info(
    `✓ ${parcelles.length} parcelle(s) vérifiée(s) en ${secondes} s` +
      (echecs ? ` — ${echecs} sans contexte déterminable (contour absent ou invalide)` : ''),
  );
}

main()
  .catch((erreur) => {
    console.error(`✗ ${erreur instanceof Error ? erreur.message : String(erreur)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
