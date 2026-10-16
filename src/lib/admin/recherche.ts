import 'server-only';
import { prisma } from '@/lib/prisma';
import { farmScope, technicianScope, ticketScope, type AdminScope } from '@/lib/admin/scope';
import { lireNumero } from '@/lib/shared/numeros';

/**
 * Recherche par numéro (`EXP-…`, `TEC-…`, `DEM-…`) dans le périmètre.
 *
 * Un numéro hors périmètre et un numéro inexistant donnent la même réponse :
 * rien. Le numéro désigne, le périmètre décide.
 */
export type ResultatRecherche =
  | { found: true; kind: 'farm' | 'technician' | 'ticket'; id: string; label: string; url: string }
  | { found: false; reason: 'format' | 'absent' };

export async function rechercherNumero(scope: AdminScope, saisie: string): Promise<ResultatRecherche> {
  const numero = lireNumero(saisie);
  if (!numero) return { found: false, reason: 'format' };

  if (numero.prefixe === 'EXP') {
    const farm = await prisma.farm.findFirst({
      where: { customerNumber: numero.numero, ...farmScope(scope) },
      select: { id: true, name: true },
    });
    return farm
      ? { found: true, kind: 'farm', id: farm.id, label: farm.name, url: `/administration/exploitations/${farm.id}` }
      : { found: false, reason: 'absent' };
  }

  if (numero.prefixe === 'TEC') {
    const tech = await prisma.user.findFirst({
      where: { technicianNumber: numero.numero, deletedAt: null, ...technicianScope(scope) },
      select: { id: true, firstName: true, lastName: true },
    });
    return tech
      ? {
          found: true,
          kind: 'technician',
          id: tech.id,
          label: `${tech.firstName} ${tech.lastName}`,
          url: `/administration/experts/${tech.id}`,
        }
      : { found: false, reason: 'absent' };
  }

  const ticket = await prisma.supportTicket.findFirst({
    where: { number: numero.numero, ...ticketScope(scope) },
    select: { id: true, subject: true },
  });
  return ticket
    ? { found: true, kind: 'ticket', id: ticket.id, label: ticket.subject, url: `/administration/support/${ticket.id}` }
    : { found: false, reason: 'absent' };
}
