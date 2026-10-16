import 'server-only';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma, SupportIdentity, SupportTicketStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ApiError, badRequest, conflict, notFound } from '@/lib/api/errors';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { sendEmail } from '@/lib/email';
import { notificationEmail } from '@/lib/email/templates';
import {
  deleteDocument,
  readDocument,
  storeDocument,
  validateUpload,
  type ValidatedFile,
} from '@/lib/storage/documents';
import { responsableDuPortefeuille } from '@/lib/admin/portefeuilles';
import { portfolioInScope, ticketScope, type AdminScope } from '@/lib/admin/scope';
import { lireNumero } from '@/lib/shared/numeros';
import { LIBELLES_STATUT, PIECE_JOINTE, type StatutDemande } from '@/lib/shared/support';
import { ADMIN_PAGE_SIZE, type AdminPage } from '@/lib/admin/shared';

/**
 * Demandes de support.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUI VOIT UNE DEMANDE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   · le demandeur — par sa session s'il est connecté, par le lien reçu à son
 *     adresse s'il ne l'est pas ;
 *   · les administrateurs du portefeuille du client concerné ;
 *   · les administrateurs généraux, qui voient tout.
 *
 * Le portefeuille et l'administrateur responsable sont résolus **ici**, côté
 * serveur, à partir de la session (client vérifié) ou du numéro déclaré
 * (visiteur anonyme, identité non vérifiée). Le navigateur ne choisit jamais
 * qui lira sa demande.
 *
 * Les notes internes ne sortent jamais vers le demandeur, ni par l'API, ni par
 * e-mail. Les e-mails au demandeur ne contiennent jamais le contenu de la
 * réponse — seulement le lien pour la lire.
 */

/** Durée de validité d'un lien de suivi anonyme. */
const DUREE_LIEN_JOURS = 90;

// ---------------------------------------------------------------------------
// Lecture de la requête et pièce jointe
// ---------------------------------------------------------------------------

export type FormulaireDemande = {
  champs: Record<string, string>;
  fichier: File | null;
};

/**
 * Lit un formulaire `multipart/form-data` (avec pièce jointe) ou un corps
 * JSON. La taille annoncée est vérifiée avant toute lecture : un envoi de
 * plusieurs centaines de mégaoctets est refusé sans être chargé en mémoire.
 */
export async function lireFormulaire(request: NextRequest): Promise<FormulaireDemande> {
  const annonce = Number(request.headers.get('content-length') ?? '0');
  if (annonce > PIECE_JOINTE.maxOctets + 128 * 1024) {
    throw badRequest('Pièce jointe trop volumineuse : 5 Mo au maximum.');
  }

  const type = request.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('Formulaire illisible.');
    }
    const champs: Record<string, string> = {};
    let fichier: File | null = null;
    for (const [cle, valeur] of form.entries()) {
      if (typeof valeur === 'string') {
        champs[cle] = valeur;
      } else if (cle === 'piece' && valeur.size > 0) {
        if (fichier) throw badRequest('Une seule pièce jointe par message.');
        fichier = valeur;
      }
    }
    return { champs, fichier };
  }

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    throw badRequest('Corps de requête JSON invalide');
  }
  const champs: Record<string, string> = {};
  if (corps && typeof corps === 'object') {
    for (const [cle, valeur] of Object.entries(corps as Record<string, unknown>)) {
      if (typeof valeur === 'string') champs[cle] = valeur;
      else if (typeof valeur === 'boolean' || typeof valeur === 'number') champs[cle] = String(valeur);
    }
  }
  return { champs, fichier: null };
}

/**
 * Contrôle d'une pièce jointe : liste courte d'extensions, 5 Mo, puis la
 * validation commune du site (type déclaré cohérent avec l'extension,
 * signature binaire réelle, nom assaini).
 */
