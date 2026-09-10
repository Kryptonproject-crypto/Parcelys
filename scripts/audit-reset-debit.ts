/**
 * Remet à zéro les compteurs de limitation de débit.
 *
 * À n'employer que pour enchaîner les contrôles d'audit. Chacun se connecte
 * plusieurs fois, et la limitation — qui fait bien son travail — finit par
 * couper les suivants. Le symptôme est trompeur : un délai d'attente sur
 * « navigation vers /dashboard », qui ne dit rien de la cause.
 *
 * Ce n'est pas une commande d'exploitation. Sur une instance en service, vider
 * ces compteurs annulerait la protection contre les essais de mots de passe en
 * série.
 *
 *     npm run audit:debit
 */
import './load-env';
import { prisma } from '@/lib/prisma';

async function main() {
  const { count } = await prisma.rateLimitCounter.deleteMany({});
  console.info(`  ✓ ${count} compteur(s) de débit remis à zéro`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('✗', error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
