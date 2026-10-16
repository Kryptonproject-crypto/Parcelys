import { useState, type ReactNode } from 'react';
import {
  LIBELLES_EVENEMENT,
  type ApportFiche,
  type FicheParcelle,
  type TraitementFiche,
  type TravailFiche,
  type TypeEvenement,
} from '@commun/registres';
import type { CachedParcel, QueuedOperation } from '../lib/types';
import type { EntryKind } from '../lib/corrections';
import { Badge, Card, EmptyState, cn, formatDateFr } from './ui';
import { nomCourtDeCulture } from '@commun/cultures';

/**
 * Les rubriques de la fiche parcelle, comme sur le site, en plus court.
 *
 * Le site range chaque registre dans un tableau à huit ou dix colonnes ; un
 * téléphone n'en tient pas trois. Chaque ligne devient donc une carte : la
 * date et le produit en tête — ce qu'on cherche du regard —, le détail
 * dessous. Les valeurs sont celles du serveur, déjà mises en forme : rien
 * n'est recalculé ici.
 *
 * Les saisies encore dans la file d'attente apparaissent en tête de leur
 * rubrique, marquées « en attente d'envoi » : on vient d'enregistrer un
 * traitement au champ, il doit se voir tout de suite, réseau ou pas.
 */

export const ONGLETS = [
  { cle: 'general', libelle: 'Général' },
  { cle: 'cultures', libelle: 'Cultures' },
  { cle: 'apports', libelle: 'Apports' },
  { cle: 'phyto', libelle: 'Phyto' },
  { cle: 'travaux', libelle: 'Travaux' },
  { cle: 'historique', libelle: 'Historique' },
] as const;

export type Onglet = (typeof ONGLETS)[number]['cle'];

export function nombreFr(valeur: number | null | undefined, chiffres = 2): string {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return '—';
  return valeur.toLocaleString('fr-FR', { maximumFractionDigits: chiffres });
}

const dateOuTiret = (valeur: string | null | undefined): string =>
  valeur ? formatDateFr(valeur) : '—';

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