export async function validerPieceJointe(fichier: File): Promise<ValidatedFile> {
  const extension = path.extname(fichier.name).toLowerCase();
  if (!(PIECE_JOINTE.extensions as readonly string[]).includes(extension)) {
    throw badRequest(
      `Format non accepté. Formats acceptés : ${PIECE_JOINTE.extensions.join(', ')}.`,
    );
  }
  if (fichier.size > PIECE_JOINTE.maxOctets) {
    throw badRequest('Pièce jointe trop volumineuse : 5 Mo au maximum.');
  }
  const buffer = Buffer.from(await fichier.arrayBuffer());
  return validateUpload({ fileName: fichier.name, mimeType: fichier.type, buffer });
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export type Demandeur =
  | {
      kind: 'account';
      userId: string;
      name: string;
      email: string;
      /** Exploitation choisie parmi celles du compte (vérifiée par l'appelant). */
      farmId: string | null;
      /** Le compte est-il un technicien ? Il est alors lui-même le client. */
      technicianId: string | null;
    }
  | { kind: 'anonymous'; name: string; email: string; declaredNumber: string | null };

type ClientResolu = {
  farmId: string | null;
  technicianId: string | null;
  portfolioId: string | null;
  declaredNumber: string | null;
};

async function resoudreClient(demandeur: Demandeur): Promise<ClientResolu> {
  if (demandeur.kind === 'account') {
    if (demandeur.farmId) {
      const farm = await prisma.farm.findUnique({
        where: { id: demandeur.farmId },
        select: { portfolioId: true, customerNumber: true },
      });
      return {
        farmId: demandeur.farmId,
        technicianId: null,
        portfolioId: farm?.portfolioId ?? null,
        declaredNumber: farm?.customerNumber ?? null,
      };
    }
    if (demandeur.technicianId) {
      const technician = await prisma.user.findUnique({
        where: { id: demandeur.technicianId },
        select: { portfolioId: true, technicianNumber: true },
      });
      return {
        farmId: null,
        technicianId: demandeur.technicianId,
        portfolioId: technician?.portfolioId ?? null,
        declaredNumber: technician?.technicianNumber ?? null,
      };
    }
    return { farmId: null, technicianId: null, portfolioId: null, declaredNumber: null };
  }

  // Visiteur anonyme : le numéro déclaré sert à **acheminer** la demande vers
  // le bon administrateur, jamais à prouver une identité. La réponse faite au
  // visiteur est la même que le numéro existe ou non — le formulaire n'est pas
  // un moyen de tester des numéros.
  const numero = lireNumero(demandeur.declaredNumber);
  const declaredNumber = numero?.numero ?? (demandeur.declaredNumber?.trim().slice(0, 24) || null);
  if (numero?.prefixe === 'EXP') {
    const farm = await prisma.farm.findFirst({
      where: { customerNumber: numero.numero, deletedAt: null },
      select: { id: true, portfolioId: true },
    });
    if (farm) return { farmId: farm.id, technicianId: null, portfolioId: farm.portfolioId, declaredNumber };
  }
  if (numero?.prefixe === 'TEC') {
    const technician = await prisma.user.findFirst({
      where: { technicianNumber: numero.numero, deletedAt: null },
      select: { id: true, portfolioId: true },
    });
    if (technician) {
      return {
        farmId: null,
        technicianId: technician.id,
        portfolioId: technician.portfolioId,
        declaredNumber,
      };
    }
  }
  return { farmId: null, technicianId: null, portfolioId: null, declaredNumber };
}

/**
 * Les administrateurs à prévenir d'une demande : le responsable s'il y en a
 * un, sinon les gestionnaires actifs du portefeuille, sinon les
 * administrateurs généraux. Jamais quelqu'un qui ne pourrait pas la lire.
 */
async function administrateursAPrevenir(ticket: {
  assigneeId: string | null;
  portfolioId: string | null;
}): Promise<string[]> {
  if (ticket.assigneeId) return [ticket.assigneeId];
  if (ticket.portfolioId) {
    const managers = await prisma.portfolioManager.findMany({
      where: {
        portfolioId: ticket.portfolioId,
        user: { isSecondaryAdmin: true, suspendedAt: null, deletedAt: null },
      },
      select: { userId: true },
    });
    if (managers.length > 0) return managers.map((m) => m.userId);
  }
  const generaux = await prisma.user.findMany({
    where: { isPlatformAdmin: true, suspendedAt: null, deletedAt: null },
    select: { id: true },
  });
  return generaux.map((g) => g.id);
}

async function prevenirAdministrateurs(
  ticket: { id: string; number: string | null; subject: string; assigneeId: string | null; portfolioId: string | null },
  titre: string,
): Promise<void> {
  const destinataires = await administrateursAPrevenir(ticket);
  for (const userId of destinataires) {
    await createNotification({
      userId,
      type: 'SUPPORT',
      title: `${titre} — ${ticket.number ?? 'demande'}`,
      // Le sujet seulement : le détail se lit dans l'administration, derrière
      // le contrôle d'accès, pas dans une boîte aux lettres.
      body: ticket.subject,
      link: `/administration/support/${ticket.id}`,
      alsoEmail: true,
    });
  }
}

/** Émet un nouveau lien de suivi (l'ancien cesse de fonctionner) et le rend en clair. */
async function nouveauLienDeSuivi(
  ticketId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const token = generateToken(32);
  await tx.supportTicket.update({
    where: { id: ticketId },
    data: {
      accessTokenHash: hashToken(token),
      accessTokenExpiresAt: new Date(Date.now() + DUREE_LIEN_JOURS * 24 * 3600 * 1000),
    },
  });
  return token;
}

async function ecrireAuDemandeurAnonyme(params: {
  to: string;
  name: string;
  ticketId: string;
  title: string;
  body: string;
}): Promise<void> {
  const token = await nouveauLienDeSuivi(params.ticketId);
  await sendEmail(
    notificationEmail({
      to: params.to,
      firstName: params.name,
      title: params.title,
      body:
        `${params.body} Ce lien est personnel, valable ${DUREE_LIEN_JOURS} jours ; ` +
        'ne le transmettez à personne. Chaque nouvel e-mail remplace le lien précédent.',
      link: `/contact/suivi/${token}`,
    }),
  );
}

export async function creerDemande(params: {
  demandeur: Demandeur;
  subject: string;
  description: string;
  area: string | null;
  piece: ValidatedFile | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ id: string; number: string }> {
  const { demandeur } = params;
  const client = await resoudreClient(demandeur);
  const assigneeId = await responsableDuPortefeuille(client.portfolioId);
  const identity: SupportIdentity = demandeur.kind === 'account' ? 'ACCOUNT' : 'UNVERIFIED';

  // Le fichier est écrit avant la transaction, sous l'identifiant de la future
  // demande : si la transaction échoue, on l'efface — jamais de ligne qui
  // pointerait vers un fichier absent.
  const ticketId = randomUUID();
  const storageKey = params.piece ? await storeDocument(`support/${ticketId}`, params.piece) : null;

  let ticket: { id: string; number: string | null; subject: string; assigneeId: string | null; portfolioId: string | null };
  try {
    ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          id: ticketId,
          subject: params.subject,
          description: params.description,
          area: params.area,
          requesterId: demandeur.kind === 'account' ? demandeur.userId : null,
          requesterName: demandeur.name,
          requesterEmail: demandeur.email.trim().toLowerCase(),
          identity,
          declaredNumber: client.declaredNumber,
          farmId: client.farmId,
          technicianId: client.technicianId,
          portfolioId: client.portfolioId,
          assigneeId,
        },
        select: { id: true, number: true, subject: true, assigneeId: true, portfolioId: true },
      });
      await tx.supportTicketEvent.create({
        data: {
          ticketId: created.id,
          actorId: demandeur.kind === 'account' ? demandeur.userId : null,
          kind: 'CREATED',
          toValue: 'NEW',
        },
      });
      if (params.piece && storageKey) {
        await tx.supportAttachment.create({
          data: {
            ticketId: created.id,
            fileName: params.piece.fileName,
            storageKey,
            mimeType: params.piece.mimeType,
            sizeBytes: params.piece.sizeBytes,
            checksum: params.piece.checksum,
            uploadedById: demandeur.kind === 'account' ? demandeur.userId : null,
          },
        });
      }
      return created;
    });
  } catch (error) {
    if (storageKey) await deleteDocument(storageKey).catch(() => undefined);
    throw error;
  }

  const number = ticket.number ?? '';

  await logAudit({
    action: 'support.ticket_created',
    userId: demandeur.kind === 'account' ? demandeur.userId : null,
    farmId: client.farmId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      number,
      identity,
      portfolioId: client.portfolioId,
      assigneeId,
      attachment: Boolean(params.piece),
    },
  });

  await prevenirAdministrateurs(ticket, 'Nouvelle demande de support');

  if (demandeur.kind === 'anonymous') {
    await ecrireAuDemandeurAnonyme({
      to: demandeur.email,
      name: demandeur.name,
      ticketId: ticket.id,
      title: `Votre demande ${number} est enregistrée`,
      body:
        'Nous avons bien reçu votre message. Ouvrez le lien ci-dessous pour confirmer ' +
        'votre adresse et suivre la demande : nous ne communiquons aucune donnée ' +
        'de compte tant que votre identité n’est pas vérifiée.',
    });
  }

  return { id: ticket.id, number };
}

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------

