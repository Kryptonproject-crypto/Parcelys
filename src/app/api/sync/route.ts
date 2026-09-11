import { NextRequest } from 'next/server';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, parseQuery, route } from '@/lib/api/handler';
import { IDEMPOTENCY_HEADER, REPLAY_HEADER } from '@/lib/api/idempotency';
import { syncPullSchema, syncPushSchema } from '@/lib/validation/sync';
import type { SyncOperationInput } from '@/lib/validation/sync';
import { getChangesSince } from '@/lib/services/mobile';
import { badRequest } from '@/lib/api/errors';

import { POST as createParcel } from '@/app/api/parcels/route';
import { PUT as updateParcel } from '@/app/api/parcels/[id]/route';
import { POST as createFertilization } from '@/app/api/parcels/[id]/fertilization/route';
import { POST as createPhyto } from '@/app/api/parcels/[id]/phytosanitary/route';
import { POST as createOperation } from '@/app/api/parcels/[id]/operations/route';
import { POST as createSoilCover } from '@/app/api/soil-covers/route';
import { POST as createRecommendation } from '@/app/api/recommendations/route';
import { POST as respondToRecommendation } from '@/app/api/recommendations/[id]/response/route';

/**
 * Synchronisation de l'application de terrain.
 *
 * `POST` rejoue les saisies mises en file d'attente hors ligne. Plutôt que de
 * réimplémenter les règles métier — calcul de superficie par PostGIS, bilan
 * NPK, contrôles de surface traitée, journal d'audit —, chaque opération est
 * passée aux **routes existantes**. Une seule implémentation, donc un seul
 * comportement : ce qui est refusé en ligne l'est aussi à la synchronisation.
 *
 * Trois propriétés comptent pour un usage au champ :
 *
 *  - **Indépendance.** Une opération refusée n'interrompt pas le lot : les
 *    autres passent, et le téléphone n'a à corriger que celle-là.
 *  - **Idempotence.** Chaque opération porte l'identifiant produit par
 *    l'appareil, transmis en `Idempotency-Key`. Un lot renvoyé après une
 *    réponse perdue ne crée aucun doublon.
 *  - **Ordre.** Les opérations sont traitées en séquence : une parcelle créée
 *    hors ligne peut ainsi recevoir ses interventions dans le même lot.
 */

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

type OperationSpec = {
  handler: RouteHandler;
  /**
   * Méthode portée par la requête interne. Toutes les opérations créaient
   * jusqu'ici ; le renommage d'une parcelle modifie, et la requête doit le
   * dire — les routes ne s'en servent pas pour s'aiguiller, mais une requête
   * qui annonce POST là où elle met à jour égare quiconque lit le journal.
   */
  method?: 'POST' | 'PUT';
  /**
   * Ressource que l'opération vise, et dont l'identifiant doit accompagner la
   * saisie : la parcelle où l'on est intervenu, la préconisation à laquelle on
   * répond. `none` pour une création qui ne dépend de rien d'existant.
   */
  target: 'parcel' | 'recommendation' | 'none';
  path: (operation: SyncOperationInput) => string;
};

const targetId = (operation: SyncOperationInput): string =>
  operation.targetId ?? operation.parcelId ?? '';

/** Liste fermée : la synchronisation ne donne accès à rien d'autre. */
const OPERATIONS: Record<SyncOperationInput['kind'], OperationSpec> = {
  'parcel.create': {
    handler: createParcel as RouteHandler,
    target: 'none',
    path: () => '/api/parcels',
  },
  /**
   * Renommer une parcelle depuis le terrain.
   *
   * La route appelée est celle du site : c'est elle qui vérifie que la
   * parcelle appartient bien à l'exploitation connectée, et qui refuse un
   * numéro interne déjà pris. Le corps envoyé ne porte que des libellés — le
   * schéma de la route accepte d'autres champs, mais l'application n'en met
   * aucun, et ce que le téléphone n'envoie pas, la route ne modifie pas.
   */
  'parcel.rename': {
    handler: updateParcel as RouteHandler,
    method: 'PUT',
    target: 'parcel',
    path: (op) => `/api/parcels/${op.parcelId}`,
  },
  'fertilization.create': {
    handler: createFertilization as RouteHandler,
    target: 'parcel',
    path: (op) => `/api/parcels/${op.parcelId}/fertilization`,
  },
  'phyto.create': {
    handler: createPhyto as RouteHandler,
    target: 'parcel',
    path: (op) => `/api/parcels/${op.parcelId}/phytosanitary`,
  },
  'operation.create': {
    handler: createOperation as RouteHandler,
    target: 'parcel',
    path: (op) => `/api/parcels/${op.parcelId}/operations`,
  },
  // La route appelée est la même qu'en ligne : c'est elle qui vérifie
  // l'appartenance de la parcelle et la cohérence des dates. Un contrôle qui
  // n'existerait que dans le formulaire laisserait passer tout ce qui a été
  // saisi au champ, c'est-à-dire l'essentiel.
  //
  // La route lit la parcelle dans le chemin quand il en porte une, et dans le
  // corps sinon. C'est ce qui permet d'enchaîner « je relève la parcelle au
  // GPS, j'y note le couvert » hors réseau : la file remplace l'identifiant
  // provisoire dans `parcelId`, pas dans le corps de la requête.
  'soilCover.create': {
    handler: createSoilCover as RouteHandler,
    target: 'parcel',
    path: () => '/api/soil-covers',
  },
  // L'expert rédige au champ, sans réseau, et transmet au retour. La route
  // appelée est la même qu'en ligne : c'est elle qui vérifie la mission de
  // conseil, la parcelle citée et la complétude d'une préconisation phyto.
  'recommendation.create': {
    handler: createRecommendation as RouteHandler,
    target: 'none',
    path: (op) => `/api/recommendations?farmId=${encodeURIComponent(op.farmId ?? '')}`,
  },
  'recommendation.respond': {
    handler: respondToRecommendation as RouteHandler,
    target: 'recommendation',
    path: (op) => `/api/recommendations/${targetId(op)}/response`,
  },
};

