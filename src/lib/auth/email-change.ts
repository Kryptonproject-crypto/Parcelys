import 'server-only';
import { prisma } from '@/lib/prisma';
import { generateNumericCode, hashToken, safeEqual } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email';
import { emailChangeCodeEmail, securityAlertEmail } from '@/lib/email/templates';
import { ApiError } from '@/lib/api/errors';
import { CODE_TTL_MINUTES, MAX_CODE_ATTEMPTS } from '@/lib/auth/verification';

/**
 * Changement d'adresse e-mail, en deux temps.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI DEUX TEMPS, ET PAS UN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * L'adresse e-mail n'est pas un champ de profil comme un autre : c'est
 * l'identifiant de connexion, et c'est là qu'arrivent les liens de
 * réinitialisation de mot de passe. La modifier sans vérification donnerait à
 * quiconque passe devant un écran resté ouvert le moyen de s'approprier le
 * compte définitivement — il suffirait ensuite de demander un mot de passe
 * oublié.
 *
 * D'où la marche suivie ici :
 *
 *   1. l'utilisateur redonne son mot de passe — une session ouverte ne suffit
 *      pas à prouver que c'est bien lui ;
 *   2. un code part vers la **nouvelle** adresse, la seule façon de prouver
 *      qu'il la contrôle ; l'ancienne est prévenue en même temps, ce qui donne
 *      au propriétaire légitime le moyen de s'apercevoir d'un détournement ;
 *   3. l'adresse ne change qu'une fois le code saisi.
 *
 * Tant que le code n'est pas saisi, la nouvelle adresse n'existe nulle part
 * ailleurs que dans le code en attente : le compte reste joignable à l'ancienne.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI EST DÉLIBÉRÉMENT RÉUTILISÉ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le modèle `EmailVerificationCode` porte déjà `purpose`, `attempts`,
 * `expiresAt` et `consumedAt`, et l'énumération déclarait `EMAIL_CHANGE` depuis
 * le début — sans que rien ne l'utilise. Les durées et le plafond de tentatives
 * sont ceux de la vérification d'inscription : deux barèmes différents pour la
 * même mécanique finiraient par diverger, et c'est toujours le moins strict qui
 * l'emporterait.
 */

/**
 * Délai avant de pouvoir redemander un code.
 *
 * Sans lui, le bouton « renvoyer » devient un moyen d'inonder une adresse qui
 * n'est pas la sienne : il suffit de saisir celle de quelqu'un d'autre et de
 * cliquer. La limitation de débit de la route protège le compte ; ce délai-ci
 * protège le destinataire.
 */
export const RENVOI_DELAI_SECONDES = 60;

export type DemandeChangement = {
  /** Adresse visée, telle qu'elle sera affichée à l'utilisateur. */
  nouvelleAdresse: string;
  expireDans: number;
  /** Secondes à attendre avant de pouvoir redemander un code. */
  renvoiPossibleDans: number;
};

function erreurGenerique(): ApiError {
  return new ApiError(
    400,
    'Code invalide ou expiré. Demandez un nouveau code si nécessaire.',
    'INVALID_CODE',
  );
}

/**
 * Émet un code vers la nouvelle adresse et prévient l'ancienne.
 *
 * L'appelant a déjà vérifié le mot de passe : cette fonction ne s'en charge pas,
 * pour que la réauthentification reste visible dans la route plutôt que cachée
 * ici.
 */