export type TicketMessageView = {
  id: string;
  authorKind: 'REQUESTER' | 'STAFF';
  /** Pour le demandeur : « Équipe Parcelys » ; pour l'administration : le nom. */
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
  attachments: TicketAttachmentView[];
};

export type TicketAttachmentView = {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
};

export type TicketEventView = {
  id: string;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
  actorName: string | null;
  createdAt: string;
};

export type RequesterTicketView = {
  id: string;
  number: string;
  subject: string;
  description: string;
  area: string | null;
  status: StatutDemande;
  declaredNumber: string | null;
  createdAt: string;
  lastActivityAt: string;
  initialAttachments: TicketAttachmentView[];
  messages: TicketMessageView[];
};

export type AdminTicketView = RequesterTicketView & {
  identity: SupportIdentity;
  requesterName: string;
  requesterEmail: string;
  requesterId: string | null;
  farm: { id: string; name: string; customerNumber: string | null } | null;
  technician: { id: string; name: string; technicianNumber: string | null } | null;
  /** Le client concerné existe mais n'est pas dans le périmètre de qui regarde. */
  clientOutOfScope: boolean;
  /** Adresse confirmée identique à celle d'un compte du client concerné. */
  emailMatchesClient: boolean;
  portfolio: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  events: TicketEventView[];
  /** Administrateurs à qui la demande peut être attribuée. */
  assignableAdmins: Array<{ id: string; name: string }>;
};

