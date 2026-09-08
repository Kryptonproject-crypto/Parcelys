/**
 * Administration en ligne de commande.
 *
 *   npm run admin -- promouvoir camille@exemple.fr
 *   npm run admin -- retrograder camille@exemple.fr
 *   npm run admin -- inviter [--exploitation <id>] [--role EMPLOYEE] [--email x@y.fr]
 *   npm run admin -- lister
 *
 * Filet de sécurité de l'auto-hébergement : l'inscription étant fermée et la
 * section d'administration réservée aux administrateurs, un accès direct au
 * serveur reste le seul moyen de rattraper une instance dont plus personne
 * n'a les droits. Ces commandes exigent un accès au serveur et à
 * `DATABASE_URL` — elles ne sont pas exposées par l'API.
 *
 * Le script est lancé avec `--conditions=react-server` : les modules serveur
 * importés ici sont marqués `server-only`, dont le point d'entrée par défaut
 * lève une erreur. Cette condition résout le marqueur vers son module vide,
 * comme le fait Next lors du rendu serveur.
 */
import { prisma } from '@/lib/prisma';
import { createInvitation } from '@/lib/auth/invitations';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import type { FarmRole } from '@prisma/client';

type Args = { command: string; positional: string[]; options: Map<string, string> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const options = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === undefined) continue;
    if (value.startsWith('--')) {
      options.set(value.slice(2), argv[i + 1] ?? '');
      i += 1;
    } else {
      positional.push(value);
    }
  }

  return { command: positional.shift() ?? 'aide', positional, options };
}

async function findUser(email: string) {
  const user = await prisma.user.findUnique({
    where: { emailNormalized: email.trim().toLowerCase() },
    select: { id: true, email: true, isPlatformAdmin: true, deletedAt: true },
  });
  if (!user) throw new Error(`Aucun compte pour « ${email} ».`);
  if (user.deletedAt) throw new Error(`Le compte « ${email} » est supprimé.`);
  return user;
}

async function promote(email: string, value: boolean): Promise<void> {
  const user = await findUser(email);

  if (!value) {
    const others = await prisma.user.count({
      where: {
        isPlatformAdmin: true,
        deletedAt: null,
        suspendedAt: null,
        id: { not: user.id },
      },
    });
    if (others === 0) {
      throw new Error(
        "Refusé : ce compte est le dernier administrateur de l'instance.",
      );
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isPlatformAdmin: value, suspendedAt: value ? null : undefined },
  });

  console.info(
    value
      ? `✓ ${user.email} est désormais administrateur de l'instance.`
      : `✓ ${user.email} n'est plus administrateur de l'instance.`,
  );
}

async function invite(options: Map<string, string>): Promise<void> {
  const farmId = options.get('exploitation') || null;
  const role = (options.get('role') ?? (farmId ? 'EMPLOYEE' : 'OWNER')) as FarmRole;

  const issuer = await prisma.user.findFirst({
    where: { isPlatformAdmin: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (!issuer) {
    throw new Error(
      "Aucun administrateur en base. Créez d'abord un compte, puis « npm run admin -- promouvoir <email> ».",
    );
  }

  if (farmId) {
    const farm = await prisma.farm.findFirst({
      where: { id: farmId, deletedAt: null },
      select: { name: true },
    });
    if (!farm) throw new Error(`Exploitation « ${farmId} » introuvable.`);
  }

  const { invitation, code } = await createInvitation({
    createdById: issuer.id,
    farmId,
    role,
    email: options.get('email') || null,
    note: options.get('note') || 'Créé en ligne de commande',
    validityDays: Number(options.get('jours') ?? 14),
  });

  console.info(`✓ Code créé (au nom de ${issuer.email}) :\n`);
  console.info(`    ${code}\n`);
  console.info(
    `  Rôle : ${invitation.role} · ${farmId ? `exploitation ${farmId}` : 'nouvelle exploitation'}`,
  );
  console.info(`  Valable jusqu'au ${invitation.expiresAt.toLocaleString('fr-FR')}`);
  console.info('  Ce code ne sera plus jamais affiché : notez-le maintenant.');
}

async function list(): Promise<void> {
  const [admins, invitations] = await Promise.all([
    prisma.user.findMany({
      where: { isPlatformAdmin: true, deletedAt: null },
      select: { email: true, suspendedAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitationCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        codeHint: true,
        role: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    }),
  ]);

  console.info(`→ Administrateurs de l'instance (${admins.length})`);
  for (const admin of admins) {
    console.info(`  ${admin.email}${admin.suspendedAt ? ' (suspendu)' : ''}`);
  }

  console.info(`\n→ Codes d'invitation récents (${invitations.length})`);
  for (const invitation of invitations) {
    console.info(
      `  ${invitation.codeHint}-••••-•••• · ${invitation.role} · ${invitationStatus(invitation)}`,
    );
  }
}

function help(): void {
  console.info(`Administration Parcelys

  npm run admin -- lister
  npm run admin -- promouvoir <email>
  npm run admin -- retrograder <email>
  npm run admin -- inviter [--exploitation <id>] [--role OWNER|ADMIN|EMPLOYEE|VIEWER]
                           [--email <adresse>] [--jours 14] [--note "..."]
`);
}

async function main(): Promise<void> {
  const { command, positional, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'promouvoir':
      await promote(positional[0] ?? '', true);
      break;
    case 'retrograder':
      await promote(positional[0] ?? '', false);
      break;
    case 'inviter':
      await invite(options);
      break;
    case 'lister':
      await list();
      break;
    default:
      help();
  }
}

main()
  .catch((error: unknown) => {
    console.error('✗', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
