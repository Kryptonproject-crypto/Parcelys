/**
 * Efface les données de l'instance en conservant les référentiels.
 *
 *   npm run reset:data -- --confirmer
 *
 * Ce qui DISPARAÎT : comptes, sessions, exploitations, parcelles et
 * géométries, cultures de campagne, registres phytosanitaires et de
 * fertilisation, travaux, relevés météo, documents, préconisations, missions
 * de conseil, codes d'invitation, notifications, journal d'audit, dossiers PAC.
 *
 * Ce qui RESTE :
 *
 *   · le catalogue E-Phy — produits, substances, usages, historique des
 *     synchronisations. Le retélécharger prend du temps et de la bande
 *     passante, et sur une liaison satellite ce n'est pas anodin ;
 *   · le référentiel global — cultures, engrais minéraux et produits
 *     organiques dont `farm_id` est nul. Ce sont les modèles que chaque
 *     nouvelle exploitation recopie à sa création ; les copies rattachées à
 *     une exploitation, elles, partent avec elle ;
 *   · le référentiel des codes culture PAC.
 *
 * Le script REFUSE de s'exécuter sans `--confirmer`, et affiche d'abord ce
 * qu'il s'apprête à supprimer. Prenez une sauvegarde avant : `parcelys-backup`.
 *
 * Lancé avec `--conditions=react-server`, comme les autres scripts qui
 * importent des modules marqués `server-only`.
 */
// En premier : c'est lui qui charge `.env` pour un script hors de Next.
import './load-env';
import { prisma } from '@/lib/prisma';

/**
 * Ordre de suppression : les tables qui référencent viennent avant celles
 * qu'elles référencent. Les clés étrangères sont ainsi respectées sans
 * désactiver les contraintes — ce qui laisserait passer une incohérence.
 */
const A_VIDER = [
  // Conseil agronomique
  'recommendations',
  'advisory_engagements',
  // PAC / TéléPAC — dossiers, jamais le référentiel des codes culture
  'pac_changes',
  'pac_snapshots',
  'pac_imports',
  'pac_features',
  'pac_ilots',
  'pac_campaigns',
  // Registres et suivi cultural
  'documents',
  'weather_records',
  'agricultural_operations',
  'phytosanitary_applications',
  'fertilizer_applications',
  'crop_years',
  'parcel_geometries',
  'parcels',
  // Traces d'exploitation
  'notifications',
  'audit_logs',
  'invitation_codes',
  'idempotency_records',
  // Comptes et accès
  'email_verification_codes',
  'password_reset_tokens',
  'sessions',
  'farm_members',
  'farms',
  'users',
  'rate_limit_counters',
  // Réglages d'instance (maintenance, etc.) : on repart d'une instance neuve
  'app_settings',
] as const;

/**
 * Les référentiels partagés se distinguent par un `farm_id` nul : ce sont les
 * modèles que chaque exploitation recopie. Seules les copies rattachées à une
 * exploitation partent.
 */
const PARTIELLES = ['crops', 'fertilizers', 'organic_inputs'] as const;

/** Tables laissées intactes, et dont on affiche le contenu à la fin. */
const CONSERVEES = [
  'phytosanitary_products',
  'active_substances',
  'product_substances',
  'phyto_usages',
  'ephy_sync_runs',
  'pac_crop_codes',
] as const;

async function compter(table: string, condition = ''): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM "${table}" ${condition}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const confirme = process.argv.includes('--confirmer');

  console.info('\nCe qui va être supprimé :\n');
  let total = 0;
  for (const table of A_VIDER) {
    const n = await compter(table);
    total += n;
    if (n > 0) console.info(`  ${String(n).padStart(7)}  ${table}`);
  }
  for (const table of PARTIELLES) {
    const n = await compter(table, 'WHERE farm_id IS NOT NULL');
    total += n;
    if (n > 0) console.info(`  ${String(n).padStart(7)}  ${table} (copies d'exploitation)`);
  }
  console.info(`\n  ${String(total).padStart(7)}  lignes au total\n`);

  console.info('Ce qui sera conservé :\n');
  for (const table of CONSERVEES) {
    console.info(`  ${String(await compter(table)).padStart(7)}  ${table}`);
  }
  for (const table of PARTIELLES) {
    const n = await compter(table, 'WHERE farm_id IS NULL');
    console.info(`  ${String(n).padStart(7)}  ${table} (référentiel global)`);
  }

  if (!confirme) {
    console.info(
      '\nRien n’a été supprimé.\n' +
        '  Prenez une sauvegarde — sudo parcelys-backup — puis relancez avec :\n' +
        '    npm run reset:data -- --confirmer\n',
    );
    return;
  }

  console.info('\n▸ Suppression…');
  // Une seule transaction : soit tout part, soit rien. Une base à moitié vidée
  // serait pire que les deux états entiers.
  await prisma.$transaction(async (tx) => {
    for (const table of A_VIDER) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    for (const table of PARTIELLES) {
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE farm_id IS NOT NULL`);
    }
  });

  // On vérifie le résultat plutôt que l'absence d'erreur.
  const restants: string[] = [];
  for (const table of A_VIDER) {
    const n = await compter(table);
    if (n > 0) restants.push(`${table} : ${n}`);
  }
  if (restants.length > 0) {
    throw new Error(`Des lignes subsistent : ${restants.join(', ')}`);
  }

  const produits = await compter('phytosanitary_products');
  const cultures = await compter('crops', 'WHERE farm_id IS NULL');

  console.info('  ✓ Données effacées.');
  console.info(`  ✓ Catalogue E-Phy intact : ${produits} produit(s).`);
  console.info(`  ✓ Référentiel global intact : ${cultures} culture(s).`);
  console.info(
    "\nL'instance ne contient plus aucun compte. Créez l'administrateur :\n" +
      '    npm run admin -- creer-admin vous@exemple.fr\n',
  );
}

main()
  .catch((error: unknown) => {
    console.error('\n✗', error instanceof Error ? error.message : error, '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
