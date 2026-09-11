'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/client/api';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, useConfirm } from '@/components/forms/ConfirmDialog';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Select,
  formatDateFr,
} from '@/components/ui';
import {
  IconArea,
  IconCheck,
  IconExport,
  IconLayers,
  IconRestore,
  IconWarning,
} from '@/components/ui/icons';

/** Ce que le serveur renvoie après analyse d'un dépôt. */
type Analysis = {
  year: number;
  adapterLabel: string;
  provenance: string;
  layers: Array<{
    name: string;
    isIlotLayer: boolean;
    srid: number | null;
    sridLabel: string;
    columns: string[];
    featureCount: number;
    warnings: string[];
    mapping: Record<string, { column: string | null; confidence: string }>;
  }>;
  features: Array<{
    index: number;
    layer: string;
    numero: string | null;
    ilot: string | null;
    cropCode: string | null;
    areaHa: number | null;
    declaredAreaHa: number | null;
    error: string | null;
    warnings: string[];
    match: { parcelName: string; parcelAreaHa: number; overlap: number; reason: string } | null;
  }>;
  ignoredFiles: string[];
  problems: string[];
  totals: {
    features: number;
    ilots: number;
    valid: number;
    matched: number;
    invalid: number;
    areaHa: number;
  };
};

type ControlReport = {
  level: 'ok' | 'warning' | 'error';
  parcelCount: number;
  areaHa: number;
  findings: Array<{ level: string; category: string; message: string }>;
  disclaimer: string;
};

export type PacDashboard = {
  year: number;
  /** « 1ᵉʳ août 2025 → 31 juillet 2026 » — de quelle année on parle. */
  periode: string;
  /** Pourquoi cette campagne-là s'est ouverte ; `null` si l'utilisateur l'a choisie. */
  raisonDefaut: string | null;
  ilotCount: number;
  parcelCount: number;
  areaHa: number;
  lastImportAt: string | null;
  lastExportAt: string | null;
  changesSinceImport: number;
  snapshots: Array<{ id: string; label: string; parcelCount: number; createdAt: string }>;
  campagnes: Array<{
    year: number;
    ilots: number;
    entites: number;
    parcellesAvecCulture: number;
    importee: boolean;
  }>;
};

/** « 2026 — 39 îlots, 141 parcelles » : ce que la campagne contient, dans la liste. */
function libelleCampagne(c: PacDashboard['campagnes'][number]): string {
  const parties: string[] = [];
  if (c.ilots > 0) parties.push(`${c.ilots} îlot${c.ilots > 1 ? 's' : ''}`);
  if (c.parcellesAvecCulture > 0) parties.push(`${c.parcellesAvecCulture} culture(s)`);
  if (parties.length === 0) return `${c.year} — vide`;
  return `${c.year} — ${parties.join(', ')}`;
}

const LIBELLES: Record<string, string> = {
  externalId: 'Identifiant',
  ilot: 'Îlot',
  numero: 'Numéro de parcelle',
  cropCode: 'Code culture',
  cropLabel: 'Libellé culture',
  area: 'Surface déclarée',
};

/**
 * Écran PAC / TéléPAC.
 *
 * Trois moments, dans cet ordre : on regarde où en est le dossier, on importe,
 * on prépare l'export. L'import ne s'applique jamais au dépôt : il passe
 * toujours par un aperçu, parce qu'un import PAC réécrit le parcellaire.
 */
