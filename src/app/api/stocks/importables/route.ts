import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireFarmAccess } from '@/lib/auth/rbac';
import { ok, parseBody, route } from '@/lib/api/handler';
import { badRequest } from '@/lib/api/errors';
import { produitsImportables } from '@/lib/services/stock';
import { uniteConnue, UNITES_COURANTES } from '@/lib/stock/units';
import { logAudit } from '@/lib/audit';

/**
 * Importer en stock les produits que l'exploitation emploie déjà.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE RÉSOUT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Les traitements et les apports nomment leur produit depuis le premier jour.
 * Le suivi de stock, lui, partait d'une page blanche : il fallait ressaisir à
 * la main des produits que Parcelys connaissait déjà, au risque de les nommer
 * autrement — et deux orthographes du même bidon ne se rapprochent plus jamais.
 *
 * `GET` liste ce qui est employé sans être suivi. `POST` crée les articles
 * correspondants, avec le rattachement au référentiel — c'est ce rattachement
 * qui permettra ensuite à `utilisationsNonRattachees()` de faire son travail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ROUTE DE CRÉATION GROUPÉE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `POST /api/stocks` crée un article et convient très bien pour un produit.
 * Mais le cas d'usage ici est « je démarre mon suivi de stock », et un
 * exploitant qui saisit depuis deux ans en a quinze ou vingt d'un coup. Quinze
 * requêtes dont la septième échoue laissent l'écran dans un état que personne
 * ne sait décrire.
 *
 * Cette route rend donc **un résultat par produit demandé** — créé, déjà suivi,
 * ou refusé avec son motif — plutôt qu'un succès global qui masquerait les
 * refus. L'écran affiche le détail : c'est plus honnête qu'un « 15 produits
 * importés » dont trois ne le sont pas.
 */

/** GET /api/stocks/importables — ce qui est employé et pas encore suivi. */
export const GET = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:read', request.nextUrl.searchParams.get('farmId'));

  const produits = await produitsImportables(ctx.farmId);

  return ok({
    produits,
    unitesCourantes: UNITES_COURANTES,
    /**
     * Affiché tel quel par l'écran. Importer un produit crée le **suivi**, pas
     * le stock : le solde reste à zéro tant qu'aucune entrée n'est saisie. Le
     * dire ici évite qu'un exploitant croie son local inventorié parce qu'une
     * liste s'est remplie.
     */
    avertissement:
      'Importer un produit crée son suivi, pas son stock. Le solde restera à zéro ' +
      'tant que vous n’aurez pas saisi une entrée (un achat, un inventaire de départ).',
  });
});

const Selection = z.object({
  source: z.enum(['phyto', 'engrais', 'organique']),
  refId: z.string().trim().min(1).max(40),
  /** Unité de gestion du stock. Imposée par l'appelant : jamais devinée ici. */
  unit: z.string().trim().min(1).max(20),
  /** Nom de l'article ; à défaut, celui du référentiel. */
  name: z.string().trim().min(1).max(200).optional(),
  alertThreshold: z.number().positive().nullable().optional(),
});

const Demande = z.object({
  selections: z.array(Selection).min(1).max(100),
});

type Resultat = {
  refId: string;
  source: 'phyto' | 'engrais' | 'organique';
  label: string;
  etat: 'cree' | 'deja-suivi' | 'refuse';
  itemId?: string;
  motif?: string;
};

