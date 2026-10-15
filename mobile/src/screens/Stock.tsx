import { useEffect, useMemo, useState } from 'react';
import type { AppContext } from '../App';
import { readOutbox } from '../lib/db';
import type { QueuedOperation } from '../lib/types';
import { Badge, Button, Card, EmptyState, Header, formatDateFr } from '../components/ui';

/**
 * Le stock phytosanitaire, au champ.
 *
 * Ce qui reste de chaque produit, lot par lot, tel que le serveur l'a calculé
 * à la dernière synchronisation — c'est ce que la saisie d'un traitement
 * proposera. Les achats notés sur le téléphone et pas encore envoyés sont
 * listés à part : ils ne comptent dans le stock qu'une fois enregistrés par
 * le serveur, qui seul tient les soldes.
 */
export function StockScreen({ context }: { context: AppContext }) {
  const { snapshot, navigate, back, readOnly, pending } = context;
  const [enAttente, setEnAttente] = useState<QueuedOperation[]>([]);

  useEffect(() => {
    void readOutbox().then((ops) => setEnAttente(ops.filter((op) => op.kind === 'stock.purchase')));
  }, [pending]);

  const produits = useMemo(() => {
    const parProduit = new Map<
      string,
      {
        nom: string;
        amm: string | null;
        unit: string;
        reste: number;
        lots: NonNullable<NonNullable<typeof snapshot>['referential']['phytoLots']>;
      }
    >();
    for (const lot of snapshot?.referential.phytoLots ?? []) {
      const cle = lot.amm ?? lot.itemId;
      const p = parProduit.get(cle) ?? { nom: lot.itemName, amm: lot.amm, unit: lot.unit, reste: 0, lots: [] };
      p.reste += lot.reste;
      p.lots.push(lot);
      parProduit.set(cle, p);
    }
    return [...parProduit.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [snapshot]);

  const quantite = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Stock phytosanitaire"
        subtitle={snapshot ? `Synchronisé le ${formatDateFr(snapshot.syncedAt)}` : undefined}
        onBack={back}
      />

      <div className="flex-1 space-y-3 px-4 py-4">
        {readOnly ? null : (
          <Button full onClick={() => navigate({ name: 'new-purchase' })}>
            Enregistrer un achat
          </Button>
        )}

        {enAttente.length > 0 ? (
          <Card>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Achats en attente d’envoi — {enAttente.length}
            </h2>
            <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
              Notés sur le téléphone : ils entreront dans le stock une fois enregistrés par le
              serveur, à la prochaine synchronisation.
            </p>
            <ul className="mt-2 space-y-1">
              {enAttente.map((op) => (
                <li key={op.clientId} className="text-[13.5px] text-ink">
                  {op.label}
                  {op.lastError ? (
                    <span className="block text-[12px] text-red-700 dark:text-red-400">{op.lastError}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {produits.length === 0 ? (
          <EmptyState
            title="Aucun produit en stock"
            description="Enregistrez vos achats ici ou sur le site : à la saisie d’un traitement, les produits en stock seront proposés d’abord, avec leur lot."
          />
        ) : (
          produits.map((p) => (
            <Card key={`${p.amm ?? p.nom}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{p.nom}</p>
                  {p.amm ? <p className="text-[12.5px] text-ink-3">AMM {p.amm}</p> : null}
                </div>
                <Badge tone="green">
                  {quantite(p.reste)} {p.unit}
                </Badge>
              </div>
              <ul className="mt-2 space-y-0.5">
                {p.lots.map((lot) => (
                  <li key={lot.id} className="text-[12.5px] text-ink-2">
                    {lot.lotNumber ? `Lot ${lot.lotNumber}` : 'Lot sans numéro'} · reste {quantite(lot.reste)}{' '}
                    {lot.unit}
                    {lot.expiresOn ? ` · DLU ${formatDateFr(lot.expiresOn)}` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
