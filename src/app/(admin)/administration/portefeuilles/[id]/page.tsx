import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { listPortfolioOptions } from '@/lib/admin/overview';
import { Card, CardHeader, PageHeader } from '@/components/ui';
import { IconAdvisor, IconArrowLeft, IconFarm, IconPortfolio } from '@/components/ui/icons';
import { PortfolioForm } from '@/app/(admin)/administration/portefeuilles/PortfolioForm';
import { BulkAssign } from '@/app/(admin)/administration/portefeuilles/BulkAssign';

export const metadata: Metadata = { title: 'Portefeuille — Administration' };
export const dynamic = 'force-dynamic';

/**
 * Fiche d'un portefeuille — administrateur général seul : ses clients, ses
 * gestionnaires, et les transferts groupés. C'est aussi d'ici qu'on attribue
 * en groupe des clients encore sans portefeuille.
 */
export default async function AdminPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAdminScope('portfolios:manage');
  const { id } = await params;
  const portfolio = await prisma.managementPortfolio.findUnique({
    where: { id },
    include: {
      managers: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      farms: {
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, customerNumber: true, city: true },
      },
      technicians: {
        where: { deletedAt: null },
        orderBy: { lastName: 'asc' },
        select: { id: true, firstName: true, lastName: true, technicianNumber: true, organization: true },
      },
    },
  });
  if (!portfolio) notFound();

  const [options, sansFermes, sansTechniciens] = await Promise.all([
    listPortfolioOptions(auth.scope),
    prisma.farm.findMany({
      where: { deletedAt: null, portfolioId: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, customerNumber: true, city: true },
    }),
    prisma.user.findMany({
      where: { deletedAt: null, accountType: 'AGRONOMIST', portfolioId: null },
      orderBy: { lastName: 'asc' },
      take: 500,
      select: { id: true, firstName: true, lastName: true, technicianNumber: true, organization: true },
    }),
  ]);
  const autres = options.filter((o) => o.id !== portfolio.id);
  const ici = [{ id: portfolio.id, name: portfolio.name }];

  return (
    <>
      <PageHeader
        icon={IconPortfolio}
        title={portfolio.name}
        breadcrumb={
          <Link href="/administration/portefeuilles" className="inline-flex items-center gap-1 hover:underline">
            <IconArrowLeft size={14} aria-hidden /> Portefeuilles
          </Link>
        }
        description={
          portfolio.managers.length
            ? `Géré par ${portfolio.managers.map((m) => `${m.user.firstName} ${m.user.lastName}`).join(', ')}.`
            : 'Aucun administrateur secondaire ne gère ce portefeuille.'
        }
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={IconFarm} title={`Exploitations (${portfolio.farms.length})`} description="Sélectionnez pour transférer." />
          <BulkAssign
            kind="farm"
            current={portfolio.id}
            portfolios={autres}
            emptyLabel="Aucune exploitation dans ce portefeuille"
            items={portfolio.farms.map((f) => ({
              id: f.id,
              label: f.name,
              number: f.customerNumber,
              detail: f.city,
              href: `/administration/exploitations/${f.id}`,
            }))}
          />
        </Card>
        <Card>
          <CardHeader icon={IconAdvisor} title={`Techniciens (${portfolio.technicians.length})`} />
          <BulkAssign
            kind="technician"
            current={portfolio.id}
            portfolios={autres}
            emptyLabel="Aucun technicien dans ce portefeuille"
            items={portfolio.technicians.map((t) => ({
              id: t.id,
              label: `${t.firstName} ${t.lastName}`,
              number: t.technicianNumber,
              detail: t.organization,
              href: `/administration/experts/${t.id}`,
            }))}
          />
        </Card>
        <Card>
          <CardHeader icon={IconFarm} title="Attribuer des exploitations sans portefeuille" />
          <BulkAssign
            kind="farm"
            current={null}
            portfolios={ici}
            emptyLabel="Toutes les exploitations ont un portefeuille"
            items={sansFermes.map((f) => ({
              id: f.id,
              label: f.name,
              number: f.customerNumber,
              detail: f.city,
              href: `/administration/exploitations/${f.id}`,
            }))}
          />
        </Card>
        <Card>
          <CardHeader icon={IconAdvisor} title="Attribuer des techniciens sans portefeuille" />
          <BulkAssign
            kind="technician"
            current={null}
            portfolios={ici}
            emptyLabel="Tous les techniciens ont un portefeuille"
            items={sansTechniciens.map((t) => ({
              id: t.id,
              label: `${t.firstName} ${t.lastName}`,
              number: t.technicianNumber,
              detail: t.organization,
              href: `/administration/experts/${t.id}`,
            }))}
          />
        </Card>
        <Card>
          <CardHeader title="Nom et description" />
          <PortfolioForm initial={{ id: portfolio.id, name: portfolio.name, description: portfolio.description }} />
        </Card>
      </div>
    </>
  );
}
