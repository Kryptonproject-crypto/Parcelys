import type { Metadata } from 'next';
import { requirePageAdmin } from '@/lib/auth/page-guards';
import { getReferentialStates } from '@/lib/regulatory/referentials';
import { prisma } from '@/lib/prisma';
import { Badge, Card, PageHeader, TableWrapper, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Référentiels' };

/**
 * Centre des référentiels réglementaires.
 *
 * Ce que cet écran doit rendre évident : **ce qui n'est pas importé**. Un
 * centre de référentiels qui ne montrerait que les jeux présents laisserait
 * croire que la liste est complète, et l'absence d'un zonage passerait pour
 * l'absence de zonage.
 *
 * Chaque référentiel manquant affiche donc sa source officielle, la variable
 * d'environnement à renseigner, et surtout la phrase qui dit ce que Parcelys ne
 * peut pas faire sans lui.
 */

const STATUTS: Record<string, { tone: 'green' | 'neutral' | 'amber' | 'red'; libelle: string }> = {
  ACTIF: { tone: 'green', libelle: 'Actif' },
  NON_CONFIGURE: { tone: 'neutral', libelle: 'Non importé' },
  IMPORT_EN_COURS: { tone: 'amber', libelle: 'Import en cours' },
  REMPLACE: { tone: 'neutral', libelle: 'Remplacé' },
  ECHEC: { tone: 'red', libelle: 'Échec' },
};

export default async function ReferentialsPage() {
  await requirePageAdmin();

  const [etats, journal] = await Promise.all([
    getReferentialStates(),
    prisma.regulatoryImport.findMany({
      orderBy: { startedAt: 'desc' },
      take: 15,
      include: { referential: { select: { code: true, version: true, territory: true } } },
    }),
  ]);

  const manquants = etats.filter((e) => e.status === 'NON_CONFIGURE');

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Référentiels réglementaires"
        description="Sources officielles, versions en vigueur et journal des imports"
      />

      {manquants.length > 0 ? (
        <Card className="mb-5">
          <h2 className="text-[16px] font-semibold text-ink">
            {manquants.length} référentiel{manquants.length > 1 ? 's' : ''} non importé
            {manquants.length > 1 ? 's' : ''}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
            Parcelys ne calcule rien à leur place. Les vérifications
            correspondantes restent « indéterminées » et le signalent — c’est
            volontaire : une valeur inventée serait pire qu’une valeur absente.
          </p>
          <ul className="mt-3 space-y-2.5">
            {manquants.map((ref) => (
              <li key={ref.code} className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[14px] font-medium text-ink">{ref.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                  {ref.degradedWithout}
                </p>
                <p className="mt-1.5 text-[12.5px] text-ink-3">
                  Source : {ref.sourceLabel}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  Variable : <code className="rounded bg-surface px-1">{ref.envVar}</code>{' '}
                  {ref.configured ? '(renseignée)' : '(absente du .env)'}
                </p>
                {/* La découverte d'abord : les zonages sont régionaux, et
                    l'identifiant du bon jeu ne se devine pas. */}
                {ref.datagouv ? (
                  <>
                    <p className="mt-1.5 text-[12.5px] text-ink-3">
                      Chercher :{' '}
                      <code className="rounded bg-surface px-1">
                        npm run referentiels -- chercher --code {ref.code}
                        {ref.territorial ? ' --territoire "votre région"' : ''}
                      </code>
                    </p>
                    {ref.datagouv.note ? (
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ble-700 dark:text-ble-300">
                        ⚠ {ref.datagouv.note}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-ink-3">
                    Import :{' '}
                    <code className="rounded bg-surface px-1">
                      npm run referentiels -- importer-zonage --code {ref.code} --version …
                    </code>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-5" padded={false}>
        <div className="p-4 pb-0">
          <h2 className="text-[16px] font-semibold text-ink">État des référentiels</h2>
        </div>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Référentiel</Th>
              <Th>Statut</Th>
              <Th>Version</Th>
              <Th>Territoire</Th>
              <Th>Entrées</Th>
              <Th>Importé le</Th>
            </tr>
          </thead>
          <tbody>
            {etats.map((ref) => (
              <tr key={ref.code}>
                <Td>
                  <span className="font-medium text-ink">{ref.name}</span>
                  <span className="block text-xs text-ink-3">{ref.usage}</span>
                </Td>
                <Td>
                  <Badge tone={STATUTS[ref.status]?.tone ?? 'neutral'}>
                    {STATUTS[ref.status]?.libelle ?? ref.status}
                  </Badge>
                </Td>
                <Td>
                  {ref.version ?? '—'}
                  {ref.versionCount > 1 ? (
                    <span className="block text-xs text-ink-3">
                      {ref.versionCount} versions conservées
                    </span>
                  ) : null}
                </Td>
                <Td>{ref.territory ?? '—'}</Td>
                <Td className="tabular-nums">
                  {ref.recordCount > 0 ? ref.recordCount.toLocaleString('fr-FR') : '—'}
                </Td>
                <Td>
                  {ref.importedAt
                    ? new Date(ref.importedAt).toLocaleDateString('fr-FR')
                    : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      </Card>

      {/* Journal : les échecs comptent autant que les succès, et un import
          réussi mais diminué garde la trace de ce qui manquait. */}
      <Card padded={false}>
        <div className="p-4 pb-0">
          <h2 className="text-[16px] font-semibold text-ink">Journal des imports</h2>
        </div>
        {journal.length === 0 ? (
          <p className="p-4 text-[13.5px] text-ink-3">Aucun import enregistré.</p>
        ) : (
          <TableWrapper>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Référentiel</Th>
                <Th>Version</Th>
                <Th>Résultat</Th>
                <Th>Entrées</Th>
                <Th>Remarques</Th>
              </tr>
            </thead>
            <tbody>
              {journal.map((entree) => (
                <tr key={entree.id}>
                  <Td>{entree.startedAt.toLocaleString('fr-FR')}</Td>
                  <Td>{entree.referential.code}</Td>
                  <Td>
                    {entree.referential.version}
                    {entree.referential.territory ? ` (${entree.referential.territory})` : ''}
                  </Td>
                  <Td>
                    <Badge tone={entree.status === 'SUCCESS' ? 'green' : 'red'}>
                      {entree.status === 'SUCCESS' ? 'Réussi' : 'Échec'}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">{entree.recordCount.toLocaleString('fr-FR')}</Td>
                  <Td className="max-w-[320px] text-xs">
                    {entree.errorMessage ?? entree.warnings ?? '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}
