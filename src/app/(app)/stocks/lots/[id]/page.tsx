import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { tracabiliteLot } from '@/lib/services/stock';
import {
  Alert,
  Card,
  PageHeader,
  Td,
  Th,
  Tr,
  TableWrapper,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Traçabilité d’un lot' };

const NATURES: Record<string, string> = {
  ENTREE: 'Réception',
  SORTIE: 'Utilisation',
  AJUSTEMENT: 'Inventaire',
  RETOUR: 'Retour fournisseur',
  DESTRUCTION: 'Élimination',
};

/**
 * Où est parti ce lot ?
 *
 * C'est la question posée lors d'un contrôle, dans ces termes-là. L'écran y
 * répond par un tableau : date, parcelle, culture, quantité. Rien d'autre n'a
 * besoin d'y figurer.
 */
export default async function LotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePageFarmAccess('record:read');
  const { id } = await params;

  const trace = await tracabiliteLot(ctx.farmId, id);
  if (!trace) notFound();

  const sorties = trace.emplois.filter((e) => e.nature === 'SORTIE');
  const sansParcelle = sorties.filter((e) => !e.parcelName).length;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={trace.lot.lotNumber ? `Lot ${trace.lot.lotNumber}` : 'Lot sans numéro'}
        description={trace.lot.itemName}
      />

      <Card className="mb-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-[12.5px] text-ink-3">Fournisseur</dt>
            <dd className="text-[14px] text-ink">{trace.lot.supplier ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Acheté le</dt>
            <dd className="text-[14px] text-ink">
              {trace.lot.purchasedOn ? formatDateFr(trace.lot.purchasedOn) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Date limite</dt>
            <dd className="text-[14px] text-ink">
              {trace.lot.expiresOn ? formatDateFr(trace.lot.expiresOn) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Reste</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-ink">
              {formatNumberFr(trace.reste.quantite, 3)} {trace.lot.unit}
            </dd>
          </div>
        </dl>

        {!trace.lot.lotNumber ? (
          <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink-3">
            Ce lot n’a pas de numéro. C’est précisément ce qu’un contrôle
            demande : renseignez-le depuis l’emballage tant qu’il est
            disponible.
          </p>
        ) : null}
      </Card>

      {sansParcelle > 0 ? (
        <Alert tone="warning" className="mb-5">
          {sansParcelle} sortie(s) de ce lot ne sont rattachées à aucune
          parcelle. La quantité est décomptée, mais la traçabilité s’arrête là.
        </Alert>
      ) : null}

      <Card>
        <h2 className="text-[16px] font-semibold text-ink">Mouvements</h2>

        {trace.emplois.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-2">
            Aucun mouvement enregistré sur ce lot.
          </p>
        ) : (
          <TableWrapper className="mt-3">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Nature</Th>
                  <Th>Parcelle</Th>
                  <Th>Culture</Th>
                  <Th className="text-right">Quantité</Th>
                </tr>
              </thead>
              <tbody>
                {trace.emplois.map((e, i) => (
                  <Tr key={`${e.date.toISOString()}-${i}`}>
                    <Td>{formatDateFr(e.date)}</Td>
                    <Td>{NATURES[e.nature] ?? e.nature}</Td>
                    <Td>{e.parcelName ?? '—'}</Td>
                    <Td>{e.culture ?? '—'}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumberFr(e.quantite, 3)} {e.unite}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}
