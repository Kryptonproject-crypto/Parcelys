import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { preferencesSchema, profileSchema } from '@/lib/validation/farming';
import { z } from 'zod';

/** GET /api/profile — informations personnelles et préférences. */
export const GET = route(async () => {
  const auth = await requireAuth();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: auth.user.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      locale: true,
      unitSystem: true,
      weatherProvider: true,
      notifyByEmail: true,
      emailVerifiedAt: true,
      createdAt: true,
    },
  });

  return ok({ user, memberships: auth.memberships });
});

const updateSchema = z.object({
  profile: profileSchema.optional(),
  preferences: preferencesSchema.partial().optional(),
});

/** PUT /api/profile — met à jour l'identité et/ou les préférences. */
export const PUT = route(async (request: NextRequest) => {
  const auth = await requireAuth();
  const input = await parseBody(request, updateSchema);

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      ...(input.profile
        ? {
            firstName: input.profile.firstName,
            lastName: input.profile.lastName,
            phone: input.profile.phone ?? null,
          }
        : {}),
      ...(input.preferences
        ? {
            ...(input.preferences.locale ? { locale: input.preferences.locale } : {}),
            ...(input.preferences.unitSystem
              ? { unitSystem: input.preferences.unitSystem }
              : {}),
            ...(input.preferences.notifyByEmail !== undefined
              ? { notifyByEmail: input.preferences.notifyByEmail }
              : {}),
            ...(input.preferences.weatherProvider !== undefined
              ? { weatherProvider: input.preferences.weatherProvider }
              : {}),
          }
        : {}),
    },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      locale: true,
      unitSystem: true,
      weatherProvider: true,
      notifyByEmail: true,
    },
  });

  return ok({ user, message: 'Profil mis à jour' });
});
