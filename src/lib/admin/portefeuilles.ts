import 'server-only';
import type { Prisma, SupportTicketStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { notFound } from '@/lib/api/errors';

/**
 * Portefeuilles de gestion : listes, attribution et transfert de clients,
 * administrateur responsable.
 *
 * Réservé à l'administrateur général — les routes qui appellent ces fonctions
 * le vérifient (`clients:assign`, `portfolios:manage`).
 */

export type PortfolioSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  managers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    suspended: boolean;
  }>;
  farms: number;
  technicians: number;
  openTickets: number;
};

const STATUTS_CLOS: SupportTicketStatus[] = ['RESOLVED', 'CLOSED'];

export async function listPortfolios(): Promise<PortfolioSummary[]> {
  const portfolios = await prisma.managementPortfolio.findMany({
    orderBy: { name: 'asc' },
    include: {
      managers: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              suspendedAt: true,
              deletedAt: true,
            },
          },
        },
      },
      _count: {
        select: {
          farms: { where: { deletedAt: null } },
          technicians: { where: { deletedAt: null } },
          tickets: { where: { status: { notIn: STATUTS_CLOS } } },
        },
      },
    },
  });

  return portfolios.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt.toISOString(),
    managers: p.managers
      .filter((m) => !m.user.deletedAt)
      .map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        suspended: m.user.suspendedAt !== null,
      })),
    farms: p._count.farms,
    technicians: p._count.technicians,
    openTickets: p._count.tickets,
  }));
}

/**
 * L'administrateur responsable d'un portefeuille : le premier de ses
 * gestionnaires encore en activité. `null` s'il n'y en a aucun — la demande
 * reste alors visible des administrateurs généraux, qui voient tout.
 */
export async function responsableDuPortefeuille(
  portfolioId: string | null | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  if (!portfolioId) return null;
  const manager = await tx.portfolioManager.findFirst({
    where: {
      portfolioId,
      user: { isSecondaryAdmin: true, suspendedAt: null, deletedAt: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  });
  return manager?.userId ?? null;
}

export type AssignmentResult = {
  moved: number;
  unchanged: number;
  ticketsMoved: number;
};

/**
 * Attribue des clients à un portefeuille (ou les en retire avec `null`).
 *
 * Le client emporte avec lui ce qui le concerne et qui décide de la
 * visibilité : ses demandes de support — **toutes**, closes comprises, sans
 * quoi l'ancien administrateur garderait sous les yeux l'historique d'un
 * client qui n'est plus le sien — et, pour une exploitation, les codes
 * d'invitation encore ouverts qui la rejoignent.
 *
 * Tout se fait dans une transaction, et chaque client déplacé laisse une
 * ligne au journal : qui, quand, d'où, vers où.
 */
export async function assignClients(params: {
  actorId: string;
  kind: 'farm' | 'technician';
  ids: string[];
  portfolioId: string | null;
  ipAddress?: string | null;
}): Promise<AssignmentResult> {
  const { actorId, kind, portfolioId } = params;
  const ids = [...new Set(params.ids)];

  let portfolioName: string | null = null;
  if (portfolioId) {
    const portfolio = await prisma.managementPortfolio.findUnique({
      where: { id: portfolioId },
      select: { name: true },
    });
    if (!portfolio) throw notFound('Portefeuille introuvable');
    portfolioName = portfolio.name;
  }

  const journal: Array<Parameters<typeof logAudit>[0]> = [];

  const result = await prisma.$transaction(async (tx) => {
    const assignee = await responsableDuPortefeuille(portfolioId, tx);
    let moved = 0;
    let unchanged = 0;
    let ticketsMoved = 0;

    const clients =
      kind === 'farm'
        ? (
            await tx.farm.findMany({
              where: { id: { in: ids } },
              select: {
                id: true,
                name: true,
                customerNumber: true,
                portfolioId: true,
                portfolio: { select: { name: true } },
              },
            })
          ).map((f) => ({
            id: f.id,
            label: f.name,
            number: f.customerNumber,
            from: f.portfolioId,
            fromName: f.portfolio?.name ?? null,
          }))
        : (
            await tx.user.findMany({
              where: { id: { in: ids }, accountType: 'AGRONOMIST', deletedAt: null },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                technicianNumber: true,
                portfolioId: true,
                portfolio: { select: { name: true } },
              },
            })
          ).map((u) => ({
            id: u.id,
            label: `${u.firstName} ${u.lastName}`,
            number: u.technicianNumber,
            from: u.portfolioId,
            fromName: u.portfolio?.name ?? null,
          }));

    if (clients.length !== ids.length) {
      throw notFound(kind === 'farm' ? 'Exploitation introuvable' : 'Technicien introuvable');
    }

    for (const client of clients) {
      if (client.from === portfolioId) {
        unchanged += 1;
        continue;
      }

      if (kind === 'farm') {
        await tx.farm.update({ where: { id: client.id }, data: { portfolioId } });
        await tx.invitationCode.updateMany({
          where: { farmId: client.id, usedAt: null, revokedAt: null },
          data: { portfolioId },
        });
      } else {
        await tx.user.update({ where: { id: client.id }, data: { portfolioId } });
      }

      const tickets = await tx.supportTicket.findMany({
        where: kind === 'farm' ? { farmId: client.id } : { technicianId: client.id },
        select: { id: true, portfolioId: true },
      });
      for (const ticket of tickets) {
        if (ticket.portfolioId === portfolioId) continue;
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: { portfolioId, assigneeId: assignee },
        });
        await tx.supportTicketEvent.create({
          data: {
            ticketId: ticket.id,
            actorId,
            kind: 'PORTFOLIO_CHANGED',
            fromValue: client.fromName,
            toValue: portfolioName,
          },
        });
        ticketsMoved += 1;
      }

      moved += 1;
      journal.push({
        action: 'portfolio.client_assigned',
        userId: actorId,
        farmId: kind === 'farm' ? client.id : null,
        entity: kind === 'farm' ? 'Farm' : 'User',
        entityId: client.id,
        ipAddress: params.ipAddress ?? null,
        metadata: {
          kind,
          client: client.label,
          customerNumber: client.number,
          fromPortfolioId: client.from,
          fromPortfolio: client.fromName,
          toPortfolioId: portfolioId,
          toPortfolio: portfolioName,
          ticketsMoved: tickets.length,
        },
      });
    }

    return { moved, unchanged, ticketsMoved };
  });

  // Le journal après la transaction : une écriture d'audit qui échoue ne doit
  // pas annuler l'attribution, et une attribution annulée ne doit rien
  // journaliser.
  for (const entry of journal) await logAudit(entry);

  return result;
}
