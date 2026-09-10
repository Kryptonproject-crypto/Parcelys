import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageFarmAccess } from '@/lib/auth/page-guards';
import { etatStocks, utilisationsNonRattachees } from '@/lib/services/stock';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Td,
  Th,
  Tr,
  TableWrapper,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Stocks' };

/**
 * Stocks et lots.
 *
 * ## Ce que cet écran affiche, et ce qu'il n'affiche pas
 *
 * Il n'affiche pas « le stock ». Il affiche le **solde des mouvements
 * enregistrés** — et il le dit en toutes lettres, en haut, avant tout chiffre.
 * La différence n'est pas rhétorique : un bidon entamé sans saisie reste
 * compté. Présenter ce solde comme un inventaire serait exactement le genre
 * d'information fabriquée que Parcelys s'interdit.
 *
 * Le bloc des utilisations non rattachées vient en premier quand il n'est pas
 * vide, avant les articles. C'est délibéré : c'est la seule chose sur cet écran
 * qui explique pourquoi un solde pourrait être faux.
 */

const CATEGORIES: Record<string, string> = {
  PHYTOSANITAIRE: 'Phytosanitaire',
  ENGRAIS: 'Engrais',
  AMENDEMENT: 'Amendements',
  SEMENCE: 'Semences',
  AUTRE: 'Autres',
};

const TONS_ALERTE = {
  anomalie: 'red',
  attention: 'amber',
  information: 'neutral',
} as const;

export default async function StocksPage() {
  const ctx = await requirePageFarmAccess('record:read');

  const [articles, nonRattachees] = await Promise.all([
    etatStocks(ctx.farmId),
    utilisationsNonRattachees(ctx.farmId, { limite: 25 }),
  ]);

  const parCategorie = new Map<string, typeof articles>();
  for (const article of articles) {
    const liste = parCategorie.get(article.category) ?? [];
    liste.push(article);
    parCategorie.set(article.category, liste);
  }

  const anomalies = articles.flatMap((a) =>
    a.alertes.filter((al) => al.niveau === 'anomalie'),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Stocks et lots"
        description="Ce qui est entré, ce qui est sorti, et sur quelle parcelle"
      />

      <Alert tone="info" className="mb-5">
        Ce solde est celui des <strong>mouvements enregistrés</strong>, pas un
        inventaire physique. Un achat ou un prélèvement non saisi ne s’y trouve
        pas. Parcelys ne peut pas savoir ce qu’il y a dans le local — il sait ce
        que les saisies impliquent.
      </Alert>

      {anomalies.length > 0 ? (
        <Alert tone="warning" title="À vérifier" className="mb-5">
          <ul className="ml-4 list-disc space-y-1">
            {anomalies.map((a) => (
              <li key={a.message}>{a.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/*
        Placé avant les articles : c'est la seule chose de cet écran qui
        explique pourquoi un solde pourrait ne pas correspondre.
      */}
      {nonRattachees.length > 0 ? (
        <Card className="mb-5">
          <h2 className="text-[16px] font-semibold text-ink">
            Utilisations non rattachées à un lot
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            {nonRattachees.length} enregistrement(s) ont consommé un produit que
            vous suivez en stock, sans qu’un lot leur soit rattaché. Ces
            quantités ne sont donc <strong>pas</strong> déduites des soldes
            ci-dessous. Le rattachement se fait depuis la fiche du traitement ou
            de l’apport.
          </p>

          <TableWrapper className="mt-3">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Parcelle</Th>
                  <Th>Produit</Th>
                  <Th className="text-right">Quantité</Th>
                </tr>
              </thead>
              <tbody>
                {nonRattachees.map((u) => (
                  <Tr key={`${u.kind}-${u.applicationId}`}>
                    <Td>{formatDateFr(u.appliedOn)}</Td>
                    <Td>{u.parcelName}</Td>
                    <Td>{u.productLabel}</Td>
                    <Td className="text-right tabular-nums">
                      {formatNumberFr(u.quantite, 3)} {u.unite}
                    </Td>
                  </Tr>
                ))}
              </tbody>
          </TableWrapper>
        </Card>
      ) : null}

      {articles.length === 0 ? (
        <EmptyState
          title="Aucun article suivi"
          description={
            'Le suivi des stocks est facultatif. Il devient utile pour répondre à ' +
            'une question que pose un contrôle : quel lot a été appliqué sur quelle ' +
            'parcelle. Créez un article depuis un produit de votre registre.'
          }
        />
      ) : null}

      {[...parCategorie.entries()].map(([categorie, liste]) => (
        <Card key={categorie} className="mb-4">
          <h2 className="text-[16px] font-semibold text-ink">
            {CATEGORIES[categorie] ?? categorie}
          </h2>

          <div className="mt-3 space-y-4">
            {liste.map((article) => (
              <div
                key={article.id}
                className="rounded-lg border border-line bg-surface-2 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-ink">{article.name}</p>
                    {article.amm ? (
                      <p className="text-[12.5px] text-ink-3">AMM {article.amm}</p>
                    ) : null}
                  </div>
                  <p className="text-[20px] font-semibold tabular-nums text-ink">
                    {formatNumberFr(article.solde.quantite, 3)}{' '}
                    <span className="text-[13px] font-normal text-ink-3">
                      {article.unit}
                    </span>
                  </p>
                </div>

                {article.alertes.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {article.alertes.map((alerte) => (
                      <li key={alerte.message} className="flex items-start gap-2">
                        <Badge tone={TONS_ALERTE[alerte.niveau]}>
                          {alerte.niveau === 'anomalie'
                            ? 'Anomalie'
                            : alerte.niveau === 'attention'
                              ? 'Attention'
                              : 'Info'}
                        </Badge>
                        <span className="text-[13px] leading-relaxed text-ink-2">
                          {alerte.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {article.lots.length > 0 ? (
                  <TableWrapper className="mt-3">
                      <thead>
                        <tr>
                          <Th>Lot</Th>
                          <Th>Fournisseur</Th>
                          <Th>Acheté le</Th>
                          <Th>Limite</Th>
                          <Th className="text-right">Reste</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {article.lots.map((lot) => (
                          <Tr key={lot.id}>
                            <Td>
                              <Link
                                href={`/stocks/lots/${lot.id}`}
                                className="text-champ-700 underline-offset-2 hover:underline"
                              >
                                {lot.lotNumber ?? 'Sans numéro'}
                              </Link>
                            </Td>
                            <Td>{lot.supplier ?? '—'}</Td>
                            <Td>{lot.purchasedOn ? formatDateFr(lot.purchasedOn) : '—'}</Td>
                            <Td>{lot.expiresOn ? formatDateFr(lot.expiresOn) : '—'}</Td>
                            <Td className="text-right tabular-nums">
                              {formatNumberFr(lot.reste.quantite, 3)} {article.unit}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                  </TableWrapper>
                ) : (
                  <p className="mt-2 text-[13px] text-ink-3">
                    Aucun lot enregistré. Sans numéro de lot, la traçabilité
                    demandée lors d’un contrôle reste incomplète.
                  </p>
                )}

                <p className="mt-2 text-[12px] text-ink-3">
                  {article.nombreMouvements} mouvement(s)
                  {article.dernierMouvementLe
                    ? ` · dernier le ${formatDateFr(article.dernierMouvementLe)}`
                    : ''}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
