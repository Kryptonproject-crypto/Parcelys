'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ApiRequestError, apiDelete } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import {
  DOCUMENT_CATEGORY_LABELS,
  OPERATION_LABELS,
  PARCEL_STATUS_LABELS,
} from '@/lib/constants/agronomy';
import { formatBytes } from '@/lib/storage/format';
import { Modal } from '@/components/forms/Modal';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import { CropYearForm } from '@/components/forms/CropYearForm';
import { FertilizationForm } from '@/components/forms/FertilizationForm';
import { PhytoForm } from '@/components/forms/PhytoForm';
import { OperationForm } from '@/components/forms/OperationForm';
import { DocumentUpload } from '@/components/forms/DocumentUpload';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  TableWrapper,
  Td,
  Th,
  formatDateFr,
  formatNumberFr,
} from '@/components/ui';
import type { ParcelTabsProps } from '@/app/(app)/parcelles/[id]/types';
import { IconAttachment, IconCrops, IconDocuments, IconFile, IconHistory, IconImage, IconInputs, IconOperation, IconPhyto } from '@/components/ui/icons';

const TABS = [
  { key: 'general', label: 'Général' },
  { key: 'culture', label: 'Culture' },
  { key: 'apports', label: 'Apports' },
  { key: 'phytosanitaire', label: 'Phytosanitaire' },
  { key: 'travaux', label: 'Travaux' },
  { key: 'historique', label: 'Historique' },
  { key: 'documents', label: 'Documents' },
] as const;

const HISTORY_TONES: Record<string, 'green' | 'blue' | 'amber' | 'neutral'> = {
  CROP: 'green',
  HARVEST: 'green',
  FERTILIZATION: 'blue',
  PHYTO: 'amber',
  OPERATION: 'neutral',
  DOCUMENT: 'neutral',
};

type ModalKind = 'crop' | 'fertilization' | 'phyto' | 'operation' | 'document' | null;

