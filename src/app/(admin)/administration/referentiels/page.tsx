import type { Metadata } from 'next';
import { requirePageAdminScope } from '@/lib/auth/page-guards';
import { getReferentialStates, type VersionReferentiel } from '@/lib/regulatory/referentials';
import { prisma } from '@/lib/prisma';
import { Badge, Card, PageHeader, TableWrapper, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Référentiels' };

/**
 * Référentiels réglementaires.
 *
 * Ce que cet écran doit rendre évident, dans cet ordre :
 *
 *  1. **ce qui est intégré, et pour quoi** : chaque version conservée, avec son
 *     millésime, son territoire, sa source, sa période de validité, le nombre
 *     d'entrées et ce que Parcelys en emploie ;
 *  2. **ce qui manque** : un référentiel n'y est ni « importé » ni « absent »
 *     en bloc — il est intégré pour ce qu'il contient, et ses manques sont
 *     listés avec leur conséquence ;
 *  3. **ce qui n'est pas importé du tout**, avec la phrase qui dit ce que
 *     Parcelys ne peut pas faire sans lui.
 *
 * Un référentiel intégré n'affiche jamais « Non importé » : le statut est lu
 * sur ses versions en base, pas déduit d'une variable d'environnement.
 */

const STATUTS: Record<string, { tone: 'green' | 'neutral' | 'amber' | 'red'; libelle: string }> = {
  ACTIF: { tone: 'green', libelle: 'Actif' },
  NON_CONFIGURE: { tone: 'neutral', libelle: 'Non importé' },
  IMPORT_EN_COURS: { tone: 'amber', libelle: 'Import en cours' },
  REMPLACE: { tone: 'neutral', libelle: 'Remplacé' },
  ECHEC: { tone: 'red', libelle: 'Échec' },
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : null;

function validite(v: VersionReferentiel, code?: string): string {
  // Les doses de référence IFT valent pour une campagne, que la version nomme.
  if (code === 'ift-doses-reference' && /^\d{4}$/.test(v.version)) return `Campagne ${v.version}`;
  const du = date(v.appliesFrom);
  const au = date(v.appliesTo);
  if (!du && !au) return 'Non datée par la source';
  if (du && au) return `Du ${du} au ${au}`;
  return du ? `Depuis le ${du}` : `Jusqu’au ${au}`;
}

function Integration({ v }: { v: VersionReferentiel }) {
  if (!v.integration) {
    return <Badge tone="neutral">Non documentée</Badge>;
  }
  return v.integration.etat === 'complet' ? (
    <Badge tone="green">Intégré</Badge>
  ) : (
    <Badge tone="amber">Intégré en partie</Badge>
  );
}

export default async function ReferentialsPage() {
  await requirePageAdminScope('referentials:manage');

  const [etats, journal] = await Promise.all([
    getReferentialStates(),
    prisma.regulatoryImport.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { referential: { select: { code: true, version: true, territory: true } } },
    }),
  ]);

  const manquants = etats.filter((e) => e.versions.length === 0);
  const presents = etats.filter((e) => e.versions.length > 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Référentiels réglementaires"
        description="Ce qui est intégré, dans quelle version, pour quel territoire, et ce qui manque"
      />

      {/* Vue d'ensemble : une ligne par version conservée. */}
      <Card className="mb-5" padded={false}>
        <div className="p-4 pb-0">
          <h2 className="text-[16px] font-semibold text-ink">Vue d’ensemble</h2>
        </div>
        <TableWrapper>
          <thead>
            <tr>
              <Th>Référentiel</Th>
              <Th>Statut</Th>
              <Th>Version</Th>
              <Th>Millésime</Th>
              <Th>Territoire</Th>
              <Th>Source</Th>
              <Th>Importé le</Th>
              <Th>Validité</Th>
              <Th align="right">Entrées</Th>
              <Th>Intégration</Th>
              <Th align="right">Manques</Th>
            </tr>
          </thead>
          <tbody>
            {etats.flatMap((ref) =>
              ref.versions.length === 0
                ? [
                    <tr key={ref.code}>
                      <Td>
                        <span className="font-medium text-ink">{ref.name}</span>
                      </Td>
                      <Td>
                        <Badge tone="neutral">Non importé</Badge>
                      </Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td className="max-w-[220px] text-xs">{ref.sourceLabel}</Td>
                      <Td>—</Td>
                      <Td>—</Td>
                      <Td align="right">—</Td>
                      <Td>—</Td>
                      <Td align="right">—</Td>
                    </tr>,
                  ]
                : ref.versions.map((v, i) => (
                    <tr key={v.id}>
                      <Td>
                        {i === 0 ? <span className="font-medium text-ink">{ref.name}</span> : null}
                      </Td>
                      <Td>
                        <Badge tone={STATUTS[v.status]?.tone ?? 'neutral'}>
                          {STATUTS[v.status]?.libelle ?? v.status}
                        </Badge>
                      </Td>
                      <Td className="max-w-[200px] text-xs">
                        <span className="line-clamp-3" title={v.version}>
                          {v.version}
                        </span>
                      </Td>
                      <Td>{v.integration?.millesime ?? '—'}</Td>
                      <Td>{v.territory ?? 'National'}</Td>
                      <Td className="min-w-[200px] max-w-[260px] text-xs">
                        <span className="line-clamp-3" title={v.sourceLabel}>
                          {v.sourceLabel}
                        </span>
                      </Td>
                      <Td>{date(v.importedAt) ?? '—'}</Td>
                      <Td className="text-xs">{validite(v, ref.code)}</Td>
                      <Td align="right" className="tabular-nums">
                        {v.recordCount.toLocaleString('fr-FR')}
                      </Td>
                      <Td>
                        <Integration v={v} />
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {v.integration ? v.integration.manques.length : '—'}
                      </Td>
                    </tr>
                  )),
            )}
          </tbody>
        </TableWrapper>
      </Card>

      {/* Le détail : ce que chaque version contient, ce qui lui manque. */}
      <div className="mb-5 space-y-4">
        {presents.map((ref) => (
          <Card key={ref.code}>
            <h2 className="text-[16px] font-semibold text-ink">{ref.name}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{ref.usage}</p>
            <div className="mt-3 space-y-4">
              {ref.versions.map((v) => (
                <div key={v.id} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-medium text-ink">Version {v.version}</span>
                    <Badge tone={STATUTS[v.status]?.tone ?? 'neutral'}>
                      {STATUTS[v.status]?.libelle ?? v.status}
                    </Badge>
                    <Integration v={v} />
                  </div>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                    <div>
                      <dt className="inline text-ink-3">Millésime : </dt>
                      <dd className="inline text-ink">{v.integration?.millesime ?? 'non déclaré par la source'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-ink-3">Territoire : </dt>
                      <dd className="inline text-ink">{v.territory ?? 'national'}</dd>
                    </div>
                    <div>
                      <dt className="inline text-ink-3">Validité : </dt>
                      <dd className="inline text-ink">{validite(v, ref.code)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-ink-3">Importé le : </dt>
                      <dd className="inline text-ink">{date(v.importedAt) ?? '—'}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline text-ink-3">Source : </dt>
                      <dd className="inline text-ink">
                        {v.sourceLabel}
                        {v.sourceUrl ? <span className="block break-all text-xs text-ink-3">{v.sourceUrl}</span> : null}
                      </dd>
                    </div>
                  </dl>

                  {v.integration && v.integration.elements.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[12.5px] font-medium text-ink-2">Intégré</p>
                      <ul className="mt-0.5 grid gap-x-6 text-[12.5px] text-ink-2 sm:grid-cols-2">
                        {v.integration.elements.map((e) => (
                          <li key={e.quoi}>
                            <span className="tabular-nums">{e.nombre.toLocaleString('fr-FR')}</span> {e.quoi}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {v.integration && v.integration.manques.length > 0 ? (
                    <div className="mt-2">
                      <p className="text-[12.5px] font-medium text-ink-2">Données manquantes</p>
                      <ul className="mt-0.5 space-y-1">
                        {v.integration.manques.map((m, i) => (
                          <li key={`${m.quoi}-${i}`} className="text-[12.5px] leading-snug text-ink-3">
                            <span className="font-medium text-ink-2">{m.quoi}</span> — {m.pourquoi}{' '}
                            <span className="text-ink-2">→ {m.consequence}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : v.integration ? (
                    <p className="mt-2 text-[12.5px] text-ink-3">Aucune donnée manquante relevée à l’import.</p>
                  ) : (
                    <p className="mt-2 text-[12.5px] text-ink-3">
                      L’import de cette version n’a pas documenté ce qu’il contient : relancez-le pour
                      l’obtenir.
                    </p>
                  )}

                  {v.integration && v.integration.fichiers.length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer select-none text-[12.5px] text-ink-2">
                        Fichiers sources vérifiés ({v.integration.fichiers.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-ink-3">
                        {v.integration.fichiers.map((f) => (
                          <li key={f.chemin} className="break-all">
                            {f.chemin} — {(f.octets / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo —
                            SHA-256 <code>{f.sha256.slice(0, 16)}…</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {v.notes ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer select-none text-[12.5px] text-ink-2">Notes d’import</summary>
                      <p className="mt-1 whitespace-pre-line text-[12px] text-ink-3">{v.notes}</p>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {manquants.length > 0 ? (
        <Card className="mb-5">
          <h2 className="text-[16px] font-semibold text-ink">
            {manquants.length} référentiel{manquants.length > 1 ? 's' : ''} non importé
            {manquants.length > 1 ? 's' : ''}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
            Parcelys ne calcule rien à leur place. Les vérifications correspondantes restent
            « indéterminées » et le signalent — c’est volontaire : une valeur inventée serait pire
            qu’une valeur absente.
          </p>
          <ul className="mt-3 space-y-2.5">
            {manquants.map((ref) => (
              <li key={ref.code} className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[14px] font-medium text-ink">{ref.name}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{ref.degradedWithout}</p>
                <p className="mt-1.5 text-[12.5px] text-ink-3">Source : {ref.sourceLabel}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">
                  Variable : <code className="rounded bg-surface px-1">{ref.envVar}</code>{' '}
                  {ref.configured ? '(renseignée)' : '(absente du .env)'}
                </p>
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
                <Th align="right">Entrées</Th>
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
                    <Badge
                      tone={entree.status === 'SUCCESS' ? 'green' : entree.status === 'RUNNING' ? 'amber' : 'red'}
                    >
                      {entree.status === 'SUCCESS' ? 'Réussi' : entree.status === 'RUNNING' ? 'En cours' : 'Échec'}
                    </Badge>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {entree.recordCount.toLocaleString('fr-FR')}
                  </Td>
                  <Td className="max-w-[320px] text-xs">{entree.errorMessage ?? entree.warnings ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        )}
      </Card>
    </div>
  );
}