export function PacPanel({ dashboard }: { dashboard: PacDashboard }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [year, setYear] = useState(dashboard.year);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<null | 'analyse' | 'import' | 'controle' | 'export'>(null);
  const [error, setError] = useState<string | null>(null);
  const [control, setControl] = useState<ControlReport | null>(null);
  const champFichiers = useRef<HTMLInputElement>(null);

  const corpsFormulaire = useCallback(() => {
    const form = new FormData();
    form.set('year', String(year));
    for (const file of files) form.append('files', file);
    return form;
  }, [files, year]);

  async function analyser() {
    if (files.length === 0) {
      setError('Choisissez les fichiers téléchargés depuis TéléPAC.');
      return;
    }
    setBusy('analyse');
    setError(null);
    setAnalysis(null);
    try {
      const reponse = await fetch('/api/pac/import', { method: 'POST', body: corpsFormulaire() });
      const corps = await reponse.json();
      if (!reponse.ok) throw new Error(corps?.error?.message ?? "L'analyse a échoué.");
      setAnalysis(corps.data ?? corps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'analyse a échoué.");
    } finally {
      setBusy(null);
    }
  }

  function demanderImport() {
    if (!analysis) return;
    confirm.ask({
      title: `Importer ${analysis.totals.valid} parcelle(s) ?`,
      message:
        `${analysis.totals.matched} seront mises à jour, ` +
        `${analysis.totals.valid - analysis.totals.matched} créées.`,
      detail:
        "Une sauvegarde du parcellaire est prise avant l'import : vous pourrez revenir " +
        'en arrière si ce n’est pas le bon dossier.',
      confirmLabel: 'Importer',
      onConfirm: async () => {
        setBusy('import');
        try {
          const reponse = await fetch('/api/pac/import', { method: 'PUT', body: corpsFormulaire() });
          const corps = await reponse.json();
          if (!reponse.ok) throw new Error(corps?.error?.message ?? "L'import a échoué.");
          toast.success((corps.data ?? corps).message);
          setAnalysis(null);
          setFiles([]);
          if (champFichiers.current) champFichiers.current.value = '';
          router.refresh();
        } finally {
          setBusy(null);
        }
      },
    });
  }

  async function controler() {
    setBusy('controle');
    setError(null);
    try {
      const reponse = await fetch(`/api/pac/control?year=${year}`);
      const corps = await reponse.json();
      if (!reponse.ok) throw new Error(corps?.error?.message ?? 'Le contrôle a échoué.');
      setControl(corps.data ?? corps);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Le contrôle a échoué.');
    } finally {
      setBusy(null);
    }
  }

  async function exporter(force = false) {
    setBusy('export');
    setError(null);
    try {
      const reponse = await fetch(`/api/pac/export?year=${year}${force ? '&force=1' : ''}`);
      if (!reponse.ok) {
        const corps = await reponse.json().catch(() => null);
        throw new Error(corps?.error?.message ?? "L'export a échoué.");
      }
      const blob = await reponse.blob();
      const url = URL.createObjectURL(blob);
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = `parcelys-pac-${year}.zip`;
      lien.click();
      URL.revokeObjectURL(url);
      toast.success('Export préparé. La déclaration reste à déposer sur TéléPAC.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'export a échoué.");
    } finally {
      setBusy(null);
    }
  }

  function demanderRestauration(id: string, label: string) {
    confirm.ask({
      title: 'Rétablir cette sauvegarde ?',
      message: `Le parcellaire reviendra à l’état « ${label} ».`,
      detail:
        'Les parcelles créées depuis seront retirées du parcellaire actif, sans être ' +
        'effacées définitivement.',
      confirmLabel: 'Rétablir',
      onConfirm: async () => {
        const resultat = await apiPost<{ message: string }>('/api/pac/snapshots', {
          snapshotId: id,
        });
        toast.success(resultat.message);
        router.refresh();
      },
    });
  }

  const etatDossier =
    dashboard.lastImportAt === null
      ? { tone: 'neutral' as const, texte: 'Aucun import PAC' }
      : dashboard.changesSinceImport > 0
        ? { tone: 'amber' as const, texte: `${dashboard.changesSinceImport} modification(s) depuis le dernier import` }
        : { tone: 'green' as const, texte: 'Dossier PAC synchronisé' };

  return (
    <div className="space-y-5">
      {/* --- Tableau de bord ------------------------------------------- */}
      <Card>
        <CardHeader
          icon={IconArea}
          title={`Campagne ${dashboard.year}`}
          description={
            /*
             * De quelle année on parle, et pourquoi celle-ci.
             *
             * Cette page annonçait « Campagne 2026 » le jour où la liste des
             * parcelles affichait « Campagne 2027 » : deux définitions de la
             * campagne coexistaient, et aucun écran ne disait laquelle il
             * employait. Il n'y en a plus qu'une, et elle est écrite.
             */
            `${dashboard.periode}${dashboard.raisonDefaut ? ` · ${dashboard.raisonDefaut}` : ''}`
          }
          action={<Badge tone={etatDossier.tone}>{etatDossier.texte}</Badge>}
        />
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Îlots', valeur: String(dashboard.ilotCount) },
            { label: 'Parcelles', valeur: String(dashboard.parcelCount) },
            { label: 'Surface', valeur: `${dashboard.areaHa.toFixed(2)} ha` },
            {
              label: 'Dernier import',
              valeur: dashboard.lastImportAt ? formatDateFr(dashboard.lastImportAt) : '—',
            },
          ].map((item) => (
            <div key={item.label}>
              <dt className="text-[12.5px] sm:text-[11px] uppercase tracking-wide text-ink-3">
                {item.label}
              </dt>
              <dd className="mt-1 text-[17px] font-semibold text-ink">{item.valeur}</dd>
            </div>
          ))}
        </dl>
        {dashboard.lastExportAt ? (
          <p className="mt-4 text-sm text-ink-3">
            Dernier export préparé le {formatDateFr(dashboard.lastExportAt)}.
          </p>
        ) : null}
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* --- Import ----------------------------------------------------- */}
      <Card>
        <CardHeader
          icon={IconLayers}
          title="Importer un dossier TéléPAC"
          description="Déposez les fichiers téléchargés depuis TéléPAC. Aucun identifiant ne vous sera demandé."
        />

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
             * Le sélecteur de campagne commande toute la page, pas seulement
             * l'import.
             *
             * Il ne changeait qu'une variable locale : on pouvait choisir 2025,
             * importer dans 2025, et lire au-dessus « Campagne 2026 » avec les
             * chiffres de 2026. Deux campagnes à l'écran en même temps, dont
             * une fausse. Il recharge maintenant la page sur la campagne
             * choisie — une seule campagne affichée à la fois, celle qu'on a
             * demandée.
             */}
            <Field label="Campagne" htmlFor="pac-year" hint={dashboard.periode}>
              <Select
                id="pac-year"
                value={year}
                onChange={(e) => {
                  const choisie = Number(e.target.value);
                  setYear(choisie);
                  setAnalysis(null);
                  setControl(null);
                  router.push(`/pac?annee=${choisie}`);
                }}
              >
                {dashboard.campagnes.map((c) => (
                  <option key={c.year} value={c.year}>
                    {libelleCampagne(c)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Fichiers"
              htmlFor="pac-files"
              hint="L’export XML de TéléPAC, une archive ZIP, ou les fichiers .shp, .shx, .dbf et .prj ensemble."
            >
              <input
                id="pac-files"
                ref={champFichiers}
                type="file"
                multiple
                /*
                 * `.xml` en tête : c'est le format que TéléPAC donne
                 * réellement (« DossierPAC2026_dossier_<pacage>_….xml »).
                 * Il manquait de cette liste, et le sélecteur de fichiers du
                 * navigateur grisait donc le seul fichier que l'exploitant
                 * possède.
                 */
                accept=".xml,.zip,.shp,.shx,.dbf,.prj,.cpg"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []));
                  setAnalysis(null);
                }}
                className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-champ-600 file:px-3 file:py-1.5 file:text-sm file:text-white"
              />
            </Field>
          </div>

          <Alert tone="info">
            Parcelys ne se connecte jamais à TéléPAC. Téléchargez vos données depuis le
            portail, puis déposez-les ici. Rien n&apos;est écrit avant que vous ayez vu
            l&apos;aperçu.
          </Alert>

          <Button onClick={analyser} loading={busy === 'analyse'} disabled={busy !== null}>
            Analyser le dossier
          </Button>
        </div>
      </Card>

      {/* --- Aperçu ------------------------------------------------------ */}
      {analysis ? (
        <Card>
          <CardHeader
            icon={IconCheck}
            title="Aperçu avant import"
            description="Rien n’a encore été écrit. Vérifiez, puis validez."
          />

          <Alert tone="warning">{analysis.provenance}</Alert>

          <div className="mt-4 space-y-4">
            {analysis.layers.map((couche) => (
              <div key={couche.name} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {couche.name}{' '}
                    <span className="text-ink-3">
                      — {couche.featureCount} entité(s)
                      {couche.isIlotLayer ? ', couche d’îlots' : ''}
                    </span>
                  </p>
                  <Badge tone={couche.srid === null ? 'red' : 'green'}>{couche.sridLabel}</Badge>
                </div>

                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {Object.entries(couche.mapping).map(([cle, valeur]) => (
                    <li key={cle} className="text-sm text-ink-2">
                      {LIBELLES[cle] ?? cle} :{' '}
                      {valeur.column ? (
                        <code className="rounded bg-surface-2 px-1">{valeur.column}</code>
                      ) : (
                        <span className="text-ink-3">non trouvé</span>
                      )}
                    </li>
                  ))}
                </ul>

                {couche.warnings.map((a) => (
                  <p key={a} className="mt-2 text-sm text-amber-700 dark:text-amber-500">
                    {a}
                  </p>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="green">{analysis.totals.valid} parcelle(s) valide(s)</Badge>
            {analysis.totals.matched > 0 ? (
              <Badge tone="amber">{analysis.totals.matched} déjà présente(s)</Badge>
            ) : null}
            {analysis.totals.invalid > 0 ? (
              <Badge tone="red">{analysis.totals.invalid} géométrie(s) invalide(s)</Badge>
            ) : null}
            <Badge tone="neutral">{analysis.totals.ilots} îlot(s)</Badge>
            <Badge tone="neutral">{analysis.totals.areaHa.toFixed(2)} ha</Badge>
          </div>

          {analysis.problems.length > 0 ? (
            <Alert tone="warning" className="mt-4">
              <ul className="list-disc pl-4">
                {analysis.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto">
            {analysis.features.slice(0, 200).map((f) => (
              <li
                key={`${f.layer}#${f.index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm"
              >
                <span>
                  Îlot {f.ilot ?? '—'} · parcelle {f.numero ?? '—'}
                  {f.cropCode ? ` · ${f.cropCode}` : ''}
                  {f.areaHa !== null ? ` · ${f.areaHa.toFixed(2)} ha` : ''}
                </span>
                {f.error ? (
                  <Badge tone="red">{f.error}</Badge>
                ) : f.match ? (
                  <Badge tone="amber">
                    ↔ {f.match.parcelName} ({Math.round(f.match.overlap * 100)} %)
                  </Badge>
                ) : (
                  <Badge tone="green">nouvelle</Badge>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={demanderImport} loading={busy === 'import'} disabled={busy !== null}>
              Importer
            </Button>
            <Button variant="ghost" onClick={() => setAnalysis(null)} disabled={busy !== null}>
              Annuler
            </Button>
          </div>
        </Card>
      ) : null}

      {/* --- Contrôle et export ------------------------------------------ */}
      <Card>
        <CardHeader
          icon={IconExport}
          title="Préparer l’export TéléPAC"
          description="Le contrôle est lancé avant la génération des fichiers."
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={controler} loading={busy === 'controle'} disabled={busy !== null}>
            Lancer le contrôle PAC
          </Button>
          <Button onClick={() => exporter(false)} loading={busy === 'export'} disabled={busy !== null}>
            Préparer l’export
          </Button>
        </div>

        {control ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={control.level === 'ok' ? 'green' : control.level === 'warning' ? 'amber' : 'red'}
              >
                {control.level === 'ok'
                  ? 'Conforme'
                  : control.level === 'warning'
                    ? 'Avertissements'
                    : 'Erreurs bloquantes'}
              </Badge>
              <span className="text-sm text-ink-3">
                {control.parcelCount} parcelle(s), {control.areaHa.toFixed(2)} ha
              </span>
            </div>

            {control.findings.length === 0 ? (
              <p className="text-sm text-ink-2">Aucune anomalie relevée.</p>
            ) : (
              <ul className="space-y-2">
                {control.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <Badge tone={f.level === 'error' ? 'red' : f.level === 'warning' ? 'amber' : 'green'}>
                      {f.category}
                    </Badge>
                    <span className="text-ink-2">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}

            <Alert tone="info">{control.disclaimer}</Alert>

            {control.level === 'error' ? (
              <Button
                variant="outline"
                icon={IconWarning}
                onClick={() => exporter(true)}
                disabled={busy !== null}
              >
                Exporter malgré les erreurs
              </Button>
            ) : null}
          </div>
        ) : null}

        <Alert tone="warning" className="mt-4">
          L&apos;export <strong>prépare</strong> des fichiers. La déclaration se dépose et se
          signe sur telepac.agriculture.gouv.fr — Parcelys n&apos;envoie rien.
        </Alert>
      </Card>

      {/* --- Sauvegardes -------------------------------------------------- */}
      <Card>
        <CardHeader
          icon={IconRestore}
          title="Sauvegardes avant import"
          description="Prises automatiquement avant chaque import PAC."
        />
        {dashboard.snapshots.length === 0 ? (
          <EmptyState
            icon={IconRestore}
            title="Aucune sauvegarde"
            description="La première sera prise lors de votre premier import PAC."
          />
        ) : (
          <ul className="space-y-2">
            {dashboard.snapshots.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm"
              >
                <span>
                  {s.label} · {s.parcelCount} parcelle(s) · {formatDateFr(s.createdAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={IconRestore}
                  onClick={() => demanderRestauration(s.id, s.label)}
                >
                  Rétablir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog request={confirm.request} onClose={confirm.close} />
    </div>
  );
}