const vuePiece = (a: {
  id: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}): TicketAttachmentView => ({
  id: a.id,
  fileName: a.fileName,
  sizeBytes: a.sizeBytes,
  mimeType: a.mimeType,
  createdAt: a.createdAt.toISOString(),
});

const includeConversation = {
  messages: {
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { firstName: true, lastName: true } },
      attachments: { orderBy: { createdAt: 'asc' } },
    },
  },
  attachments: { where: { messageId: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SupportTicketInclude;

type TicketAvecConversation = Prisma.SupportTicketGetPayload<{ include: typeof includeConversation }>;

function vueDemandeur(ticket: TicketAvecConversation): RequesterTicketView {
  return {
    id: ticket.id,
    number: ticket.number ?? '',
    subject: ticket.subject,
    description: ticket.description,
    area: ticket.area,
    status: ticket.status,
    declaredNumber: ticket.declaredNumber,
    createdAt: ticket.createdAt.toISOString(),
    lastActivityAt: ticket.lastActivityAt.toISOString(),
    initialAttachments: ticket.attachments.map(vuePiece),
    // Les notes internes ne quittent jamais l'administration.
    messages: ticket.messages
      .filter((m) => !m.internal)
      .map((m) => ({
        id: m.id,
        authorKind: m.authorKind,
        authorName: m.authorKind === 'STAFF' ? 'Équipe Parcelys' : ticket.requesterName,
        body: m.body,
        internal: false,
        createdAt: m.createdAt.toISOString(),
        attachments: m.attachments.map(vuePiece),
      })),
  };
}

// ---------------------------------------------------------------------------
// Côté demandeur connecté
// ---------------------------------------------------------------------------

export async function listerMesDemandes(userId: string) {
  const tickets = await prisma.supportTicket.findMany({
    where: { requesterId: userId },
    orderBy: { lastActivityAt: 'desc' },
    take: 100,
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      createdAt: true,
      lastActivityAt: true,
      declaredNumber: true,
    },
  });
  return tickets.map((t) => ({
    id: t.id,
    number: t.number ?? '',
    subject: t.subject,
    status: t.status as StatutDemande,
    declaredNumber: t.declaredNumber,
    createdAt: t.createdAt.toISOString(),
    lastActivityAt: t.lastActivityAt.toISOString(),
  }));
}

/** La demande d'un compte, ou 404 — y compris pour la demande d'un autre. */
export async function chargerMaDemande(userId: string, ticketId: string): Promise<RequesterTicketView> {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, requesterId: userId },
    include: includeConversation,
  });
  if (!ticket) throw notFound('Demande introuvable');
  return vueDemandeur(ticket);
}

// ---------------------------------------------------------------------------
// Côté demandeur anonyme (lien de suivi)
// ---------------------------------------------------------------------------

async function ticketParLien(token: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: includeConversation,
  });
  if (!ticket || !ticket.accessTokenExpiresAt || ticket.accessTokenExpiresAt < new Date()) {
    // Lien inconnu, expiré ou remplacé : une seule réponse pour les trois.
    throw notFound('Lien de suivi invalide ou expiré.');
  }
  return ticket;
}

export async function chargerDemandeParLien(token: string): Promise<RequesterTicketView & {
  identity: SupportIdentity;
}> {
  const ticket = await ticketParLien(token);
  return { ...vueDemandeur(ticket), identity: ticket.identity };
}

/**
 * Le visiteur confirme, depuis le lien reçu, que l'adresse est la sienne.
 * C'est un clic explicite (POST) et non la simple ouverture du lien : les
 * antivirus de messagerie ouvrent les liens tout seuls.
 */
export async function confirmerParLien(token: string, ip: string | null): Promise<void> {
  const ticket = await ticketParLien(token);
  if (ticket.identity !== 'UNVERIFIED') return;
  await prisma.$transaction([
    prisma.supportTicket.update({ where: { id: ticket.id }, data: { identity: 'EMAIL_CONFIRMED' } }),
    prisma.supportTicketEvent.create({
      data: { ticketId: ticket.id, kind: 'IDENTITY_CONFIRMED', fromValue: 'UNVERIFIED', toValue: 'EMAIL_CONFIRMED' },
    }),
  ]);
  await logAudit({
    action: 'support.identity_confirmed',
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: ip,
    metadata: { number: ticket.number },
  });
}

