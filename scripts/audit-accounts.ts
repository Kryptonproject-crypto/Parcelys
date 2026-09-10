/**
 * Comptes dont l'audit a besoin, créés s'ils manquent.
 *
 *   npx tsx --conditions=react-server scripts/audit-accounts.ts
 *
 * L'audit ouvre chaque page dans les trois rôles : exploitant, expert
 * agronomique, administration. Le `seed` ne crée que l'exploitant de
 * démonstration — les deux autres, je les avais créés à la main lors d'une
 * session précédente, et l'audit ne passait que parce qu'ils traînaient encore
 * en base. Sur une installation fraîche il s'arrêtait à la connexion de
 * l'expert.
 *
 * Un audit qui dépend d'un état qu'il ne crée pas ne vérifie rien de fiable :
 * il pose donc lui-même ce dont il a besoin, et le refait à l'identique à
 * chaque exécution.
 *
 * Ces comptes n'existent que pour l'audit. Ils portent des adresses en `.test`
 * (TLD réservé par la RFC 2606, jamais routable) et ne sont pas créés si
 * `NODE_ENV=production`.
 */
import './load-env';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';

const MOT_DE_PASSE = 'MotDePasse2026';

const normaliser = (email: string): string => email.trim().toLowerCase();

const COMPTES = {
  expert: {
    email: 'expert@conseil.test',
    firstName: 'Camille',
    lastName: 'Conseil',
    accountType: 'AGRONOMIST' as const,
    isPlatformAdmin: false,
  },
  administration: {
    email: 'administration@parcelys.test',
    firstName: 'Administration',
    lastName: 'Parcelys',
    accountType: 'ADMIN' as const,
    isPlatformAdmin: true,
  },
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '✗ Refus : ces comptes de vérification n’ont rien à faire en production.',
    );
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(MOT_DE_PASSE);

  for (const compte of Object.values(COMPTES)) {
    const emailNormalized = normaliser(compte.email);

    const donnees = {
      email: compte.email,
      emailNormalized,
      passwordHash,
      firstName: compte.firstName,
      lastName: compte.lastName,
      accountType: compte.accountType,
      isPlatformAdmin: compte.isPlatformAdmin,
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      acceptedPrivacyAt: new Date(),
      suspendedAt: null,
    };

    const user = await prisma.user.upsert({
      where: { emailNormalized },
      create: donnees,
      update: donnees,
    });

    console.info(`  ✓ ${user.email} (${compte.accountType})`);
  }

  // L'expert doit avoir au moins une exploitation à suivre, sinon son
  // portefeuille est vide et la page ne prouve rien.
  const expert = await prisma.user.findUniqueOrThrow({
    where: { emailNormalized: normaliser(COMPTES.expert.email) },
    select: { id: true },
  });
  const farm = await prisma.farm.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  if (!farm) {
    console.warn(
      '  ⚠ Aucune exploitation en base : lancez `npm run db:seed` avant l’audit.',
    );
  } else {
    // Une mission de conseil, pas une adhésion : l'expert n'est pas membre de
    // l'exploitation, il y a un accès révocable. C'est le même mécanisme
    // qu'en production.
    // Réactivée si elle existe, créée sinon.
    //
    // Chercher uniquement les missions `ACTIVE` puis créer était un piège :
    // `scripts/check-advisory-flow.mjs` finit par **révoquer** l'accès, c'est
    // même son dernier contrôle. La mission existait donc toujours, mais
    // révoquée ; la recherche ne la trouvait pas, la création butait sur la
    // contrainte d'unicité, et le script s'arrêtait là — laissant l'expert
    // sans exploitation. Toute la suite de l'audit devenait impossible à
    // relancer, avec des erreurs qui ne désignaient pas la cause.
    const mission = await prisma.advisoryEngagement.upsert({
      where: { farmId_expertId: { farmId: farm.id, expertId: expert.id } },
      update: { status: 'ACTIVE', endedAt: null },
      create: { farmId: farm.id, expertId: expert.id },
      select: { status: true },
    });
    console.info(
      `  ✓ mission de conseil sur « ${farm.name} » (${mission.status.toLowerCase()})`,
    );
  }

  console.info(`\n  Mot de passe des deux comptes : ${MOT_DE_PASSE}\n`);
}

main()
  .catch((error) => {
    console.error(
      '✗ Création des comptes d’audit échouée :',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