export async function demanderChangementEmail(params: {
  userId: string;
  nouvelleAdresse: string;
}): Promise<DemandeChangement> {
  const nouvelle = params.nouvelleAdresse.trim();
  const normalisee = nouvelle.toLowerCase();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { id: true, email: true, emailNormalized: true, firstName: true },
  });

  if (normalisee === user.emailNormalized) {
    throw new ApiError(
      400,
      'Cette adresse est déjà celle de votre compte.',
      'SAME_EMAIL',
    );
  }

  // Une adresse déjà prise est refusée tout de suite plutôt qu'au moment de la
  // confirmation : laisser l'utilisateur aller chercher un code dans une boîte
  // pour lui annoncer ensuite que c'était perdu d'avance serait une perte de
  // temps gratuite.
  //
  // Cela révèle qu'un compte existe à cette adresse. C'est assumé : la personne
  // est authentifiée et a redonné son mot de passe, elle n'apprend pas grand
  // chose qu'un formulaire d'inscription ne lui apprendrait — et l'alternative,
  // un échec tardif et opaque, coûte plus qu'elle ne protège.
  const occupee = await prisma.user.findUnique({
    where: { emailNormalized: normalisee },
    select: { id: true },
  });
  if (occupee) {
    throw new ApiError(
      409,
      'Cette adresse est déjà utilisée par un autre compte.',
      'EMAIL_TAKEN',
    );
  }

  // Le délai de renvoi se mesure sur le dernier code encore valide.
  const dernier = await prisma.emailVerificationCode.findFirst({
    where: { userId: user.id, purpose: 'EMAIL_CHANGE', consumedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (dernier) {
    const ecoule = (Date.now() - dernier.createdAt.getTime()) / 1000;
    if (ecoule < RENVOI_DELAI_SECONDES) {
      const reste = Math.ceil(RENVOI_DELAI_SECONDES - ecoule);
      throw new ApiError(
        429,
        `Un code vient d’être envoyé. Attendez ${reste} seconde${reste > 1 ? 's' : ''} ` +
          'avant d’en demander un autre.',
        'RESEND_TOO_SOON',
      );
    }
  }

  const code = generateNumericCode(6);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await prisma.$transaction([
    // Un seul code actif à la fois : un ancien code encore valide permettrait
    // de confirmer une adresse que l'utilisateur a justement corrigée depuis.
    prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, purpose: 'EMAIL_CHANGE', consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        // C'est la **nouvelle** adresse qui est stockée : c'est elle que le code
        // valide, et c'est d'elle qu'on aura besoin à la confirmation.
        email: nouvelle,
        codeHash: hashToken(code),
        purpose: 'EMAIL_CHANGE',
        expiresAt,
      },
    }),
  ]);

  await sendEmail(
    emailChangeCodeEmail({
      to: nouvelle,
      firstName: user.firstName,
      code,
      ancienneAdresse: user.email,
      expiresInMinutes: CODE_TTL_MINUTES,
    }),
  );

  // L'ancienne adresse est prévenue sans attendre la confirmation : si la
  // demande vient de quelqu'un d'autre, c'est maintenant qu'il faut que le
  // propriétaire l'apprenne, pas une fois le compte perdu.
  await sendEmail(
    securityAlertEmail({
      to: user.email,
      firstName: user.firstName,
      event: 'Demande de changement d’adresse',
      detail:
        `Une demande de changement d’adresse vers « ${nouvelle} » a été faite sur votre ` +
        'compte Parcelys. Elle ne prendra effet que si le code envoyé à cette adresse est ' +
        'saisi. Si vous n’êtes pas à l’origine de cette demande, changez votre mot de passe ' +
        'immédiatement : quelqu’un connaît le vôtre.',
    }),
  );

  return {
    nouvelleAdresse: nouvelle,
    expireDans: CODE_TTL_MINUTES * 60,
    renvoiPossibleDans: RENVOI_DELAI_SECONDES,
  };
}

/** La demande en cours, pour que l'interface sache quoi afficher au retour. */
export async function changementEnAttente(
  userId: string,
): Promise<{ nouvelleAdresse: string; expireLe: Date } | null> {
  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      userId,
      purpose: 'EMAIL_CHANGE',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: { email: true, expiresAt: true },
  });
  return record ? { nouvelleAdresse: record.email, expireLe: record.expiresAt } : null;
}

/** Abandonne la demande en cours. */
export async function annulerChangementEmail(userId: string): Promise<boolean> {
  const { count } = await prisma.emailVerificationCode.updateMany({
    where: { userId, purpose: 'EMAIL_CHANGE', consumedAt: null },
    data: { consumedAt: new Date() },
  });
  return count > 0;
}

export type ConfirmationChangement = {
  ancienneAdresse: string;
  nouvelleAdresse: string;
};

/**
 * Confirme le changement à l'aide du code reçu.
 *
 * Le contrôle d'unicité est refait ici : entre la demande et la confirmation,
 * quelqu'un d'autre a pu créer un compte à cette adresse. Un quart d'heure
 * suffit largement, et l'écriture échouerait alors sur la contrainte d'unicité,
 * avec un message venu de PostgreSQL.
 */
export async function confirmerChangementEmail(params: {
  userId: string;
  code: string;
}): Promise<ConfirmationChangement> {
  const record = await prisma.emailVerificationCode.findFirst({
    where: { userId: params.userId, purpose: 'EMAIL_CHANGE', consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) throw erreurGenerique();

  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new ApiError(400, 'Ce code a expiré. Demandez un nouveau code.', 'CODE_EXPIRED');
  }

  if (record.attempts >= MAX_CODE_ATTEMPTS) {
    throw new ApiError(
      429,
      'Trop de tentatives sur ce code. Demandez un nouveau code.',
      'TOO_MANY_ATTEMPTS',
    );
  }

  if (!safeEqual(record.codeHash, hashToken(params.code))) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    const reste = MAX_CODE_ATTEMPTS - record.attempts - 1;
    throw new ApiError(
      400,
      reste > 0
        ? `Code incorrect. Il vous reste ${reste} tentative${reste > 1 ? 's' : ''}.`
        : 'Code incorrect. Demandez un nouveau code.',
      'INVALID_CODE',
    );
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { email: true },
  });

  const normalisee = record.email.trim().toLowerCase();
  const occupee = await prisma.user.findUnique({
    where: { emailNormalized: normalisee },
    select: { id: true },
  });
  if (occupee && occupee.id !== params.userId) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new ApiError(
      409,
      'Cette adresse a été prise entre-temps par un autre compte. ' +
        'Votre adresse n’a pas été modifiée.',
      'EMAIL_TAKEN',
    );
  }

  await prisma.$transaction([
    prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: params.userId },
      data: {
        email: record.email.trim(),
        emailNormalized: normalisee,
        // L'adresse vient d'être prouvée par le code : la redemander en
        // vérification serait redondant, et laisserait le compte en attente
        // sans raison.
        emailVerifiedAt: new Date(),
      },
    }),
  ]);

  return { ancienneAdresse: user.email, nouvelleAdresse: record.email.trim() };
}