export async function ticketIdParLien(token: string): Promise<string> {
  return (await ticketParLien(token)).id;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Réponse du demandeur (connecté ou par lien). Une demande fermée ne se
 * rouvre pas par un message — on en ouvre une nouvelle ; une demande résolue
 * ou en attente du client repasse en cours.
 */
export async function repondreDemandeur(params: {
  ticketId: string;
  userId: string | null;
  body: string;
  piece: ValidatedFile | null;
  ipAddress: string | null;
  viaLien: boolean;
}): Promise<void> {
  const ticket = await prisma.supportTicket.findUniqueOrThrow({
    where: { id: params.ticketId },
    select: { id: true, number: true, subject: true, status: true, identity: true, assigneeId: true, portfolioId: true },
  });
  if (ticket.status === 'CLOSED') {
    throw conflict('Cette demande est fermée. Ouvrez-en une nouvelle depuis la page Contact.');
  }

  const storageKey = params.piece ? await storeDocument(`support/${ticket.id}`, params.piece) : null;
  try {
    await prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorId: params.userId,
          authorKind: 'REQUESTER',
          body: params.body,
        },
      });
      if (params.piece && storageKey) {
        await tx.supportAttachment.create({
          data: {
            ticketId: ticket.id,
            messageId: message.id,
            fileName: params.piece.fileName,
            storageKey,
            mimeType: params.piece.mimeType,
            sizeBytes: params.piece.sizeBytes,
            checksum: params.piece.checksum,
            uploadedById: params.userId,
          },
        });
      }
      const reprise = ticket.status === 'WAITING_CUSTOMER' || ticket.status === 'RESOLVED';
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastActivityAt: new Date(),
          ...(reprise ? { status: 'IN_PROGRESS', resolvedAt: null } : {}),
          // Répondre depuis le lien prouve qu'on lit cette boîte.
          ...(params.viaLien && ticket.identity === 'UNVERIFIED' ? { identity: 'EMAIL_CONFIRMED' } : {}),
        },
      });
      if (reprise) {
        await tx.supportTicketEvent.create({
          data: { ticketId: ticket.id, actorId: params.userId, kind: 'STATUS_CHANGED', fromValue: ticket.status, toValue: 'IN_PROGRESS' },
        });
      }
    });
  } catch (error) {
    if (storageKey) await deleteDocument(storageKey).catch(() => undefined);
    throw error;
  }

  await logAudit({
    action: 'support.ticket_replied',
    userId: params.userId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    metadata: { number: ticket.number, by: 'requester', viaLien: params.viaLien },
  });
  await prevenirAdministrateurs(ticket, 'Nouveau message du demandeur');
}

// ---------------------------------------------------------------------------
// Côté administration
// ---------------------------------------------------------------------------

export type AdminTicketRow = {
  id: string;
  number: string;
  subject: string;
  status: StatutDemande;
  identity: SupportIdentity;
  requesterName: string;
  requesterEmail: string;
  declaredNumber: string | null;
  portfolioName: string | null;
  assigneeName: string | null;
  assignedToMe: boolean;
  area: string | null;
  createdAt: string;
  lastActivityAt: string;
};

