'use client';

import { useMemo, useState } from 'react';
import { Card, CardHeader, Field, Input, Select } from '@/components/ui';
import {
  IconCrops,
  IconExport,
  IconHistory,
  IconInputs,
  IconOperation,
  IconParcels,
  IconPhyto,
  IconTrend,
} from '@/components/ui/icons';

const DATASETS = [
  {
    key: 'parcelles',
    label: 'Registre parcellaire',
    icon: IconParcels,
    description: 'Parcelles, superficies, communes, références cadastrales et culture.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'phytosanitaire',
    label: 'Registre phytosanitaire',
    icon: IconPhyto,
    description: 'Traitements avec AMM, substances actives, doses, surfaces et météo.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'apports',
    label: 'Registre des apports',
    icon: IconInputs,
    description: 'Apports organiques et minéraux avec éléments fertilisants N, P, K.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'bilan-engrais',
    label: 'Bilan de fertilisation',
    icon: IconTrend,
    description:
      'Unités N, P₂O₅ et K₂O apportées par parcelle, en kg/ha et en kg, avec totaux.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'historique',
    label: 'Historique des interventions',
    icon: IconHistory,
    description: 'Chronologie complète : cultures, apports, traitements, travaux.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'cultures',
    label: 'Assolement et cultures',
    icon: IconCrops,
    description: 'Culture, variété, dates de semis et de récolte, rendements.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
  {
    key: 'travaux',
    label: 'Registre des travaux',
    icon: IconOperation,
    description: 'Labour, semis, récolte : matériel, opérateur et durée.',
    formats: ['pdf', 'xlsx', 'csv'],
  },
] as const;

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  csv: 'CSV',
};

export function ExportBuilder({
  parcels,
  years,
  defaultYear,
  defaultDataset,
}: {
  parcels: Array<{ id: string; name: string; internalNumber: string | null }>;
  years: number[];
  defaultYear: number;
  defaultDataset?: string;
}) {
  const [dataset, setDataset] = useState<string>(
    DATASETS.some((d) => d.key === defaultDataset) ? (defaultDataset as string) : 'parcelles',
  );
  const [year, setYear] = useState(String(defaultYear));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedParcels, setSelectedParcels] = useState<string[]>([]);
  const [usePeriod, setUsePeriod] = useState(false);

  const current = DATASETS.find((d) => d.key === dataset) ?? DATASETS[0];

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set('dataset', dataset);
    if (usePeriod) {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else if (year) {
      params.set('year', year);
    }
    if (selectedParcels.length > 0) {
      params.set('parcelIds', selectedParcels.join(','));
    }
    return (format: string) => `/api/exports?${params.toString()}&format=${format}`;
  }, [dataset, year, from, to, selectedParcels, usePeriod]);

  function toggleParcel(id: string): void {
    setSelectedParcels((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  return (
    <div className="space-y-5">
      {/* Choix du jeu de données */}
      <Card>
        <CardHeader
          title="1. Que souhaitez-vous exporter ?"
          description="Chaque export reprend les données réellement saisies dans Parcelys."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DATASETS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setDataset(item.key)}
              aria-pressed={dataset === item.key}
              className={`rounded-xl border p-4 text-left transition ${
                dataset === item.key
                  ? 'border-champ-500 bg-accent-soft ring-2 ring-champ-500/20'
                  : 'border-line bg-surface hover:border-champ-300'
              }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-ink">
                <item.icon size={17} aria-hidden />
              </span>
              <p className="mt-1.5 font-semibold text-ink">{item.label}</p>
              <p className="mt-0.5 text-sm text-ink-3">{item.description}</p>
            </button>
          ))}
        </div>
      </Card>

      {/* Filtres */}
      <Card>
        <CardHeader
          title="2. Sur quelle période et quelles parcelles ?"
          description="Sans sélection de parcelles, toutes les parcelles de l'exploitation sont incluses."
        />

        <div className="mb-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="periodMode"
              checked={!usePeriod}
              onChange={() => setUsePeriod(false)}
              className="h-4 w-4 border-line-strong text-champ-600 focus:ring-champ-500"
            />
            Par campagne
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="periodMode"
              checked={usePeriod}
              onChange={() => setUsePeriod(true)}
              className="h-4 w-4 border-line-strong text-champ-600 focus:ring-champ-500"
            />
            Par dates
          </label>
        </div>

        {usePeriod ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Du" htmlFor="from">
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="Au" htmlFor="to">
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        ) : (
          <Field label="Campagne" htmlFor="year" className="max-w-48">
            <Select id="year" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Toutes les campagnes</option>
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {parcels.length > 0 ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink">
                Parcelles ({selectedParcels.length > 0 ? selectedParcels.length : 'toutes'})
              </p>
              {selectedParcels.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedParcels([])}
                  className="text-sm text-champ-700 dark:text-champ-400 hover:underline"
                >
                  Tout désélectionner
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedParcels(parcels.map((p) => p.id))}
                  className="text-sm text-champ-700 dark:text-champ-400 hover:underline"
                >
                  Tout sélectionner
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-2">
              <div className="flex flex-wrap gap-1.5">
                {parcels.map((parcel) => {
                  const selected = selectedParcels.includes(parcel.id);
                  return (
                    <button
                      key={parcel.id}
                      type="button"
                      onClick={() => toggleParcel(parcel.id)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        selected
                          ? 'border-champ-500 bg-accent-soft text-champ-800 dark:text-champ-300'
                          : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                      }`}
                    >
                      {parcel.internalNumber ? `${parcel.internalNumber} — ` : ''}
                      {parcel.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Téléchargement */}
      <Card>
        <CardHeader
          title="3. Télécharger"
          description={`${current.label} — ${
            usePeriod
              ? `du ${from || '…'} au ${to || '…'}`
              : year
                ? `campagne ${year}`
                : 'toutes campagnes'
          }`}
        />
        <div className="flex flex-wrap gap-3">
          {current.formats.map((format) => (
            <a
              key={format}
              href={url(format)}
              download
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong
                         bg-surface px-5 text-base font-medium text-ink transition hover:bg-surface-2"
            >
              <IconExport size={17} aria-hidden />
              {FORMAT_LABELS[format] ?? format}
            </a>
          ))}
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Les fichiers CSV utilisent le point-virgule et un encodage UTF-8 avec BOM :
          ils s&apos;ouvrent directement dans Excel en français.
        </p>
      </Card>
    </div>
  );
}
