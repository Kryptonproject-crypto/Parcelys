import { NextResponse, type NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { route } from '@/lib/api/handler';
import { couchesAvecEmpreinte } from '@/lib/regulatory/map-layers';
import { ApiError } from '@/lib/api/errors';

/**
 * GET /api/regulatory/map-layers[?couche=<code>][&farmId=<exploitation>]
 *
 * Les couches réglementaires de la carte, à la demande.
 *
 * Sans paramètre : la liste des couches — libellé, couleur, provenance,
 * nombre de zones — sans leurs géométries. C'est ce que la légende affiche,
 * et toutes les couches sont éteintes au départ.
 *
 * Avec `couche` : les géométries de cette couche seule, au moment où on
 * l'allume. Les cours d'eau et les zones vulnérables autour d'une exploitation
 * pèsent jusqu'à deux mégaoctets : les intégrer à chaque fiche de parcelle
 * ralentissait la page pour des couches qu'on n'allume presque jamais.
 *
 * L'en-tête `ETag` résume ce dont les couches dépendent (emprise des
 * parcelles, état des référentiels) : tant qu'il est inchangé, le navigateur —
 * ou l'application de terrain — garde ce qu'il a déjà.
 */
export const GET = route(async (request: NextRequest) => {
  // `farmId` : la fiche d'une parcelle ouverte depuis un portefeuille de
  // conseil n'est pas celle de l'exploitation active.
  const ctx = await requireFarmAccess('parcel:read', request.nextUrl.searchParams.get('farmId'));
  const code = request.nextUrl.searchParams.get('couche');

  const { couches, empreinte } = await couchesAvecEmpreinte({ farmId: ctx.farmId });
  const etag = `"${empreinte}${code ? `-${Buffer.from(code).toString('base64url')}` : ''}"`;
  const entetes = { ETag: etag, 'Cache-Control': 'private, no-cache' };

  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: entetes });
  }

  if (code) {
    const couche = couches.find((c) => c.code === code);
    if (!couche) throw new ApiError(404, 'Couche introuvable', 'NOT_FOUND');
    return NextResponse.json({ code: couche.code, features: couche.features }, { headers: entetes });
  }

  return NextResponse.json(
    {
      // L'application de terrain garde les couches pour les afficher hors
      // réseau : l'empreinte lui dit si celles qu'elle a sont encore à jour.
      empreinte,
      couches: couches.map((c) => ({
        code: c.code,
        kind: c.kind,
        label: c.label,
        color: c.color,
        source: c.source,
        rendues: c.rendues,
        total: c.total,
      })),
    },
    { headers: entetes },
  );
});