export async function listerDemandesAdmin(params: {
  scope: AdminScope;
  statut?: string;
  search?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<AdminPage<AdminTicketRow>> {
  const { scope } = params;
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = params.pageSize ?? ADMIN_PAGE_SIZE;
  const and: Prisma.SupportTicketWhereInput[] = [ticketScope(scope)];

  if (!params.statut || params.statut === 'ouvertes') {
    and.push({ status: { in: ['NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER'] } });
  } else if (params.statut !== 'toutes') {
    and.push({ status: params.statut as SupportTicketStatus });
  }
  if (params.mine) and.push({ assigneeId: scope.userId });

  const term = params.search?.trim() ?? '';
  if (term) {
    const numero = lireNumero(term);
    if (numero?.prefixe === 'DEM') and.push({ number: numero.numero });
    else if (numero) and.push({ declaredNumber: numero.numero });
    else {
      and.push({
        OR: [
          { subject: { contains: term, mode: 'insensitive' } },
          { requesterEmail: { contains: term.toLowerCase() } },
          { requesterName: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
  }

  const where: Prisma.SupportTicketWhereInput = { AND: and };
  const [total, tickets] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        portfolio: { select: { name: true } },
        assignee: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    rows: tickets.map((t) => ({
      id: t.id,
      number: t.number ?? '',
      subject: t.subject,
      status: t.status,
      identity: t.identity,
      requesterName: t.requesterName,
      requesterEmail: t.requesterEmail,
      declaredNumber: t.declaredNumber,
      portfolioName: t.portfolio?.name ?? null,
      assigneeName: t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : null,
      assignedToMe: t.assigneeId === scope.userId,
      area: t.area,
      createdAt: t.createdAt.toISOString(),
      lastActivityAt: t.lastActivityAt.toISOString(),
    })),
  };
}

/** Une demande du périmètre, ou 404 — exactement comme une demande inexistante. */
async function demandeDuPerimetre(scope: AdminScope, ticketId: string) {
  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, ...ticketScope(scope) },
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      portfolioId: true,
      assigneeId: true,
      requesterId: true,
      requesterEmail: true,
      requesterName: true,
      identity: true,
      farmId: true,
      technicianId: true,
    },
  });
  if (!ticket) throw notFound('Demande introuvable');
  return ticket;
}

/** Qui peut se voir attribuer une demande de ce portefeuille. */
async function administrateursAttribuables(
  scope: AdminScope,
  portfolioId: string | null,
): Promise<Array<{ id: string; name: string }>> {
  const [gestionnaires, generaux] = await Promise.all([
    portfolioId
      ? prisma.portfolioManager.findMany({
          where: { portfolioId, user: { isSecondaryAdmin: true, suspendedAt: null, deletedAt: null } },
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { id: true, firstName: true, lastName: true } } },
        })
      : Promise.resolve([]),
    // Un secondaire n'attribue qu'aux gestionnaires du portefeuille ; le
    // général peut aussi se l'attribuer, ou à un autre général.
    scope.all
      ? prisma.user.findMany({
          where: { isPlatformAdmin: true, suspendedAt: null, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);
  const vus = new Map<string, string>();
  for (const g of gestionnaires) vus.set(g.user.id, `${g.user.firstName} ${g.user.lastName}`);
  for (const g of generaux) vus.set(g.id, `${g.firstName} ${g.lastName} (général)`);
  return [...vus.entries()].map(([id, name]) => ({ id, name }));
}

export async function chargerDemandeAdmin(scope: AdminScope, ticketId: string): Promise<AdminTicketView> {
  await demandeDuPerimetre(scope, ticketId);
  const ticket = await prisma.supportTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      ...includeConversation,
      farm: { select: { id: true, name: true, customerNumber: true, portfolioId: true, deletedAt: true, members: { select: { user: { select: { emailNormalized: true } } } } } },
      technician: { select: { id: true, firstName: true, lastName: true, technicianNumber: true, portfolioId: true, emailNormalized: true } },
      portfolio: { select: { id: true, name: true } },
      assignee: { select: { id: true, firstName: true, lastName: true } },
      events: {
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { firstName: true, lastName: true } } },
      },
    },
  });

  // Le client n'est montré que s'il est dans le périmètre de qui regarde :
  // une demande transférée ne doit pas révéler un client d'un autre
  // portefeuille.
  const farmVisible =
    ticket.farm && (scope.all || (portfolioInScope(scope, ticket.farm.portfolioId) && !ticket.farm.deletedAt));
  const technicianVisible =
    ticket.technician && (scope.all || portfolioInScope(scope, ticket.technician.portfolioId));

  const emailsDuClient = new Set<string>([
    ...(ticket.farm?.members.map((m) => m.user.emailNormalized) ?? []),
    ...(ticket.technician ? [ticket.technician.emailNormalized] : []),
  ]);

  const base = vueDemandeur(ticket);
  return {
    ...base,
    // L'administration voit tout l'échange, notes internes comprises, avec le
    // nom de chaque intervenant.
    messages: ticket.messages.map((m) => ({
      id: m.id,
      authorKind: m.authorKind,
      authorName:
        m.authorKind === 'STAFF'
          ? m.author
            ? `${m.author.firstName} ${m.author.lastName}`
            : 'Administration'
          : ticket.requesterName,
      body: m.body,
      internal: m.internal,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map(vuePiece),
    })),
    identity: ticket.identity,
    requesterName: ticket.requesterName,
    requesterEmail: ticket.requesterEmail,
    requesterId: ticket.requesterId,
    farm: farmVisible && ticket.farm
      ? { id: ticket.farm.id, name: ticket.farm.name, customerNumber: ticket.farm.customerNumber }
      : null,
    technician: technicianVisible && ticket.technician
      ? {
          id: ticket.technician.id,
          name: `${ticket.technician.firstName} ${ticket.technician.lastName}`,
          technicianNumber: ticket.technician.technicianNumber,
        }
      : null,
    clientOutOfScope: Boolean((ticket.farm && !farmVisible) || (ticket.technician && !technicianVisible)),
    emailMatchesClient:
      ticket.identity !== 'UNVERIFIED' && emailsDuClient.has(ticket.requesterEmail.toLowerCase()),
    portfolio: ticket.portfolio,
    assignee: ticket.assignee
      ? { id: ticket.assignee.id, name: `${ticket.assignee.firstName} ${ticket.assignee.lastName}` }
      : null,
    events: ticket.events.map((e) => ({
      id: e.id,
      kind: e.kind,
      fromValue: e.fromValue,
      toValue: e.toValue,
      actorName: e.actor ? `${e.actor.firstName} ${e.actor.lastName}` : null,
      createdAt: e.createdAt.toISOString(),
    })),
    assignableAdmins: await administrateursAttribuables(scope, ticket.portfolioId),
  };
}