const MISSING_TARGET: Record<OperationSpec['target'], string> = {
  parcel: 'Parcelle non précisée pour cette opération.',
  recommendation: 'Préconisation non précisée pour cette opération.',
  none: '',
};

/**
 * En-têtes recopiés vers la sous-requête.
 *
 * L'authentification, l'origine et l'adresse d'appel doivent être celles de la
 * requête de synchronisation : les contrôles des routes appelées portent alors
 * exactement sur le même appelant.
 */
const FORWARDED_HEADERS = [
  'authorization',
  'cookie',
  'origin',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
];

function subRequest(
  original: NextRequest,
  path: string,
  body: unknown,
  idempotencyKey: string,
  method: 'POST' | 'PUT' = 'POST',
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const name of FORWARDED_HEADERS) {
    const value = original.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(IDEMPOTENCY_HEADER, idempotencyKey);

  return new NextRequest(new URL(path, original.nextUrl.origin), {
    method,
    headers,
    body: JSON.stringify(body ?? {}),
  });
}

type OperationResult = {
  clientId: string;
  kind: string;
  status: 'applied' | 'replayed' | 'rejected';
  entityId?: string;
  httpStatus: number;
  message?: string;
  /** Erreurs par champ, pour que l'appareil sache quoi corriger. */
  fieldErrors?: Array<{ field: string; message: string }>;
  /**
   * Avertissements réglementaires produits par la route appelée : surdosage,
   * produit retiré, sol drainé.
   *
   * Ils sont remontés jusqu'ici parce qu'une saisie faite au champ passe par
   * cette file d'attente et par nulle part ailleurs. Les laisser tomber
   * reviendrait à contrôler les traitements saisis au bureau et à ignorer ceux
   * saisis dans la parcelle — l'inverse de ce qu'il faut.
   */
  warnings?: string[];
};

/** POST /api/sync — rejoue un lot de saisies faites hors ligne. */
export const POST = route(async (request: NextRequest) => {
  // Une seule vérification d'appartenance ici ; chaque route appelée refera la
  // sienne, avec la permission qui lui est propre.
  await requireFarmAccess('record:read');

  const input = await parseBody(request, syncPushSchema);
  const results: OperationResult[] = [];

  // Séquentiel et non parallèle : l'ordre de saisie est significatif, et une
  // parcelle créée en début de lot doit exister pour la suite.
  for (const operation of input.operations) {
    const spec = OPERATIONS[operation.kind];

    if (spec.target !== 'none' && !targetId(operation)) {
      results.push({
        clientId: operation.clientId,
        kind: operation.kind,
        status: 'rejected',
        httpStatus: 400,
        message: MISSING_TARGET[spec.target],
      });
      continue;
    }

    const response = await spec.handler(
      subRequest(
        request,
        spec.path(operation),
        operation.payload,
        operation.clientId,
        spec.method ?? 'POST',
      ),
      { params: Promise.resolve({ id: targetId(operation) }) },
    );

    const replayed = response.headers.get(REPLAY_HEADER) === 'true';
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as
      | {
          id?: string;
          warnings?: unknown;
          error?: { message?: string; details?: unknown };
        }
      | null;

    if (response.ok) {
      const warnings = Array.isArray(body?.warnings)
        ? (body.warnings as unknown[]).filter(
            (w): w is string => typeof w === 'string',
          )
        : [];

      results.push({
        clientId: operation.clientId,
        kind: operation.kind,
        status: replayed ? 'replayed' : 'applied',
        ...(body?.id ? { entityId: body.id } : {}),
        httpStatus: response.status,
        ...(warnings.length ? { warnings } : {}),
      });
      continue;
    }

    const details = Array.isArray(body?.error?.details)
      ? (body.error.details as Array<{ field: string; message: string }>)
      : undefined;

    results.push({
      clientId: operation.clientId,
      kind: operation.kind,
      status: 'rejected',
      httpStatus: response.status,
      message: body?.error?.message ?? `Erreur ${response.status}`,
      ...(details ? { fieldErrors: details } : {}),
    });
  }

  const applied = results.filter((r) => r.status !== 'rejected').length;

  return ok({
    syncedAt: new Date().toISOString(),
    applied,
    rejected: results.length - applied,
    results,
  });
});

/**
 * GET /api/sync?since=… — changements depuis la dernière relève.
 * Sans `since`, la réponse couvre les trente derniers jours.
 */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('parcel:read');
  const query = parseQuery(request, syncPullSchema);

  const since = query.since
    ? new Date(query.since)
    : new Date(Date.now() - 30 * 24 * 3600 * 1000);

  if (Number.isNaN(since.getTime())) {
    throw badRequest('Paramètre « since » invalide (attendu : date ISO 8601).');
  }

  return ok(await getChangesSince(ctx, since));
});
