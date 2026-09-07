import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, route } from '@/lib/api/handler';
import { logAudit } from '@/lib/audit';

/**
 * GET /api/account/export — export des données personnelles (RGPD, art. 15 & 20).
 *
 * Contient les données du compte, ses appartenances et l'ensemble des données
 * agronomiques des exploitations dont l'utilisateur est membre, au format JSON
 * lisible et réutilisable.
 */
export const GET = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  await enforceRateLimit(`gdpr-export:${auth.user.id}`, {
    limit: 3,
    windowSeconds: 3600,
  });

  const farmIds = auth.memberships.map((m) => m.farmId);

  const [user, farms, parcels, notifications, sessions, auditLogs] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        locale: true,
        unitSystem: true,
        notifyByEmail: true,
        emailVerifiedAt: true,
        acceptedTermsAt: true,
        acceptedPrivacyAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.farm.findMany({
      where: { id: { in: farmIds } },
      include: {
        members: {
          include: {
            user: { select: { email: true, firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.parcel.findMany({
      where: { farmId: { in: farmIds } },
      include: {
        cropYears: { include: { crop: true } },
        fertilizations: true,
        phytoTreatments: true,
        operations: true,
        documents: {
          select: {
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            category: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.notification.findMany({ where: { userId: auth.user.id } }),
    prisma.session.findMany({
      where: { userId: auth.user.id },
      select: {
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ipAddress: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    application: 'Parcelys',
    notice:
      'Export des données personnelles et agronomiques associées à votre compte, ' +
      'conformément aux articles 15 et 20 du RGPD. Les fichiers joints aux parcelles ' +
      'ne sont pas inclus dans ce JSON : ils restent téléchargeables individuellement.',
    user,
    memberships: auth.memberships,
    farms,
    parcels,
    notifications,
    sessions,
    auditLogs,
  };

  await logAudit({
    action: 'account.data_exported',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    metadata: { farms: farms.length, parcels: parcels.length },
  });

  const body = JSON.stringify(payload, null, 2);

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="parcelys-donnees-personnelles-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