export async function repondreAdmin(params: {
  scope: AdminScope;
  ticketId: string;
  body: string;
  internal: boolean;
  ipAddress: string | null;
}): Promise<void> {
  const ticket = await demandeDuPerimetre(params.scope, params.ticketId);
  if (ticket.status === 'CLOSED' && !params.internal) {
    throw conflict('Cette demande est fermée : rouvrez-la avant de répondre.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.create({
      data: {
        ticketId: ticket.id,
        authorId: params.scope.userId,
        authorKind: 'STAFF',
        body: params.body,
        internal: params.internal,
      },
    });
    if (!params.internal) {
      // Une réponse publique met la demande en attente du client, sauf si elle
      // était déjà résolue.
      const statut: SupportTicketStatus =
        ticket.status === 'RESOLVED' ? 'RESOLVED' : 'WAITING_CUSTOMER';
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: { lastActivityAt: new Date(), status: statut },
      });
      if (statut !== ticket.status) {
        await tx.supportTicketEvent.create({
          data: { ticketId: ticket.id, actorId: params.scope.userId, kind: 'STATUS_CHANGED', fromValue: ticket.status, toValue: statut },
        });
      }
    }
  });

  await logAudit({
    action: 'support.ticket_replied',
    userId: params.scope.userId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    metadata: { number: ticket.number, by: 'staff', internal: params.internal },
  });

  if (!params.internal) await prevenirDemandeur(ticket, `Réponse à votre demande ${ticket.number}`);
}

async function prevenirDemandeur(
  ticket: { id: string; number: string | null; requesterId: string | null; requesterEmail: string; requesterName: string },
  titre: string,
): Promise<void> {
  if (ticket.requesterId) {
    await createNotification({
      userId: ticket.requesterId,
      type: 'SUPPORT',
      title: titre,
      body: 'Ouvrez la demande pour lire la réponse.',
      link: `/mes-demandes/${ticket.id}`,
      alsoEmail: true,
    });
    return;
  }
  await ecrireAuDemandeurAnonyme({
    to: ticket.requesterEmail,
    name: ticket.requesterName,
    ticketId: ticket.id,
    title: titre,
    body: 'Votre demande a évolué. Le détail se lit en ouvrant le lien ci-dessous.',
  });
}

export async function changerStatut(params: {
  scope: AdminScope;
  ticketId: string;
  status: SupportTicketStatus;
  ipAddress: string | null;
}): Promise<void> {
  const ticket = await demandeDuPerimetre(params.scope, params.ticketId);
  if (ticket.status === params.status) return;
  const now = new Date();
  await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: params.status,
        lastActivityAt: now,
        resolvedAt: params.status === 'RESOLVED' ? now : params.status === 'CLOSED' ? undefined : null,
        closedAt: params.status === 'CLOSED' ? now : null,
      },
    }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: params.scope.userId,
        kind: 'STATUS_CHANGED',
        fromValue: ticket.status,
        toValue: params.status,
      },
    }),
  ]);
  await logAudit({
    action: 'support.ticket_status_changed',
    userId: params.scope.userId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    metadata: { number: ticket.number, from: ticket.status, to: params.status },
  });
  if (params.status === 'RESOLVED' || params.status === 'CLOSED') {
    await prevenirDemandeur(
      ticket,
      `Votre demande ${ticket.number} est ${LIBELLES_STATUT[params.status].toLowerCase()}`,
    );
  }
}

export async function attribuer(params: {
  scope: AdminScope;
  ticketId: string;
  assigneeId: string | null;
  ipAddress: string | null;
}): Promise<void> {
  const ticket = await demandeDuPerimetre(params.scope, params.ticketId);
  if (params.assigneeId) {
    const possibles = await administrateursAttribuables(params.scope, ticket.portfolioId);
    if (!possibles.some((a) => a.id === params.assigneeId)) {
      throw new ApiError(
        400,
        'Cette personne ne peut pas recevoir la demande : elle ne gère pas ce portefeuille.',
        'ASSIGNEE_NOT_ALLOWED',
      );
    }
  }
  if (ticket.assigneeId === params.assigneeId) return;
  await prisma.$transaction([
    prisma.supportTicket.update({ where: { id: ticket.id }, data: { assigneeId: params.assigneeId } }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: params.scope.userId,
        kind: 'ASSIGNED',
        fromValue: ticket.assigneeId,
        toValue: params.assigneeId,
      },
    }),
  ]);
  await logAudit({
    action: 'support.ticket_assigned',
    userId: params.scope.userId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    metadata: { number: ticket.number, from: ticket.assigneeId, to: params.assigneeId },
  });
  if (params.assigneeId && params.assigneeId !== params.scope.userId) {
    await createNotification({
      userId: params.assigneeId,
      type: 'SUPPORT',
      title: `Demande ${ticket.number} attribuée`,
      body: ticket.subject,
      link: `/administration/support/${ticket.id}`,
      alsoEmail: true,
    });
  }
}