/** POST /api/stocks/importables — crée les articles pour les produits choisis. */
export const POST = route(async (request: NextRequest) => {
  const ctx = await requireFarmAccess('record:write');
  const body = await parseBody(request, Demande);

  // Un même produit demandé deux fois dans le même envoi : on ne le traite
  // qu'une fois, sinon le second passage se heurterait au premier.
  const vues = new Set<string>();
  const selections = body.selections.filter((s) => {
    const cle = `${s.source}:${s.refId}`;
    if (vues.has(cle)) return false;
    vues.add(cle);
    return true;
  });

  const resultats: Resultat[] = [];

  for (const selection of selections) {
    const resolu = await resoudreProduit(ctx.farmId, selection.source, selection.refId);
    if (!resolu) {
      resultats.push({
        refId: selection.refId,
        source: selection.source,
        label: selection.name ?? selection.refId,
        etat: 'refuse',
        motif: 'Produit introuvable au référentiel de cette exploitation.',
      });
      continue;
    }

    if (!uniteConnue(selection.unit)) {
      resultats.push({
        refId: selection.refId,
        source: selection.source,
        label: resolu.label,
        etat: 'refuse',
        motif:
          `Unité « ${selection.unit} » inconnue de Parcelys. ` +
          `Unités reconnues : ${UNITES_COURANTES.join(', ')}.`,
      });
      continue;
    }

    // Déjà suivi ? On le dit, on ne crée pas de doublon. Le rattachement au
    // référentiel est le critère : c'est lui qui compte, pas le nom.
    const dejaRattache = await prisma.stockItem.findFirst({
      where: { farmId: ctx.farmId, [resolu.champ]: selection.refId },
      select: { id: true, name: true, archivedAt: true },
    });
    if (dejaRattache) {
      resultats.push({
        refId: selection.refId,
        source: selection.source,
        label: resolu.label,
        etat: 'deja-suivi',
        itemId: dejaRattache.id,
        motif: dejaRattache.archivedAt
          ? `« ${dejaRattache.name} » existe déjà, archivé. Réactivez-le plutôt que d’en créer un second.`
          : undefined,
      });
      continue;
    }

    const nom = selection.name ?? resolu.label;

    /*
     * Le nom peut déjà exister sans être rattaché : c'est précisément le cas
     * qu'on veut réparer — un article saisi à la main avant que l'import
     * n'existe. On le **rattache** au lieu d'en créer un second, sinon
     * l'exploitant se retrouve avec deux lignes pour le même bidon, dont l'une
     * porte l'historique et l'autre le référentiel.
     */
    const homonyme = await prisma.stockItem.findFirst({
      where: { farmId: ctx.farmId, category: resolu.categorie, name: nom },
      select: { id: true, phytoProductId: true, fertilizerId: true, organicInputId: true },
    });

    if (homonyme) {
      const dejaAutreRef =
        homonyme.phytoProductId ?? homonyme.fertilizerId ?? homonyme.organicInputId;
      if (dejaAutreRef) {
        resultats.push({
          refId: selection.refId,
          source: selection.source,
          label: resolu.label,
          etat: 'refuse',
          motif: `« ${nom} » existe déjà et pointe vers un autre produit du référentiel.`,
        });
        continue;
      }

      const rattache = await prisma.stockItem.update({
        where: { id: homonyme.id },
        data: { [resolu.champ]: selection.refId },
        select: { id: true },
      });
      await logAudit({
        action: 'stock.item.linked',
        userId: ctx.user.id,
        farmId: ctx.farmId,
        entity: 'stockItem',
        entityId: rattache.id,
        metadata: { rattachement: resolu.champ, refId: selection.refId, nom },
      });
      resultats.push({
        refId: selection.refId,
        source: selection.source,
        label: resolu.label,
        etat: 'cree',
        itemId: rattache.id,
        motif: `Article existant « ${nom} » rattaché au référentiel.`,
      });
      continue;
    }

    const article = await prisma.stockItem.create({
      data: {
        farmId: ctx.farmId,
        category: resolu.categorie,
        name: nom,
        unit: selection.unit,
        alertThreshold: selection.alertThreshold ?? null,
        [resolu.champ]: selection.refId,
      },
      select: { id: true },
    });

    await logAudit({
      action: 'stock.item.created',
      userId: ctx.user.id,
      farmId: ctx.farmId,
      entity: 'stockItem',
      entityId: article.id,
      metadata: { source: selection.source, refId: selection.refId, nom, unite: selection.unit },
    });

    resultats.push({
      refId: selection.refId,
      source: selection.source,
      label: resolu.label,
      etat: 'cree',
      itemId: article.id,
    });
  }

  const crees = resultats.filter((r) => r.etat === 'cree').length;
  const refuses = resultats.filter((r) => r.etat === 'refuse').length;
  const dejaSuivis = resultats.filter((r) => r.etat === 'deja-suivi').length;

  /*
   * Rien n'a pu être fait : c'est un échec, et le code de retour doit le dire.
   *
   * Un lot partiellement appliqué reste un succès — l'appelant lit le détail
   * pour savoir ce qui est passé. Mais quand **toutes** les demandes sont
   * refusées, un 200 ment à quiconque ne lit que le statut : un script, une
   * sonde, ou l'audit de cloisonnement, qui a justement relevé qu'une tentative
   * d'importer le produit d'une autre exploitation « aboutissait » en 200 alors
   * qu'elle n'avait rien créé.
   *
   * Le motif reste le même pour un produit inexistant et pour celui d'un
   * voisin — « introuvable au référentiel de cette exploitation ». Les
   * distinguer dirait au demandeur que l'identifiant existe ailleurs.
   */
  if (crees === 0 && dejaSuivis === 0) {
    throw badRequest(
      refuses === 1
        ? (resultats[0]?.motif ?? 'Aucun produit n’a pu être importé.')
        : `Aucun des ${refuses} produits demandés n’a pu être importé.`,
      resultats,
    );
  }

  return ok({ resultats, crees, refuses, dejaSuivis }, crees > 0 ? 201 : 200);
});

/**
 * Retrouve un produit au référentiel, en vérifiant qu'il est bien accessible à
 * cette exploitation.
 *
 * Le catalogue E-Phy est commun à tous — c'est un référentiel public. Les
 * engrais et produits organiques peuvent en revanche être **propres à une
 * exploitation** (`farmId` non nul) : accepter un identifiant sans ce contrôle
 * ferait apparaître dans un stock le produit personnalisé du voisin.
 */
async function resoudreProduit(
  farmId: string,
  source: 'phyto' | 'engrais' | 'organique',
  refId: string,
): Promise<{ label: string; categorie: 'PHYTOSANITAIRE' | 'ENGRAIS' | 'AMENDEMENT'; champ: 'phytoProductId' | 'fertilizerId' | 'organicInputId' } | null> {
  if (source === 'phyto') {
    const p = await prisma.phytosanitaryProduct.findUnique({
      where: { id: refId },
      select: { name: true },
    });
    return p ? { label: p.name, categorie: 'PHYTOSANITAIRE', champ: 'phytoProductId' } : null;
  }

  if (source === 'engrais') {
    const f = await prisma.fertilizer.findFirst({
      where: { id: refId, OR: [{ farmId }, { farmId: null }] },
      select: { name: true },
    });
    return f ? { label: f.name, categorie: 'ENGRAIS', champ: 'fertilizerId' } : null;
  }

  const o = await prisma.organicInput.findFirst({
    where: { id: refId, OR: [{ farmId }, { farmId: null }] },
    select: { name: true },
  });
  return o ? { label: o.name, categorie: 'AMENDEMENT', champ: 'organicInputId' } : null;
}
