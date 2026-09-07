/**
 * Maintenance périodique.
 *
 *   npm run maintenance
 *
 * À planifier quotidiennement (cron, timer systemd). Purge les données
 * temporaires expirées et applique la durée de conservation des journaux,
 * conformément au principe de minimisation du RGPD.
 */
import { prisma } from '@/lib/prisma';
import { purgeExpiredSessions } from '@/lib/auth/session';
import { purgeExpiredCodes } from '@/lib/auth/verification';
import { purgeExpiredRateLimits } from '@/lib/auth/rate-limit';
import { purgeOldAuditLogs } from '@/lib/audit';

const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);

async function main(): Promise<void> {
  console.info('→ Maintenance Parcelys');

  const sessions = await purgeExpiredSessions();
  console.info(`  sessions expirées supprimées      : ${sessions}`);

  const codes = await purgeExpiredCodes();
  console.info(`  codes de vérification purgés      : ${codes}`);

  const rateLimits = await purgeExpiredRateLimits();
  console.info(`  compteurs de débit purgés         : ${rateLimits}`);

  const resetTokens = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
  });
  console.info(`  jetons de réinitialisation purgés : ${resetTokens.count}`);

  const auditLogs = await purgeOldAuditLogs(AUDIT_RETENTION_DAYS);
  console.info(
    `  journaux de plus de ${AUDIT_RETENTION_DAYS} jours supprimés : ${auditLogs}`,
  );

  const notifications = await prisma.notification.deleteMany({
    where: {
      readAt: { not: null, lt: new Date(Date.now() - 90 * 24 * 3600 * 1000) },
    },
  });
  console.info(`  notifications lues archivées      : ${notifications.count}`);

  console.info('✓ Maintenance terminée');
}

main()
  .catch((error) => {
    console.error('✗ Maintenance échouée :', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