/** Change le portefeuille d'une demande — administrateur général seul (vérifié par la route). */
export async function transferer(params: {
  scope: AdminScope;
  ticketId: string;
  portfolioId: string | null;
  ipAddress: string | null;
}): Promise<void> {
  const ticket = await demandeDuPerimetre(params.scope, params.ticketId);
  let nom: string | null = null;
  if (params.portfolioId) {
    const portfolio = await prisma.managementPortfolio.findUnique({
      where: { id: params.portfolioId },
      select: { name: true },
    });
    if (!portfolio) throw notFound('Portefeuille introuvable');
    nom = portfolio.name;
  }
  if (ticket.portfolioId === params.portfolioId) return;
  const assigneeId = await responsableDuPortefeuille(params.portfolioId);
  await prisma.$transaction([
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { portfolioId: params.portfolioId, assigneeId },
    }),
    prisma.supportTicketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: params.scope.userId,
        kind: 'PORTFOLIO_CHANGED',
        fromValue: ticket.portfolioId,
        toValue: nom,
      },
    }),
  ]);
  await logAudit({
    action: 'support.ticket_transferred',
    userId: params.scope.userId,
    entity: 'SupportTicket',
    entityId: ticket.id,
    ipAddress: params.ipAddress,
    metadata: { number: ticket.number, from: ticket.portfolioId, to: params.portfolioId },
  });
  await prevenirAdministrateurs(
    { ...ticket, portfolioId: params.portfolioId, assigneeId },
    'Demande transférée dans votre portefeuille',
  );
}

// ---------------------------------------------------------------------------
// Pièces jointes
// ---------------------------------------------------------------------------

export type AccesPiece =
  | { kind: 'admin'; scope: AdminScope }
  | { kind: 'requester'; userId: string }
  | { kind: 'token'; ticketId: string };

/**
 * Charge une pièce jointe pour qui a le droit de la lire, sinon 404. Les
 * pièces d'une note interne ne sortent pas vers le demandeur.
 */
export async function lirePiece(
  acces: AccesPiece,
  ticketId: string,
  attachmentId: string,
  ipAddress: string | null,
): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
  const where: Prisma.SupportAttachmentWhereInput = { id: attachmentId, ticketId };
  if (acces.kind === 'admin') where.ticket = ticketScope(acces.scope);
  if (acces.kind === 'requester') where.ticket = { requesterId: acces.userId };
  if (acces.kind === 'token' && acces.ticketId !== ticketId) throw notFound('Pièce jointe introuvable');
  if (acces.kind !== 'admin') where.OR = [{ messageId: null }, { message: { internal: false } }];

  const piece = await prisma.supportAttachment.findFirst({
    where,
    select: { id: true, fileName: true, mimeType: true, storageKey: true, ticket: { select: { number: true } } },
  });
  if (!piece) throw notFound('Pièce jointe introuvable');

  const buffer = await readDocument(piece.storageKey).catch(() => {
    throw notFound('Fichier absent du stockage');
  });

  await logAudit({
    action: 'support.attachment_downloaded',
    userId: acces.kind === 'admin' ? acces.scope.userId : acces.kind === 'requester' ? acces.userId : null,
    entity: 'SupportAttachment',
    entityId: piece.id,
    ipAddress,
    metadata: { number: piece.ticket.number, via: acces.kind },
  });

  return { fileName: piece.fileName, mimeType: piece.mimeType, buffer };
}

/** Réponse HTTP d'une pièce jointe : toujours en téléchargement, jamais interprétée. */
export function reponsePiece(piece: { fileName: string; mimeType: string; buffer: Buffer }): NextResponse {
  const nomAscii = piece.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return new NextResponse(new Uint8Array(piece.buffer), {
    status: 200,
    headers: {
      'Content-Type': piece.mimeType,
      'Content-Length': String(piece.buffer.length),
      'Content-Disposition': `attachment; filename="${nomAscii}"; filename*=UTF-8''${encodeURIComponent(piece.fileName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

/** Exploitations du compte proposables dans le formulaire (membre, pas conseil). */
export function exploitationsDuCompte(auth: {
  memberships: Array<{ farmId: string; farmName: string; kind: 'member' | 'advisory' }>;
}) {
  return auth.memberships.filter((m) => m.kind === 'member');
}

