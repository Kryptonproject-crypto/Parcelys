import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp, parseQuery, route } from '@/lib/api/handler';
import { requireAdmin } from '@/lib/admin/scope';
import { listAdminFarms, listAdminTechnicians, listAdminUsers } from '@/lib/admin/overview';
import { listerDemandesAdmin } from '@/lib/support/tickets';
import { renderCsv } from '@/lib/exports/renderers';
import type { ExportDataset } from '@/lib/exports/datasets';
import { logAudit } from '@/lib/audit';
import { LIBELLES_IDENTITE, LIBELLES_STATUT, libelleRubrique } from '@/lib/shared/support';

/**
 * GET /api/admin/exports?type=… — listes de l'administration en CSV.
 *
 * Chaque export passe par **la même lecture bornée** que l'écran
 * correspondant : un administrateur secondaire n'exporte que son périmètre,
 * sans paramètre qui permettrait de l'élargir. Chaque export est journalisé.
 */
const querySchema = z.object({
  type: z.enum(['exploitations', 'techniciens', 'comptes', 'demandes']),
});

const MAX = 10_000;

export const GET = route(async (request: NextRequest) => {
  const auth = await requireAdmin('exports:read');
  const { scope } = auth;
  const { type } = parseQuery(request, querySchema);
  const date = new Date().toISOString().slice(0, 10);
  let dataset: ExportDataset;

  if (type === 'exploitations') {
    const page = await listAdminFarms({ scope, pageSize: MAX });
    dataset = {
      title: 'Exploitations',
      subtitle: date,
      columns: [
        { key: 'numero', header: 'Numéro client' },
        { key: 'nom', header: 'Exploitation' },
        { key: 'commune', header: 'Commune' },
        { key: 'portefeuille', header: 'Portefeuille' },
        { key: 'proprietaires', header: 'Propriétaire(s)' },
        { key: 'membres', header: 'Membres' },
        { key: 'parcelles', header: 'Parcelles' },
        { key: 'surface', header: 'Surface (ha)' },
        { key: 'etat', header: 'État' },
        { key: 'creation', header: 'Créée le' },
      ],
      rows: page.rows.map((f) => ({
        numero: f.customerNumber ?? '',
        nom: f.name,
        commune: f.city ?? '',
        portefeuille: f.portfolioName ?? '',
        proprietaires: f.owners.join(', '),
        membres: f.members,
        parcelles: f.parcels,
        surface: f.areaHa.toFixed(2),
        etat: f.deleted ? 'Supprimée' : 'Active',
        creation: f.createdAt.slice(0, 10),
      })),
    };
  } else if (type === 'techniciens') {
    const page = await listAdminTechnicians({ scope, pageSize: MAX });
    dataset = {
      title: 'Techniciens',
      subtitle: date,
      columns: [
        { key: 'numero', header: 'Numéro technicien' },
        { key: 'nom', header: 'Nom' },
        { key: 'email', header: 'Adresse' },
        { key: 'structure', header: 'Structure' },
        { key: 'portefeuille', header: 'Portefeuille' },
        { key: 'missions', header: 'Missions actives' },
        { key: 'etat', header: 'État' },
      ],
      rows: page.rows.map((t) => ({
        numero: t.technicianNumber ?? '',
        nom: `${t.firstName} ${t.lastName}`,
        email: t.email,
        structure: t.organization ?? '',
        portefeuille: t.portfolioName ?? '',
        missions: t.engagements.filter((e) => e.status === 'ACTIVE').length,
        etat: t.suspended ? 'Suspendu' : 'Actif',
      })),
    };
  } else if (type === 'comptes') {
    const page = await listAdminUsers({ scope, pageSize: MAX });
    dataset = {
      title: 'Comptes',
      subtitle: date,
      columns: [
        { key: 'nom', header: 'Nom' },
        { key: 'email', header: 'Adresse' },
        { key: 'type', header: 'Type' },
        { key: 'numeros', header: 'Numéros clients' },
        { key: 'etat', header: 'État' },
        { key: 'inscription', header: 'Inscrit le' },
        { key: 'connexion', header: 'Dernière connexion' },
      ],
      rows: page.rows.map((u) => ({
        nom: `${u.firstName} ${u.lastName}`,
        email: u.email,
        type:
          u.adminRole === 'GENERAL'
            ? 'Administrateur général'
            : u.adminRole === 'SECONDARY'
              ? 'Administrateur secondaire'
              : u.accountType === 'AGRONOMIST'
                ? 'Technicien'
                : u.accountType === 'ADMIN'
                  ? 'Administration'
                  : 'Exploitant',
        numeros: [u.technicianNumber, ...u.memberships.map((m) => m.customerNumber)]
          .filter(Boolean)
          .join(', '),
        etat: u.suspendedAt ? 'Suspendu' : 'Actif',
        inscription: u.createdAt.slice(0, 10),
        connexion: u.lastLoginAt?.slice(0, 10) ?? '',
      })),
    };
  } else {
    const page = await listerDemandesAdmin({ scope, statut: 'toutes', pageSize: MAX });
    dataset = {
      title: 'Demandes de support',
      subtitle: date,
      columns: [
        { key: 'numero', header: 'Demande' },
        { key: 'sujet', header: 'Sujet' },
        { key: 'rubrique', header: 'Rubrique' },
        { key: 'statut', header: 'Statut' },
        { key: 'client', header: 'Numéro client' },
        { key: 'identite', header: 'Identité' },
        { key: 'portefeuille', header: 'Portefeuille' },
        { key: 'responsable', header: 'Responsable' },
        { key: 'creation', header: 'Créée le' },
        { key: 'activite', header: 'Dernière activité' },
      ],
      rows: page.rows.map((t) => ({
        numero: t.number,
        sujet: t.subject,
        rubrique: libelleRubrique(t.area),
        statut: LIBELLES_STATUT[t.status],
        client: t.declaredNumber ?? '',
        identite: LIBELLES_IDENTITE[t.identity],
        portefeuille: t.portfolioName ?? '',
        responsable: t.assigneeName ?? '',
        creation: t.createdAt.slice(0, 10),
        activite: t.lastActivityAt.slice(0, 10),
      })),
    };
  }

  await logAudit({
    action: 'admin.export_generated',
    userId: auth.user.id,
    ipAddress: clientIp(request),
    metadata: { type, rows: dataset.rows.length, role: scope.role },
  });

  return new NextResponse(new Uint8Array(renderCsv(dataset)), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="parcelys-${type}-${date}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
