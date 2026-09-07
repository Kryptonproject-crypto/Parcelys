import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { formatBytes } from '@/lib/storage/format';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from '@/lib/constants/agronomy';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  formatDateFr,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ categorie?: string; parcelle?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePageFarmAccess('document:read');

  const [documents, parcels] = await Promise.all([
    prisma.document.findMany({
      where: {
        farmId: ctx.farmId,
        ...(params.categorie ? { category: params.categorie } : {}),
        ...(params.parcelle ? { parcelId: params.parcelle } : {}),
      },
      include: {
        parcel: { select: { id: true, name: true, internalNumber: true } },
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.parcel.findMany({
      where: { farmId: ctx.farmId, deletedAt: null },
      select: { id: true, name: true, internalNumber: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const totalSize = documents.reduce((sum, d) => sum + d.sizeBytes, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Documents"
        description={`${documents.length} document${documents.length > 1 ? 's' : ''} · ${formatBytes(totalSize)}`}
      />

      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-4">
          <div>
            <label htmlFor="categorie" className="mb-1 block text-xs font-medium text-ardoise-600">
              Catégorie
            </label>
            <select
              id="categorie"
              name="categorie"
              defaultValue={params.categorie ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            >
              <option value="">Toutes</option>
              {DOCUMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {DOCUMENT_CATEGORY_LABELS[category] ?? category}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="parcelle" className="mb-1 block text-xs font-medium text-ardoise-600">
              Parcelle
            </label>
            <select
              id="parcelle"
              name="parcelle"
              defaultValue={params.parcelle ?? ''}
              className="h-10 w-full rounded-lg border border-ardoise-300 px-2 text-sm"
            >
              <option value="">Toutes</option>
              {parcels.map((parcel) => (
                <option key={parcel.id} value={parcel.id}>
                  {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                  {parcel.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="h-10 w-full rounded-lg bg-champ-600 px-4 text-sm font-medium text-white transition hover:bg-champ-700"
            >
              Filtrer
            </button>
          </div>
        </form>
      </Card>

      {documents.length === 0 ? (
        <EmptyState
          icon="📁"
          title="Aucun document"
          description="Les documents s'attachent à une parcelle depuis sa fiche, onglet « Documents » : factures, analyses de sol, photos, documents administratifs."
          action={
            <LinkButton href="/parcelles" variant="outline">
              Choisir une parcelle
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <div key={doc.id} className="rounded-xl border border-ardoise-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl" aria-hidden>
                  {doc.mimeType.startsWith('image/')
                    ? '🖼️'
                    : doc.mimeType === 'application/pdf'
                      ? '📄'
                      : '📎'}
                </span>
                <Badge>{DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
              </div>

              <p className="mt-2 truncate font-medium text-ardoise-900" title={doc.fileName}>
                {doc.fileName}
              </p>
              {doc.description ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-ardoise-500">
                  {doc.description}
                </p>
              ) : null}

              {doc.parcel ? (
                <Link
                  href={`/parcelles/${doc.parcel.id}?onglet=documents`}
                  className="mt-1 block truncate text-sm text-champ-700 hover:underline"
                >
                  {doc.parcel.internalNumber ? `${doc.parcel.internalNumber} — ` : ''}
                  {doc.parcel.name}
                </Link>
              ) : null}

              <p className="mt-1 text-xs text-ardoise-500">
                {formatBytes(doc.sizeBytes)} · {formatDateFr(doc.createdAt)}
                {doc.uploadedBy
                  ? ` · ${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`
                  : ''}
              </p>

              <a
                href={`/api/documents/${doc.id}`}
                className="mt-3 block border-t border-ardoise-100 pt-2.5 text-sm text-champ-700 hover:underline"
              >
                Télécharger
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