function Ligne({ libelle, children }: { libelle: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[13px] text-ink-3">{libelle}</dt>
      <dd className="min-w-0 text-right text-[14px] text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Titre({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

/** « + Ajouter », dans la rubrique même : on lit, puis on saisit la suite. */
export function BoutonAjouter({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-accent-ink active:bg-surface-2"
    >
      + {children}
    </button>
  );
}

/**
 * Ce qu'on peut faire d'un enregistrement depuis la fiche : le corriger, le
 * supprimer — comme sur le site —, et voir ce qui en attend l'envoi.
 *
 * Absent pour l'expert en mission : il lit, il ne modifie pas les registres
 * de l'exploitation.
 */
export type ActionsEnregistrement = {
  modifier: () => void;
  supprimer: () => void;
  /** Correction ou suppression de cet enregistrement encore dans la file. */
  enAttente: QueuedOperation | null;
  /** Retire de la file une correction ou une suppression pas encore partie. */
  annuler: (operation: QueuedOperation) => void;
};

export type FabriqueActions = (nature: EntryKind, record: { id: string }) => ActionsEnregistrement;

function texteDe(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null;
}

/** Ce qu'une correction en file va écrire, en une ligne. */
export function resumeCorrection(operation: QueuedOperation): string {
  const p = operation.payload;
  const date = texteDe(p.appliedOn) ?? texteDe(p.performedOn) ?? texteDe(p.sownOn) ?? texteDe(p.sowingDate);
  const dose = texteDe(p.dose);
  return [
    date ? formatDateFr(date) : null,
    texteDe(p.productName) ?? texteDe(p.productLabel) ?? texteDe(p.species) ?? texteDe(p.equipment) ?? texteDe(p.variety),
    dose ? `${nombreFr(Number(dose), 3)} ${texteDe(p.doseUnit) ?? ''}`.trim() : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const BOUTON_LIEN = 'rounded-lg px-2.5 py-1.5 text-[13px] font-semibold active:bg-surface-2';

/** Pied de carte : corriger, supprimer, et l'état de ce qui attend l'envoi. */
function ActionsCarte({ actions }: { actions: ActionsEnregistrement | undefined }) {
  const [confirmer, setConfirmer] = useState(false);
  if (!actions) return null;
  const { enAttente } = actions;
  const suppressionEnAttente = enAttente?.kind.endsWith('.delete') ?? false;

  return (
    <div className="mt-2.5 border-t border-line pt-2">
      {enAttente ? (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <Badge tone={enAttente.lastError ? 'red' : 'blue'}>
            {enAttente.lastError
              ? 'Refusée par le serveur'
              : suppressionEnAttente
                ? 'Suppression en attente d’envoi'
                : 'Correction en attente d’envoi'}
          </Badge>
          {!suppressionEnAttente ? (
            <span className="text-[12.5px] text-ink-2">{resumeCorrection(enAttente)}</span>
          ) : null}
          {enAttente.lastError ? (
            <span className="block w-full text-[12.5px] text-brique-600 dark:text-brique-500">{enAttente.lastError}</span>
          ) : null}
        </div>
      ) : null}

      {confirmer ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] text-ink-2">Supprimer cet enregistrement du registre ?</span>
          <button type="button" className={cn(BOUTON_LIEN, 'text-ink-2')} onClick={() => setConfirmer(false)}>
            Annuler
          </button>
          <button
            type="button"
            className={cn(BOUTON_LIEN, 'text-brique-600 dark:text-brique-500')}
            onClick={() => {
              setConfirmer(false);
              actions.supprimer();
            }}
          >
            Supprimer
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {enAttente ? (
            <button type="button" className={cn(BOUTON_LIEN, 'text-ink-2')} onClick={() => actions.annuler(enAttente)}>
              {suppressionEnAttente ? 'Annuler la suppression' : 'Annuler la correction'}
            </button>
          ) : null}
          {!suppressionEnAttente ? (
            <>
              <button type="button" className={cn(BOUTON_LIEN, 'text-accent-ink')} onClick={actions.modifier}>
                Modifier
              </button>
              <button
                type="button"
                className={cn(BOUTON_LIEN, 'text-brique-600 dark:text-brique-500')}
                onClick={() => setConfirmer(true)}
              >
                Supprimer
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Une carte d'enregistrement, estompée quand sa suppression attend l'envoi. */
function CarteEnregistrement({ actions, children }: { actions: ActionsEnregistrement | undefined; children: ReactNode }) {
  const supprime = actions?.enAttente?.kind.endsWith('.delete') ?? false;
  return (
    <Card className={supprime ? 'opacity-60' : undefined}>
      <div className={supprime ? 'line-through decoration-ink-3/60' : undefined}>{children}</div>
      <ActionsCarte actions={actions} />
    </Card>
  );
}

/** Une saisie de la file d'attente, en tête de sa rubrique. */
function CarteEnAttente({
  titre,
  detail,
  operation,
  modifier,
  annuler,
}: {
  titre: string;
  detail: string;
  operation: QueuedOperation;
  modifier?: (operation: QueuedOperation) => void;
  annuler?: (operation: QueuedOperation) => void;
}) {
  const [confirmer, setConfirmer] = useState(false);
  return (
    <li>
      <div className="rounded-2xl border border-dashed border-ciel-500/50 bg-ciel-500/5 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{titre}</p>
          <span className="shrink-0">
            {operation.lastError ? <Badge tone="red">Refusée</Badge> : <Badge tone="blue">En attente d’envoi</Badge>}
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ink-3">{detail}</p>
        {operation.lastError ? (
          <p className="mt-1 text-[13px] text-brique-600 dark:text-brique-500">{operation.lastError}</p>
        ) : null}
        {modifier || annuler ? (
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-ciel-500/20 pt-2">
            {confirmer ? (
              <>
                <span className="text-[13px] text-ink-2">Abandonner cette saisie ?</span>
                <button type="button" className={cn(BOUTON_LIEN, 'text-ink-2')} onClick={() => setConfirmer(false)}>
                  Non
                </button>
                <button
                  type="button"
                  className={cn(BOUTON_LIEN, 'text-brique-600 dark:text-brique-500')}
                  onClick={() => annuler?.(operation)}
                >
                  Abandonner
                </button>
              </>
            ) : (
              <>
                {modifier ? (
                  <button type="button" className={cn(BOUTON_LIEN, 'text-accent-ink')} onClick={() => modifier(operation)}>
                    Modifier
                  </button>
                ) : null}
                {annuler ? (
                  <button
                    type="button"
                    className={cn(BOUTON_LIEN, 'text-brique-600 dark:text-brique-500')}
                    onClick={() => setConfirmer(true)}
                  >
                    Abandonner
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function nombreDe(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function EnAttente({
  operations,
  kind,
  libelleTravail,
  libelleCouvert,
  libelleCulture,
  modifier,
  annuler,
}: {
  operations: QueuedOperation[];
  kind: QueuedOperation['kind'];
  libelleTravail?: (code: string) => string;
  libelleCouvert?: (code: string) => string;
  libelleCulture?: (id: string) => string;
  /** Rouvre la saisie pour la corriger avant son départ. */
  modifier?: (operation: QueuedOperation) => void;
  /** Retire la saisie de la file. */
  annuler?: (operation: QueuedOperation) => void;
}) {
  const liste = operations.filter((o) => o.kind === kind);
  if (liste.length === 0) return null;
  return (
    <ul className="mb-2.5 space-y-2.5">
      {liste.map((o) => {
        const p = o.payload;
        const date = texte(p.appliedOn) ?? texte(p.performedOn) ?? texte(p.sownOn) ?? texte(p.sowingDate) ?? o.capturedAt;
        let titre = o.label;
        let detail = `Saisi le ${formatDateFr(o.capturedAt)}`;
        if (kind === 'phyto.create') {
          titre = texte(p.productName) ?? titre;
          detail = `${formatDateFr(date)} · ${nombreFr(nombreDe(p.dose), 3)} ${texte(p.doseUnit) ?? ''}`;
        } else if (kind === 'fertilization.create') {
          titre = texte(p.productLabel) ?? titre;
          detail = `${formatDateFr(date)} · ${p.inputType === 'ORGANIC' ? 'organique' : 'minéral'} · ${nombreFr(nombreDe(p.dose), 3)} ${texte(p.doseUnit) ?? ''}`;
        } else if (kind === 'operation.create') {
          const type = texte(p.type);
          titre = type ? (libelleTravail?.(type) ?? type) : titre;
          detail = [formatDateFr(date), texte(p.equipment)].filter(Boolean).join(' · ');
        } else if (kind === 'soilCover.create') {
          const k = texte(p.kind);
          titre = k ? (libelleCouvert?.(k) ?? k) : titre;
          detail = [`Semis ${formatDateFr(date)}`, texte(p.species)].filter(Boolean).join(' · ');
        } else if (kind === 'cropYear.create') {
          const c = texte(p.cropId);
          titre = c ? (libelleCulture?.(c) ?? titre) : titre;
          detail = [`Campagne ${String(p.campaignYear ?? '')}`, texte(p.variety)].filter(Boolean).join(' · ');
        }
        return (
          <CarteEnAttente
            key={o.clientId}
            titre={titre}
            detail={detail.trim()}
            operation={o}
            {...(modifier ? { modifier } : {})}
            {...(annuler ? { annuler } : {})}
          />
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Général
// ---------------------------------------------------------------------------

/** Ce qui s'est passé en dernier sur la parcelle : la question qu'on se pose au bord du champ. */
export function Dernieres({ fiche }: { fiche: FicheParcelle }) {
  const lignes: Array<[string, string]> = [];
  const t = fiche.traitements[0];
  const a = fiche.apports[0];
  const o = fiche.travaux[0];
  if (t) lignes.push(['Dernier traitement', `${t.productName} — ${formatDateFr(t.appliedOn)}`]);
  if (a) lignes.push(['Dernier apport', `${a.productLabel} — ${formatDateFr(a.appliedOn)}`]);
  if (o) lignes.push(['Dernier travail', `${o.typeLabel} — ${formatDateFr(o.performedOn)}`]);
  if (lignes.length === 0) return null;
  return (
    <Card>
      <dl className="divide-y divide-line">
        {lignes.map(([libelle, valeur]) => (
          <Ligne key={libelle} libelle={libelle}>
            {valeur}
          </Ligne>
        ))}
      </dl>
    </Card>
  );
}

export function PanneauGeneral({ parcel, fiche }: { parcel: CachedParcel; fiche: FicheParcelle | null }) {
  const g = fiche?.general;
  const lignes: Array<[string, ReactNode]> = [
    ['Numéro interne', parcel.internalNumber ?? '—'],
    ['Superficie', `${nombreFr(parcel.areaHa, 4)} ha`],
    ['Commune', parcel.commune ?? '—'],
    ['Lieu-dit', parcel.lieuDit ?? '—'],
    [
      'Sol drainé',
      parcel.drainedSoil === true ? 'Oui' : parcel.drainedSoil === false ? 'Non' : 'Non renseigné',
    ],
  ];
  if (g) {
    lignes.push(
      ['Code INSEE', g.inseeCode ?? '—'],
      ['Référence cadastrale', g.cadastralRef ?? '—'],
      ['Identifiant PAC / RPG', g.pacId ?? '—'],
      ['Type de parcelle', g.parcelType ?? '—'],
      ['Statut', g.statusLabel],
      [
        'Coordonnées GPS (centre)',
        g.centroid ? `${g.centroid.lat.toFixed(5)}, ${g.centroid.lng.toFixed(5)}` : '—',
      ],
      ['Créée le', formatDateFr(g.createdAt)],
    );
  }

  return (
    <div className="space-y-4">
      {fiche ? <Dernieres fiche={fiche} /> : null}

      <Card>
        <dl className="divide-y divide-line">
          {lignes.map(([libelle, valeur]) => (
            <Ligne key={libelle} libelle={libelle}>
              {valeur}
            </Ligne>
          ))}
        </dl>
      </Card>

      {g && g.declarationsPac.length > 0 ? (
        <div>
          <Titre>Déclaration TéléPAC</Titre>
          <Card>
            <ul className="divide-y divide-line">
              {g.declarationsPac.map((d) => (
                <li key={`${d.campagne}-${d.ilot}-${d.numero}`} className="py-2 text-[14px] text-ink">
                  <span className="font-medium">{d.campagne}</span> — îlot {d.ilot ?? '?'}, parcelle{' '}
                  {d.numero ?? '?'}
                  {d.culture ? <span className="block text-[13px] text-ink-3">{d.culture}</span> : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {g?.notes ? (
        <div>
          <Titre>Observations</Titre>
          <Card>
            <p className="whitespace-pre-line text-[14px] text-ink">{g.notes}</p>
          </Card>
        </div>
      ) : null}

      {fiche && fiche.documents > 0 ? (
        <p className="px-1 text-[13px] text-ink-3">
          {fiche.documents} document{fiche.documents > 1 ? 's' : ''} rattaché
          {fiche.documents > 1 ? 's' : ''} à cette parcelle — consultables sur le site.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cultures et couverts
// ---------------------------------------------------------------------------

export function PanneauCultures({
  fiche,
  campagne,
  enAttente,
  culturesEnAttente,
  ajouterCouvert,
  ajouterCulture,
  actions,
}: {
  fiche: FicheParcelle;
  campagne: number;
  enAttente: ReactNode;
  culturesEnAttente?: ReactNode;
  ajouterCouvert?: () => void;
  ajouterCulture?: () => void;
  actions?: FabriqueActions;
}) {
  return (
    <div className="space-y-5">
      <div>
        <Titre action={ajouterCulture ? <BoutonAjouter onClick={ajouterCulture}>Culture</BoutonAjouter> : undefined}>
          Assolement
        </Titre>
        {culturesEnAttente}
        {fiche.cultures.length === 0 ? (
          <EmptyState
            title="Aucune culture renseignée"
            description={
              ajouterCulture
                ? 'Renseignez la culture de la campagne : elle rattache les traitements à leur usage autorisé.'
                : 'Aucune culture n’est renseignée pour cette parcelle.'
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {fiche.cultures.map((c) => (
              <li key={c.id}>
                <CarteEnregistrement actions={actions?.('culture', c)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]" title={c.cropName}>
                      {nomCourtDeCulture(c.cropName)}
                    </p>
                    <span className="shrink-0">
                      {c.campaignYear === campagne ? (
                        <Badge tone="green">{c.campaignYear} · en cours</Badge>
                      ) : (
                        <Badge>{c.campaignYear}</Badge>
                      )}
                    </span>
                  </div>
                  <dl className="mt-2 divide-y divide-line">
                    {c.variety ? <Ligne libelle="Variété">{c.variety}</Ligne> : null}
                    <Ligne libelle="Semis">{dateOuTiret(c.sowingDate)}</Ligne>
                    <Ligne libelle="Récolte prévue">{dateOuTiret(c.expectedHarvestDate)}</Ligne>
                    <Ligne libelle="Récolte réelle">{dateOuTiret(c.actualHarvestDate)}</Ligne>
                    <Ligne libelle="Rendement">
                      {c.yieldValue !== null ? `${nombreFr(c.yieldValue, 2)} ${c.yieldUnit ?? ''}` : '—'}
                    </Ligne>
                  </dl>
                </CarteEnregistrement>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Titre action={ajouterCouvert ? <BoutonAjouter onClick={ajouterCouvert}>Couvert</BoutonAjouter> : undefined}>
          Couverts d’interculture
        </Titre>
        {enAttente}
        {fiche.couverts.length === 0 ? (
          <p className="px-1 text-[14px] text-ink-3">Aucun couvert enregistré sur cette parcelle.</p>
        ) : (
          <ul className="space-y-2.5">
            {fiche.couverts.map((c) => (
              <li key={c.id}>
                <CarteEnregistrement actions={actions?.('couvert', c)}>
                  <p className="font-semibold text-ink">
                    {c.kindLabel}
                    {c.species ? <span className="font-normal text-ink-2"> — {c.species}</span> : null}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-3">
                    Semis {dateOuTiret(c.sownOn)} · Levée {dateOuTiret(c.emergedOn)} · Destruction{' '}
                    {dateOuTiret(c.destroyedOn)}
                    {c.destructionLabel ? ` (${c.destructionLabel})` : ''}
                  </p>
                  {c.incoherences.length > 0 ? (
                    <p className="mt-1 text-[13px] text-brique-600 dark:text-brique-500">
                      {c.incoherences.join(' ')}
                    </p>
                  ) : null}
                </CarteEnregistrement>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apports
// ---------------------------------------------------------------------------

function CarteApport({ a, actions }: { a: ApportFiche; actions: ActionsEnregistrement | undefined }) {
  const elements = [
    a.n !== null ? `N ${nombreFr(a.n, 1)}` : null,
    a.p !== null ? `P₂O₅ ${nombreFr(a.p, 1)}` : null,
    a.k !== null ? `K₂O ${nombreFr(a.k, 1)}` : null,
  ].filter(Boolean);
  return (
    <CarteEnregistrement actions={actions}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium tabular-nums text-ink-3">{formatDateFr(a.appliedOn)}</p>
          <p className="font-semibold text-ink [overflow-wrap:anywhere]">{a.productLabel}</p>
          {a.cropName ? <p className="text-[13px] text-ink-3">{nomCourtDeCulture(a.cropName)}</p> : null}
        </div>
        <span className="shrink-0">
          <Badge tone={a.organique ? 'green' : 'blue'}>{a.organique ? 'Organique' : 'Minéral'}</Badge>
        </span>
      </div>
      <dl className="mt-2 divide-y divide-line">
        <Ligne libelle="Dose">
          {nombreFr(a.dose, 2)} {a.doseUnit}
        </Ligne>
        <Ligne libelle="Surface">{nombreFr(a.treatedAreaHa, 4)} ha</Ligne>
        <Ligne libelle="Quantité totale">
          {nombreFr(a.totalQuantity, 2)} {a.totalUnit}
        </Ligne>
        <Ligne libelle="Éléments (kg/ha)">{elements.length ? elements.join(' · ') : '—'}</Ligne>
      </dl>
      {a.notes ? <p className="mt-2 text-[13px] text-ink-2">{a.notes}</p> : null}
    </CarteEnregistrement>
  );
}

export function PanneauApports({
  fiche,
  enAttente,
  ajouter,
  actions,
}: {
  fiche: FicheParcelle;
  enAttente: ReactNode;
  ajouter?: () => void;
  actions?: FabriqueActions;
}) {
  const b = fiche.bilan;
  return (
    <div className="space-y-5">
      {b ? (
        <div>
          <Titre>Bilan — cumul de tous les apports</Titre>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['Azote (N)', b.perHectareN, b.totalN],
                ['P₂O₅', b.perHectareP, b.totalP],
                ['K₂O', b.perHectareK, b.totalK],
              ] as const
            ).map(([libelle, parHa, total]) => (
              <div key={libelle} className="rounded-2xl border border-line bg-surface p-3">
                <p className="text-[12px] text-ink-3">{libelle}</p>
                <p className="mt-0.5 text-[18px] font-bold tabular-nums leading-tight text-ink">
                  {nombreFr(parHa, 1)}
                  <span className="ml-0.5 text-[11px] font-normal text-ink-3">kg/ha</span>
                </p>
                <p className="text-[11px] tabular-nums text-ink-3">{nombreFr(total, 1)} kg au total</p>
              </div>
            ))}
          </div>
          {b.incompleteCount > 0 ? (
            <p className="mt-2 px-1 text-[13px] text-ble-600 dark:text-ble-400">
              {b.incompleteCount} apport{b.incompleteCount > 1 ? 's sont' : ' est'} sans teneur en azote
              connue : le bilan est donc sous-estimé.
            </p>
          ) : null}
        </div>
      ) : null}

      {fiche.cultures.length > 0 ? (
        <div>
          <Titre>Plan prévisionnel de fumure</Titre>
          <Card>
            <ul className="divide-y divide-line">
              {fiche.cultures.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-[14px] text-ink [overflow-wrap:anywhere]">
                    {nomCourtDeCulture(c.cropName)} — {c.campaignYear}
                  </span>
                  <span className="shrink-0">
                    {c.planFumure ? (
                      c.planFumure.doseKgHa !== null ? (
                        <Badge tone="green">{nombreFr(c.planFumure.doseKgHa, 0)} kg N/ha</Badge>
                      ) : (
                        <Badge tone="amber">Dose non calculable</Badge>
                      )
                    ) : (
                      <Badge>À établir</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div>
        <Titre action={ajouter ? <BoutonAjouter onClick={ajouter}>Apport</BoutonAjouter> : undefined}>
          Apports ({fiche.apports.length})
        </Titre>
        {enAttente}
        {fiche.apports.length === 0 ? (
          <EmptyState title="Aucun apport enregistré" />
        ) : (
          <ul className="space-y-2.5">
            {fiche.apports.map((a) => (
              <li key={a.id}>
                <CarteApport a={a} actions={actions?.('apport', a)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phytosanitaire
// ---------------------------------------------------------------------------

function CarteTraitement({ t, actions }: { t: TraitementFiche; actions: ActionsEnregistrement | undefined }) {
  return (
    <CarteEnregistrement actions={actions}>
      <p className="text-[13px] font-medium tabular-nums text-ink-3">{formatDateFr(t.appliedOn)}</p>
      <p className="font-semibold text-ink [overflow-wrap:anywhere]">{t.productName}</p>
      <dl className="mt-2 divide-y divide-line">
        <Ligne libelle="AMM">{t.amm ? <span className="tabular-nums">{t.amm}</span> : <Badge tone="amber">Manquant</Badge>}</Ligne>
        {t.activeSubstances ? <Ligne libelle="Substances">{t.activeSubstances}</Ligne> : null}
        <Ligne libelle="Cible">{t.targetLabel ?? '—'}</Ligne>
        <Ligne libelle="Dose">
          {nombreFr(t.dose, 3)} {t.doseUnit}
        </Ligne>
        <Ligne libelle="Surface">{nombreFr(t.treatedAreaHa, 4)} ha</Ligne>
        <Ligne libelle="Quantité">
          {nombreFr(t.quantityUsed, 3)} {t.quantityUnit}
        </Ligne>
        <Ligne libelle="Conditions">
          {t.conditions ?? <span className="text-ble-600 dark:text-ble-400">Non renseignées</span>}
        </Ligne>
        {t.operator ? <Ligne libelle="Opérateur">{t.operator}</Ligne> : null}
      </dl>
      {t.notes ? <p className="mt-2 text-[13px] text-ink-2">{t.notes}</p> : null}
    </CarteEnregistrement>
  );
}

export function PanneauPhyto({
  fiche,
  enAttente,
  ajouter,
  actions,
}: {
  fiche: FicheParcelle;
  enAttente: ReactNode;
  ajouter?: () => void;
  actions?: FabriqueActions;
}) {
  return (
    <div>
      <Titre action={ajouter ? <BoutonAjouter onClick={ajouter}>Traitement</BoutonAjouter> : undefined}>
        Traitements ({fiche.traitements.length})
      </Titre>
      {enAttente}
      {fiche.traitements.length === 0 ? (
        <EmptyState title="Aucun traitement enregistré" />
      ) : (
        <ul className="space-y-2.5">
          {fiche.traitements.map((t) => (
            <li key={t.id}>
              <CarteTraitement t={t} actions={actions?.('phyto', t)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Travaux
// ---------------------------------------------------------------------------

function CarteTravail({ o, actions }: { o: TravailFiche; actions: ActionsEnregistrement | undefined }) {
  return (
    <CarteEnregistrement actions={actions}>
      <p className="text-[13px] font-medium tabular-nums text-ink-3">{formatDateFr(o.performedOn)}</p>
      <p className="font-semibold text-ink">{o.typeLabel}</p>
      <dl className="mt-2 divide-y divide-line">
        <Ligne libelle="Matériel">{o.equipment ?? '—'}</Ligne>
        <Ligne libelle="Opérateur">{o.operator ?? '—'}</Ligne>
        <Ligne libelle="Durée">{o.durationHours !== null ? `${nombreFr(o.durationHours, 1)} h` : '—'}</Ligne>
      </dl>
      {o.observations ? <p className="mt-2 text-[13px] text-ink-2">{o.observations}</p> : null}
    </CarteEnregistrement>
  );
}

export function PanneauTravaux({
  fiche,
  enAttente,
  ajouter,
  actions,
}: {
  fiche: FicheParcelle;
  enAttente: ReactNode;
  ajouter?: () => void;
  actions?: FabriqueActions;
}) {
  return (
    <div>
      <Titre action={ajouter ? <BoutonAjouter onClick={ajouter}>Travail</BoutonAjouter> : undefined}>
        Travaux réalisés ({fiche.travaux.length})
      </Titre>
      {enAttente}
      {fiche.travaux.length === 0 ? (
        <EmptyState title="Aucun travail enregistré" />
      ) : (
        <ul className="space-y-2.5">
          {fiche.travaux.map((o) => (
            <li key={o.id}>
              <CarteTravail o={o} actions={actions?.('travaux', o)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

const TONS: Record<TypeEvenement, 'green' | 'blue' | 'amber' | 'neutral'> = {
  CROP: 'green',
  HARVEST: 'green',
  FERTILIZATION: 'blue',
  PHYTO: 'amber',
  OPERATION: 'neutral',
  DOCUMENT: 'neutral',
};

export function PanneauHistorique({ fiche }: { fiche: FicheParcelle }) {
  if (fiche.historique.length === 0) {
    return (
      <EmptyState
        title="Historique vide"
        description="Il se remplit au fil des saisies : cultures, apports, traitements, travaux et documents."
      />
    );
  }
  return (
    <Card>
      <ol className="relative space-y-4 border-l-2 border-line pl-4">
        {fiche.historique.map((e) => (
          <li key={e.id} className="relative">
            <span
              aria-hidden
              className={cn(
                'absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-surface',
                e.kind === 'PHYTO' ? 'bg-ble-500' : e.kind === 'FERTILIZATION' ? 'bg-ciel-500' : 'bg-champ-500',
              )}
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <time className="text-[13px] font-semibold tabular-nums text-ink">{formatDateFr(e.date)}</time>
              <Badge tone={TONS[e.kind]}>{LIBELLES_EVENEMENT[e.kind]}</Badge>
            </div>
            <p className="mt-0.5 text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{e.title}</p>
            {e.details.length > 0 ? (
              <ul className="mt-0.5 space-y-0.5 text-[13px] text-ink-2">
                {e.details.map((d) => (
                  <li key={d} className="[overflow-wrap:anywhere]">
                    {d}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
