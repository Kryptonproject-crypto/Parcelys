import { NextResponse, type NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { clientIp, route } from '@/lib/api/handler';
import { badRequest } from '@/lib/api/errors';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { prepareExport } from '@/lib/pac/export';
import { controlDossier } from '@/lib/pac/control';

/**
 * GET /api/pac/export?year=2026 — prépare les fichiers pour TéléPAC.
 *
 * Le contrôle est lancé automatiquement avant la génération (§ 15). Une erreur
 * bloquante arrête l'export : produire un fichier dont on sait qu'il est
 * incohérent ne rendrait service à personne.
 *
 * L'archive produite est un Shapefile. Parcelys ne dépose rien sur TéléPAC :
 * c'est l'agriculteur qui importe ce fichier, le vérifie, puis signe.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:read');

  const params = new URL(request.url).searchParams;
  const year = Number(params.get('year'));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest('Campagne invalide.');
  }

  const rapport = await controlDossier({ farmId: ctx.farmId, year });
  if (rapport.level === 'error' && params.get('force') !== '1') {
    throw badRequest(
      'Le contrôle relève des erreurs bloquantes : ' +
        rapport.findings
          .filter((f) => f.level === 'error')
          .map((f) => f.message)
          .join(' — '),
    );
  }

  const farm = await prisma.farm.findUniqueOrThrow({
    where: { id: ctx.farmId },
    select: { name: true },
  });

  const prepare = await prepareExport({ farmId: ctx.farmId, farmName: farm.name, year });

  await prisma.pacCampaign.upsert({
    where: { farmId_year: { farmId: ctx.farmId, year } },
    create: { farmId: ctx.farmId, year, lastExportAt: new Date() },
    update: { lastExportAt: new Date() },
  });

  await logAudit({
    action: 'pac.exported',
    userId: ctx.user.id,
    farmId: ctx.farmId,
    ipAddress: clientIp(request),
    metadata: { year, parcels: prepare.parcelCount, controlLevel: rapport.level },
  });

  // Les quatre fichiers du Shapefile voyagent ensemble : on les remet dans une
  // archive, faute de quoi l'utilisateur en oublierait un.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const fichier of prepare.files) zip.file(fichier.name, fichier.content);
  zip.file(
    'LISEZ-MOI.txt',
    [
      `Export préparé par Parcelys pour la campagne PAC ${year}.`,
      '',
      prepare.notice,
      '',
      `Parcelles : ${prepare.parcelCount}`,
      `Surface : ${prepare.areaHa.toFixed(2)} ha`,
      `Projection : Lambert-93 (EPSG:${prepare.srid})`,
      `Contrôle Parcelys : ${rapport.level === 'ok' ? 'conforme' : rapport.level === 'warning' ? 'avertissements' : 'erreurs (export forcé)'}`,
      '',
      'Ce fichier ne constitue pas une déclaration. La déclaration se dépose et',
      'se signe sur telepac.agriculture.gouv.fr.',
    ].join('\n'),
  );

  const archive = await zip.generateAsync({ type: 'nodebuffer' });

  return new NextResponse(new Uint8Array(archive), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${prepare.basename}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
