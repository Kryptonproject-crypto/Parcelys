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
// En premier : c'est lui qui charge `.env` pour un script hors de Next.
import './load-env';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { createInvitation } from '@/lib/auth/invitations';
import { invitationStatus } from '@/lib/auth/invitations.shared';
import { hashPassword } from '@/lib/auth/password';
import { passwordSchema } from '@/lib/validation/auth';
import { impliesPlatformAdmin } from '@/lib/auth/accounts';
import type { AccountType, FarmRole } from '@prisma/client';

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

/**
 * Crée un compte d'administration directement, sans passer par l'inscription.
 *
 * C'est le seul chemin vers un administrateur **pur** sur une instance vierge.
 * L'inscription d'amorçage — celle qui s'ouvre quand la base ne contient aucun
 * compte — crée forcément un exploitant avec son exploitation : n'ayant aucun
 * administrateur pour délivrer un code, elle n'en lit aucun, et retombe donc
 * sur le type par défaut. Et « inviter » exige un administrateur en base pour
 * signer le code. Sans cette commande, obtenir un compte d'administration seul
 * demanderait de créer une exploitation dont on ne veut pas, puis de la
 * supprimer.
 *
 * Elle n'ouvre aucun droit nouveau : qui peut la lancer possède déjà
 * `DATABASE_URL` et le serveur.
 */
async function createAdmin(email: string, options: Map<string, string>): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error('Adresse e-mail requise.');

  const existing = await prisma.user.findUnique({
    where: { emailNormalized: normalized },
    select: { id: true },
  });
  if (existing) {
    throw new Error(
      `Un compte existe déjà pour « ${normalized} ». ` +
        'Pour lui donner les droits : npm run admin -- promouvoir ' + normalized,
    );
  }

  // Un mot de passe fourni est vérifié comme à l'inscription ; sinon on en
  // tire un au hasard, plus sûr que ce qui se choisit à la console.
  let password = options.get('mot-de-passe') || '';
  let genere = false;
  if (password) {
    const verdict = passwordSchema.safeParse(password);
    if (!verdict.success) {
      throw new Error(
        'Mot de passe refusé : ' +
          verdict.error.issues.map((i) => i.message).join(', '),
      );
    }
  } else {
    // Base58 : ni O/0 ni I/l, pour un mot de passe qui se dicte et se retape.
    const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const octets = randomBytes(20);
    password =
      'Pa' +
      Array.from(octets, (o) => alphabet[o % alphabet.length]).join('') +
      '7';
    genere = true;
  }

  const now = new Date();
  const user = await prisma.user.create({
    data: {
      email: email.trim(),
      emailNormalized: normalized,
      passwordHash: await hashPassword(password),
      firstName: options.get('prenom') || 'Administration',
      lastName: options.get('nom') || 'Parcelys',
      accountType: 'ADMIN',
      isPlatformAdmin: impliesPlatformAdmin('ADMIN'),
      // Créé depuis la console du serveur : rien à confirmer par e-mail, et le
      // serveur de messagerie n'est pas forcément déjà en place.
      emailVerifiedAt: now,
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
    },
    select: { id: true, email: true },
  });

  console.info(`\n✓ Compte d'administration créé : ${user.email}\n`);
  if (genere) {
    console.info(`    Mot de passe : ${password}\n`);
    console.info("  Il n'est affiché qu'ici : notez-le maintenant.");
    console.info('  Changez-le depuis « Profil » après la première connexion.');
  }
  console.info(
    "\n  Ce compte n'a ni exploitation ni portefeuille : il administre l'instance.",
  );
  console.info('  Connexion : /connexion — il atterrira sur /administration.');
}

async function invite(options: Map<string, string>): Promise<void> {
  const accountType = (options.get('type') || 'FARMER').toUpperCase() as AccountType;
  if (!['FARMER', 'AGRONOMIST', 'ADMIN'].includes(accountType)) {
    throw new Error(`Type de compte inconnu : ${accountType} (FARMER, AGRONOMIST ou ADMIN).`);
  }

  // Ni l'expert ni l'administrateur ne se rattachent à une exploitation.
  const farmId = accountType === 'FARMER' ? options.get('exploitation') || null : null;
  if (accountType !== 'FARMER' && options.get('exploitation')) {
    throw new Error(
      `Un compte ${accountType} ne se rattache pas à une exploitation : ` +
        "l'expert suit celles qui l'y invitent, l'administrateur n'en gère aucune.",
    );
  }
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
    accountType,
    farmId,
    role,
    // Un compte d'administration tire son droit de son type : sans lui, il
    // n'aurait ni parcelles, ni portefeuille, ni écran de gestion.
    grantsPlatformAdmin: impliesPlatformAdmin(accountType),
    email: options.get('email') || null,
    note: options.get('note') || 'Créé en ligne de commande',
    validityDays: Number(options.get('jours') ?? 14),
  });

  const portee =
    accountType === 'AGRONOMIST'
      ? 'compte expert agronomique (sans exploitation)'
      : accountType === 'ADMIN'
        ? "compte d'administration (sans exploitation)"
        : farmId
          ? `exploitation ${farmId} · rôle ${invitation.role}`
          : `nouvelle exploitation · rôle ${invitation.role}`;

  console.info(`✓ Code créé (au nom de ${issuer.email}) :\n`);
  console.info(`    ${code}\n`);
  console.info(`  ${portee}`);
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

  npm run admin -- creer-admin <email> [--prenom X] [--nom Y] [--mot-de-passe "..."]
      Crée un compte d'administration pur — ni exploitation, ni portefeuille.
      Le seul chemin vers un administrateur seul sur une instance vierge :
      l'inscription d'amorçage, elle, crée toujours un exploitant.
      Sans --mot-de-passe, un mot de passe est tiré au hasard et affiché.

  npm run admin -- inviter [--type FARMER|AGRONOMIST|ADMIN]
                           [--exploitation <id>] [--role OWNER|ADMIN|EMPLOYEE|VIEWER]
                           [--email <adresse>] [--jours 14] [--note "..."]
      --type AGRONOMIST pour un expert, --type ADMIN pour un administrateur.
      Ces deux-là ne se rattachent à aucune exploitation.
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
    case 'creer-admin':
      await createAdmin(positional[0] ?? '', options);
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
