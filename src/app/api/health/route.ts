import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/health — état réel de l'instance.
 *
 * Une sonde de santé qui répond « tout va bien » sans avoir rien vérifié est
 * pire que pas de sonde du tout : elle donne confiance à tort. Celle-ci touche
 * la base et l'extension PostGIS, faute de quoi elle renvoie 503.
 *
 * Volontairement publique et laconique : un superviseur externe doit pouvoir
 * l'appeler sans identifiants, et un visiteur n'y apprend rien qu'il ne puisse
 * déduire d'une page en erreur. Ni version, ni schéma, ni message d'exception.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const checks: Record<string, boolean> = { database: false, postgis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;

    // PostGIS n'est pas un agrément : sans lui, aucune superficie n'est
    // calculable et l'application ne peut pas faire son travail.
    await prisma.$queryRaw`SELECT postgis_lib_version()`;
    checks.postgis = true;
  } catch {
    // Le détail part dans les journaux du serveur, pas dans la réponse.
  }

  const healthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { status: healthy ? 'ok' : 'degraded', checks },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
