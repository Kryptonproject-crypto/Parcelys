import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { ROLE_LABELS } from '@/lib/auth/rbac';
import { requirePageAuth } from '@/lib/auth/page-guards';
import { ProfileForms } from '@/app/(compte)/profil/ProfileForms';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Profil' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const auth = await requirePageAuth();

  const [user, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: auth.user.id },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        locale: true,
        unitSystem: true,
        weatherProvider: true,
        notifyByEmail: true,
        emailVerifiedAt: true,
      },
    }),
    prisma.session.findMany({
      where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Mon profil"
        description="Identité, préférences, sécurité et données personnelles."
      />

      <Card className="mb-5">
        <CardHeader
          title="Mes exploitations"
          description={`${auth.memberships.length} exploitation(s)`}
        />
        <ul className="space-y-2">
          {auth.memberships.map((membership) => (
            <li
              key={membership.farmId}
              // Les pastilles ne se rétrécissent pas, et un nom d'exploitation
              // peut être long : la ligne débordait de 14 px sur un écran de
              // 320 px. Elles passent à la ligne plutôt que de pousser la page,
              // et le nom se coupe entre les mots — le tronquer serait pire, on
              // ne reconnaît pas une exploitation à ses quinze premières
              // lettres.
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line px-3.5 py-2.5"
            >
              <span className="min-w-0 break-words font-medium text-ink">
                {membership.farmName}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {membership.farmId === auth.activeFarmId ? (
                  <Badge tone="green">Active</Badge>
                ) : null}
                <Badge>{ROLE_LABELS[membership.role]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ProfileForms
        user={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          locale: user.locale,
          unitSystem: user.unitSystem,
          weatherProvider: user.weatherProvider,
          notifyByEmail: user.notifyByEmail,
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        }}
        sessions={sessions.map((s) => ({
          id: s.id,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          createdAt: s.createdAt.toISOString(),
          lastUsedAt: s.lastUsedAt.toISOString(),
          current: s.id === auth.sessionId,
        }))}
      />
    </div>
  );
}
