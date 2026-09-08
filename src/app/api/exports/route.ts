import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, enforceRateLimit, ok, parseQuery, route } from '@/lib/api/handler';
import { exportQuerySchema } from '@/lib/validation/farming';
import { DATASET_BUILDERS } from '@/lib/exports/datasets';
import {
  CONTENT_TYPES,
  exportFileName,
  renderCsv,
  renderPdf,
  renderXlsx,
} from '@/lib/exports/renderers';
import { logAudit } from '@/lib/audit';
import { badRequest } from '@/lib/api/errors';

/**
 * GET /api/exports?dataset=&format=&year=&parcelIds=
 *
 * Génère un export (CSV, Excel ou PDF). Les données sont systématiquement
 * restreintes à l'exploitation active : les identifiants de parcelles fournis
 * en paramètre sont filtrés côté serveur.
 */
export const GET = route(async (request: NextRequest) => {
  const query = parseQuery(request, exportQuerySchema);
  const ctx = await requireFarmAccess('export:read', query.farmId);
  await enforceRateLimit(`export:${ctx.user.id}`, { limit: 30, windowSeconds: 300 });

  const farm = await prisma.farm.findUniqueOrThrow({
    where: { id: ctx.farmId },
    select: { name: true },
  });

  const parseDate = (value?: string): Date | undefined => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw badRequest(`Date invalide : ${value}`);
    return date;
  };

  const builder = DATASET_BUILDERS[query.dataset];
  const dataset = await builder({
    farmId: ctx.farmId,
    farmName: farm.name,
    year: query.year,
    from: parseDate(query.from),
    to: parseDate(query.to),
    parcelIds: query.parcelIds,
    cropIds: query.cropIds,
  });

  const body =
    query.format === 'csv'
      ? renderCsv(dataset)
      : query.format === 'xlsx'
        ? await renderXlsx(dataset)
        : await renderPdf(dataset);

  await logAudit({
    action: 'export.generated',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    ipAddress: clientIp(request),
    metadata: {
      dataset: query.dataset,
      format: query.format,
      rows: dataset.rows.length,
      year: query.year,
    },
  });

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': CONTENT_TYPES[query.format],
      'Content-Disposition': `attachment; filename="${exportFileName(dataset, query.format)}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, no-store',
    },
  });
});

/** POST — non utilisé : les exports sont des lectures. */
export const POST = route(async () => ok({ message: 'Utilisez GET /api/exports' }, 405));