export function ParcelTabs(props: ParcelTabsProps) {
  const {
    activeTab,
    canWrite,
    parcel,
    campaignYear,
    cropYears,
    fertilizations,
    balance,
    phytoTreatments,
    operations,
    documents,
    history,
    referentials,
    ephySource,
  } = props;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const confirmation = useConfirm();
  const [modal, setModal] = useState<ModalKind>(null);

  function selectTab(key: string): void {
    const params = new URLSearchParams(searchParams.toString());
    params.set('onglet', key);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  /** Demande confirmation, supprime, puis notifie — sans bloquer l'interface. */
  function askRemove(params: {
    endpoint: string;
    title: string;
    message: string;
    detail?: string;
    successMessage: string;
  }): void {
    confirmation.ask({
      title: params.title,
      message: params.message,
      detail: params.detail,
      onConfirm: async () => {
        try {
          await apiDelete(params.endpoint);
          router.refresh();
          toast.success(params.successMessage);
        } catch (error) {
          throw new Error(
            error instanceof ApiRequestError
              ? error.message
              : 'La suppression a échoué.',
          );
        }
      },
    });
  }

  const tab = TABS.some((t) => t.key === activeTab) ? activeTab : 'general';
  const lastSync = ephySource.lastSyncAt
    ? new Date(ephySource.lastSyncAt).toLocaleDateString('fr-FR')
    : null;

  return (
    <div>
      {/* Onglets */}
      <div className="mb-5 overflow-x-auto border-b border-line no-print">
        <nav className="flex min-w-max gap-1" aria-label="Sections de la parcelle">
          {TABS.map((item) => {
            const active = tab === item.key;
            const count =
              item.key === 'apports'
                ? fertilizations.length
                : item.key === 'phytosanitaire'
                  ? phytoTreatments.length
                  : item.key === 'travaux'
                    ? operations.length
                    : item.key === 'documents'
                      ? documents.length
                      : item.key === 'culture'
                        ? cropYears.length
                        : null;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => selectTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'border-champ-600 text-champ-700 dark:text-champ-400'
                    : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink'
                }`}
              >
                {item.label}
                {count !== null && count > 0 ? (
                  <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[12.5px] sm:text-[11px] text-ink-2">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ---------------------------------------------------------------- */}
      {tab === 'general' ? (
        <Card>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Nom de la parcelle', parcel.name],
              ['Numéro interne', parcel.internalNumber ?? '—'],
              ['Superficie', `${formatNumberFr(parcel.areaHa, 4)} ha`],
              ['Commune', parcel.commune ?? '—'],
              ['Code INSEE', parcel.inseeCode ?? '—'],
              ['Lieu-dit', parcel.lieuDit ?? '—'],
              ['Référence cadastrale', parcel.cadastralRef ?? '—'],
              ['Identifiant PAC / RPG', parcel.pacId ?? '—'],
              ['Type de parcelle', parcel.parcelType ?? '—'],
              [
                'Sol drainé',
                parcel.drainedSoil === true
                  ? 'Oui'
                  : parcel.drainedSoil === false
                    ? 'Non'
                    : 'Non renseigné',
              ],
              ['Statut', PARCEL_STATUS_LABELS[parcel.status] ?? parcel.status],
              [
                'Coordonnées GPS (centre)',
                parcel.centroidLat !== null && parcel.centroidLng !== null
                  ? `${parcel.centroidLat.toFixed(5)}, ${parcel.centroidLng.toFixed(5)}`
                  : '—',
              ],
              ['Créée le', formatDateFr(parcel.createdAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">
                  {label}
                </dt>
                <dd className="mt-0.5 text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {parcel.notes ? (
            <div className="mt-6 border-t border-line pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Observations
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-ink">
                {parcel.notes}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'culture' ? (
        <div className="space-y-4">
          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => setModal('crop')}>+ Renseigner une culture</Button>
            </div>
          ) : null}

          {cropYears.length === 0 ? (
            <EmptyState
              icon={IconCrops}
              title="Aucune culture renseignée"
              description={`Indiquez la culture en place pour la campagne ${campaignYear} : elle alimentera vos registres et vos exports.`}
              action={
                canWrite ? (
                  <Button onClick={() => setModal('crop')}>Renseigner une culture</Button>
                ) : undefined
              }
            />
          ) : (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Campagne</Th>
                  <Th>Culture</Th>
                  <Th>Variété</Th>
                  <Th>Semis</Th>
                  <Th>Récolte prévue</Th>
                  <Th>Récolte réelle</Th>
                  <Th align="right">Rendement</Th>
                  {canWrite ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {cropYears.map((cy) => (
                  <tr key={cy.id}>
                    <Td>
                      <span className="font-medium">{cy.campaignYear}</span>
                      {cy.campaignYear === campaignYear ? (
                        <Badge tone="green" className="ml-2">
                          En cours
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="font-medium">{cy.cropName}</Td>
                    <Td>{cy.variety ?? '—'}</Td>
                    <Td>{formatDateFr(cy.sowingDate)}</Td>
                    <Td>{formatDateFr(cy.expectedHarvestDate)}</Td>
                    <Td>{formatDateFr(cy.actualHarvestDate)}</Td>
                    <Td align="right">
                      {cy.yieldValue
                        ? `${formatNumberFr(cy.yieldValue, 2)} ${cy.yieldUnit ?? ''}`
                        : '—'}
                    </Td>
                    {canWrite ? (
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() =>
                            askRemove({
                              endpoint: `/api/crop-years/${cy.id}`,
                              title: 'Retirer cette culture',
                              message: `« ${cy.cropName} » sera retirée de l'assolement ${cy.campaignYear} de cette parcelle.`,
                              successMessage: 'Culture retirée de l’assolement',
                            })
                          }
                          className="text-sm text-brique-500 hover:underline"
                        >
                          Supprimer
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'apports' ? (
        <div className="space-y-4">
          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => setModal('fertilization')}>+ Ajouter un apport</Button>
            </div>
          ) : null}

          {fertilizations.length > 0 ? (
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Bilan des éléments fertilisants — cumul de tous les apports
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                {[
                  ['Azote (N)', balance.totalN, balance.perHectareN],
                  ['Phosphore (P₂O₅)', balance.totalP, balance.perHectareP],
                  ['Potassium (K₂O)', balance.totalK, balance.perHectareK],
                ].map(([label, total, perHa]) => (
                  <div key={String(label)} className="rounded-lg bg-surface-2 p-3">
                    <p className="text-xs text-ink-3">{label}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
                      {formatNumberFr(perHa, 1)}
                      <span className="ml-1 text-xs font-normal text-ink-3">
                        kg/ha
                      </span>
                    </p>
                    <p className="text-xs tabular-nums text-ink-3">
                      {formatNumberFr(total, 1)} kg au total
                    </p>
                  </div>
                ))}
              </div>

              {balance.incompleteCount > 0 ? (
                <p className="mt-3 text-sm text-ble-600">
                  ⚠ {balance.incompleteCount} apport
                  {balance.incompleteCount > 1 ? 's sont' : ' est'} sans teneur en azote
                  connue : le bilan est donc sous-estimé. Renseignez les teneurs à partir
                  d&apos;une analyse pour un bilan exact.
                </p>
              ) : null}
            </Card>
          ) : null}

          {fertilizations.length === 0 ? (
            <EmptyState
              icon={IconInputs}
              title="Aucun apport enregistré"
              description="Enregistrez vos apports organiques et minéraux : la quantité totale et le bilan NPK sont calculés automatiquement."
              action={
                canWrite ? (
                  <Button onClick={() => setModal('fertilization')}>
                    Ajouter un apport
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Produit</Th>
                  <Th align="right">Dose</Th>
                  <Th align="right">Surface</Th>
                  <Th align="right">Quantité totale</Th>
                  <Th align="right">N</Th>
                  <Th align="right">P₂O₅</Th>
                  <Th align="right">K₂O</Th>
                  {canWrite ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {fertilizations.map((row) => (
                  <tr key={row.id}>
                    <Td>{formatDateFr(row.appliedOn)}</Td>
                    <Td>
                      <Badge tone={row.inputType === 'ORGANIC' ? 'green' : 'blue'}>
                        {row.inputType === 'ORGANIC' ? 'Organique' : 'Minéral'}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="font-medium">{row.productLabel}</span>
                      {row.cropName ? (
                        <span className="block text-xs text-ink-3">
                          {row.cropName}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {formatNumberFr(row.dose, 2)} {row.doseUnit}
                    </Td>
                    <Td align="right">{formatNumberFr(row.treatedAreaHa, 4)} ha</Td>
                    <Td align="right">
                      {formatNumberFr(row.totalQuantity, 2)} {row.totalUnit}
                    </Td>
                    <Td align="right">
                      {row.nSupplied ? formatNumberFr(row.nSupplied, 1) : '—'}
                    </Td>
                    <Td align="right">
                      {row.pSupplied ? formatNumberFr(row.pSupplied, 1) : '—'}
                    </Td>
                    <Td align="right">
                      {row.kSupplied ? formatNumberFr(row.kSupplied, 1) : '—'}
                    </Td>
                    {canWrite ? (
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() =>
                            askRemove({
                              endpoint: `/api/fertilization/${row.id}`,
                              title: 'Supprimer cet apport',
                              message: `L'apport « ${row.productLabel} » du ${formatDateFr(row.appliedOn)} sera supprimé.`,
                              detail: 'Il disparaîtra du registre des apports et du bilan des éléments fertilisants.',
                              successMessage: 'Apport supprimé',
                            })
                          }
                          className="text-sm text-brique-500 hover:underline"
                        >
                          Supprimer
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'phytosanitaire' ? (
        <div className="space-y-4">
          <Alert tone="info">
            {ephySource.label}
            {lastSync
              ? ` — dernière synchronisation : ${lastSync}`
              : ' — aucune synchronisation enregistrée'}
            {ephySource.productsInBase > 0
              ? ` (${ephySource.productsInBase.toLocaleString('fr-FR')} produits en base)`
              : ''}
          </Alert>

          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => setModal('phyto')}>+ Ajouter un traitement</Button>
            </div>
          ) : null}

          {phytoTreatments.length === 0 ? (
            <EmptyState
              icon={IconPhyto}
              title="Aucun traitement enregistré"
              description="Enregistrez vos interventions phytosanitaires : elles alimentent automatiquement votre registre."
              action={
                canWrite ? (
                  <Button onClick={() => setModal('phyto')}>Ajouter un traitement</Button>
                ) : undefined
              }
            />
          ) : (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Produit</Th>
                  <Th>AMM</Th>
                  <Th>Substances actives</Th>
                  <Th>Cible</Th>
                  <Th align="right">Dose</Th>
                  <Th align="right">Surface</Th>
                  <Th>Conditions</Th>
                  {canWrite ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {phytoTreatments.map((row) => (
                  <tr key={row.id}>
                    <Td>{formatDateFr(row.appliedOn)}</Td>
                    <Td className="font-medium">{row.productName}</Td>
                    <Td>
                      {row.amm ? (
                        <span className="tabular-nums">{row.amm}</span>
                      ) : (
                        <Badge tone="amber">Manquant</Badge>
                      )}
                    </Td>
                    <Td className="max-w-[220px] truncate">
                      {row.activeSubstances ?? '—'}
                    </Td>
                    <Td>{row.targetLabel ?? '—'}</Td>
                    <Td align="right">
                      {formatNumberFr(row.dose, 2)} {row.doseUnit}
                    </Td>
                    <Td align="right">{formatNumberFr(row.treatedAreaHa, 4)} ha</Td>
                    <Td className="text-xs">
                      {row.weatherSummary ? (
                        <>
                          {row.weatherSummary}
                          {row.weatherTempC
                            ? `, ${formatNumberFr(row.weatherTempC, 1)} °C`
                            : ''}
                          {row.weatherWindKmh
                            ? `, vent ${formatNumberFr(row.weatherWindKmh, 1)} km/h`
                            : ''}
                        </>
                      ) : (
                        <span className="text-ble-600">Non renseignées</span>
                      )}
                    </Td>
                    {canWrite ? (
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() =>
                            askRemove({
                              endpoint: `/api/phytosanitary/applications/${row.id}`,
                              title: 'Supprimer ce traitement',
                              message: `Le traitement « ${row.productName} » du ${formatDateFr(row.appliedOn)} sera supprimé.`,
                              detail: 'Il disparaîtra de votre registre phytosanitaire et des exports correspondants.',
                              successMessage: 'Traitement supprimé du registre',
                            })
                          }
                          className="text-sm text-brique-500 hover:underline"
                        >
                          Supprimer
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'travaux' ? (
        <div className="space-y-4">
          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => setModal('operation')}>+ Ajouter un travail</Button>
            </div>
          ) : null}

          {operations.length === 0 ? (
            <EmptyState
              icon={IconOperation}
              title="Aucun travail enregistré"
              description="Labour, semis, récolte, transport… gardez la trace des interventions mécaniques."
              action={
                canWrite ? (
                  <Button onClick={() => setModal('operation')}>Ajouter un travail</Button>
                ) : undefined
              }
            />
          ) : (
            <TableWrapper>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Type</Th>
                  <Th>Matériel</Th>
                  <Th>Opérateur</Th>
                  <Th align="right">Durée</Th>
                  <Th>Observations</Th>
                  {canWrite ? <Th /> : null}
                </tr>
              </thead>
              <tbody>
                {operations.map((row) => (
                  <tr key={row.id}>
                    <Td>{formatDateFr(row.performedOn)}</Td>
                    <Td className="font-medium">
                      {OPERATION_LABELS[row.type] ?? row.type}
                    </Td>
                    <Td>{row.equipment ?? '—'}</Td>
                    <Td>{row.operator ?? '—'}</Td>
                    <Td align="right">
                      {row.durationHours ? `${formatNumberFr(row.durationHours, 1)} h` : '—'}
                    </Td>
                    <Td className="max-w-[260px] truncate">{row.notes ?? '—'}</Td>
                    {canWrite ? (
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() =>
                            askRemove({
                              endpoint: `/api/operations/${row.id}`,
                              title: 'Supprimer ce travail',
                              message: `Le travail du ${formatDateFr(row.performedOn)} sera supprimé de l'historique de la parcelle.`,
                              successMessage: 'Travail supprimé',
                            })
                          }
                          className="text-sm text-brique-500 hover:underline"
                        >
                          Supprimer
                        </button>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'historique' ? (
        history.length === 0 ? (
          <EmptyState
            icon={IconHistory}
            title="Historique vide"
            description="L'historique se remplit automatiquement au fil de vos saisies : cultures, apports, traitements, travaux et documents."
          />
        ) : (
          <Card>
            <ol className="relative space-y-5 border-l-2 border-line pl-5">
              {history.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-champ-500" />
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <time className="text-sm font-semibold tabular-nums text-ink">
                      {formatDateFr(event.date)}
                    </time>
                    <Badge tone={HISTORY_TONES[event.kind] ?? 'neutral'}>
                      {event.kind === 'CROP'
                        ? 'Culture'
                        : event.kind === 'HARVEST'
                          ? 'Récolte'
                          : event.kind === 'FERTILIZATION'
                            ? 'Apport'
                            : event.kind === 'PHYTO'
                              ? 'Phytosanitaire'
                              : event.kind === 'OPERATION'
                                ? 'Travail'
                                : 'Document'}
                    </Badge>
                  </div>
                  <p className="mt-1 font-medium text-ink">{event.title}</p>
                  {event.details.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-sm text-ink-2">
                      {event.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        )
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {tab === 'documents' ? (
        <div className="space-y-4">
          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => setModal('document')}>+ Ajouter un document</Button>
            </div>
          ) : null}

          {documents.length === 0 ? (
            <EmptyState
              icon={IconDocuments}
              title="Aucun document"
              description="Attachez vos factures, analyses de sol, photos et documents administratifs à cette parcelle."
              action={
                canWrite ? (
                  <Button onClick={() => setModal('document')}>Ajouter un document</Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="rounded-xl border border-line bg-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
                      {doc.mimeType.startsWith('image/') ? (
                        <IconImage size={17} aria-hidden />
                      ) : doc.mimeType === 'application/pdf' ? (
                        <IconFile size={17} aria-hidden />
                      ) : (
                        <IconAttachment size={17} aria-hidden />
                      )}
                    </span>
                    <Badge>
                      {DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}
                    </Badge>
                  </div>

                  <p className="mt-2 truncate font-medium text-ink" title={doc.fileName}>
                    {doc.fileName}
                  </p>
                  {doc.description ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-3">
                      {doc.description}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-ink-3">
                    {formatBytes(doc.sizeBytes)} · {formatDateFr(doc.createdAt)}
                  </p>

                  <div className="mt-3 flex gap-3 border-t border-line pt-2.5 text-sm">
                    <a
                      href={`/api/documents/${doc.id}`}
                      className="text-champ-700 dark:text-champ-400 hover:underline"
                    >
                      Télécharger
                    </a>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() =>
                          askRemove({
                            endpoint: `/api/documents/${doc.id}`,
                            title: 'Supprimer ce document',
                            message: `« ${doc.fileName} » sera supprimé définitivement.`,
                            detail: 'Le fichier est effacé du stockage : cette action est irréversible.',
                            successMessage: 'Document supprimé',
                          })
                        }
                        className="ml-auto text-brique-500 hover:underline"
                      >
                        Supprimer
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ConfirmDialog request={confirmation.request} onClose={confirmation.close} />

      {/* ------------------------------ Modales ------------------------- */}
      <Modal
        open={modal === 'crop'}
        onClose={() => setModal(null)}
        title="Renseigner une culture"
        description={`Parcelle « ${parcel.name} »`}
        wide
      >
        <CropYearForm
          parcelId={parcel.id}
          crops={referentials.crops}
          campaignYear={campaignYear}
          onDone={() => setModal(null)}
        />
      </Modal>

      <Modal
        open={modal === 'fertilization'}
        onClose={() => setModal(null)}
        title="Ajouter un apport"
        description={`Parcelle « ${parcel.name} » — ${formatNumberFr(parcel.areaHa, 4)} ha`}
        wide
      >
        <FertilizationForm
          parcelId={parcel.id}
          parcelAreaHa={parcel.areaHa}
          fertilizers={referentials.fertilizers}
          organicInputs={referentials.organicInputs}
          cropYears={cropYears}
          onDone={() => setModal(null)}
        />
      </Modal>

      <Modal
        open={modal === 'phyto'}
        onClose={() => setModal(null)}
        title="Ajouter un traitement phytosanitaire"
        description={`Parcelle « ${parcel.name} » — ${formatNumberFr(parcel.areaHa, 4)} ha`}
        wide
      >
        <PhytoForm
          parcelId={parcel.id}
          parcelAreaHa={parcel.areaHa}
          cropYears={cropYears}
          hasLocation={parcel.centroidLat !== null && parcel.centroidLng !== null}
          parcelDrained={parcel.drainedSoil}
          onDone={() => setModal(null)}
        />
      </Modal>

      <Modal
        open={modal === 'operation'}
        onClose={() => setModal(null)}
        title="Ajouter un travail"
        description={`Parcelle « ${parcel.name} »`}
        wide
      >
        <OperationForm parcelId={parcel.id} onDone={() => setModal(null)} />
      </Modal>

      <Modal
        open={modal === 'document'}
        onClose={() => setModal(null)}
        title="Ajouter un document"
        description={`Parcelle « ${parcel.name} »`}
      >
        <DocumentUpload parcelId={parcel.id} onDone={() => setModal(null)} />
      </Modal>
    </div>
  );
}
