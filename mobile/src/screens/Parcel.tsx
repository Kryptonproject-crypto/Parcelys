import { useEffect, useState } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel, QueuedOperation } from '../lib/types';
import { formatAreaHa } from '../lib/geo';
import { enqueue, readOutbox } from '../lib/db';
import { Banner, Button, Card, Field, Header, Input, Spinner, cn } from '../components/ui';
import { PointCulture } from '../components/culture';
import {
  EnAttente,
  ONGLETS,
  PanneauApports,
  PanneauCultures,
  PanneauGeneral,
  PanneauHistorique,
  PanneauPhyto,
  PanneauTravaux,
  type Onglet,
} from '../components/registres';
import { nomDitLeNumero } from '@commun/cultures';

/**
 * Fiche d'une parcelle : ce qu'on en sait, ce qui y a été fait, et ce qu'on
 * peut y saisir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES REGISTRES, AUSSI SUR LE TÉLÉPHONE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Jusqu'à la 0.11.0, la fiche ne proposait que des saisies : pour savoir quel
 * produit avait été passé, et quand, il fallait le site. Or c'est au bord du
 * champ, le pulvérisateur attelé, que la question se pose. La fiche reprend
 * donc les rubriques du site — Général, Cultures, Apports, Phyto, Travaux,
 * Historique —, lues dans les registres gardés sur l'appareil
 * (`lib/registres.ts`) : elles s'affichent sans réseau, telles qu'à la
 * dernière synchronisation, et le disent.
 *
 * L'expert agronomique voit la même fiche, en lecture, et une seule action :
 * rédiger une préconisation. Il ne remplit aucun registre de l'exploitation —
 * la règle est la même ici que dans le contrôle de permissions du serveur.
 */

/**
 * Rubrique ouverte, parcelle par parcelle, pour la durée de la session.
 *
 * Saisir un apport fait quitter la fiche ; au retour, on veut retrouver la
 * rubrique Apports — et l'apport qu'on vient de saisir, en attente d'envoi —,
 * pas revenir à l'onglet Général.
 */
const ongletsOuverts = new Map<string, Onglet>();

const SAISIES_DE_REGISTRE: ReadonlySet<QueuedOperation['kind']> = new Set([
  'phyto.create',
  'fertilization.create',
  'operation.create',
  'soilCover.create',
]);
export function ParcelScreen({
  context,
  parcel,
}: {
  context: AppContext;
  parcel: CachedParcel;
}) {
  const {
    back,
    navigate,
    readOnly,
    refreshPending,
    renommerLocalement,
    registres,
    registresEtat,
    actualiserRegistres,
    online,
    pending,
    snapshot,
  } = context;

  const [onglet, setOnglet] = useState<Onglet>(ongletsOuverts.get(parcel.id) ?? 'general');
  function ouvrir(cle: Onglet): void {
    ongletsOuverts.set(parcel.id, cle);
    setOnglet(cle);
  }

  const fiche = registres?.parcels[parcel.id] ?? null;

  /** Saisies de cette parcelle encore sur le téléphone. Relu quand la file bouge. */
  const [enFile, setEnFile] = useState<QueuedOperation[]>([]);
  useEffect(() => {
    let actif = true;
    void readOutbox().then((file) => {
      if (actif) {
        setEnFile(file.filter((o) => o.parcelId === parcel.id && SAISIES_DE_REGISTRE.has(o.kind)));
      }
    });
    return () => {
      actif = false;
    };
  }, [parcel.id, pending]);

  const libelleTravail = (code: string): string =>
    snapshot?.referential.operationTypes.find((t) => t.value === code)?.label ?? code;
  const libelleCouvert = (code: string): string =>
    snapshot?.referential.soilCoverKinds?.find((t) => t.value === code)?.label ?? code;
  const saisir = (kind: 'phyto' | 'apport' | 'travaux' | 'couvert') =>
    readOnly ? undefined : () => navigate({ name: 'entry', kind, parcelId: parcel.id });

  /**
   * Renommer la parcelle, depuis le champ.
   *
   * C'est là qu'on sait comment elle s'appelle : devant elle. Un import
   * TéléPAC la nomme « Îlot 39 — parcelle 3 » ; le nom qu'on lui donne
   * vraiment vient au moment où l'on y est, pas le soir à la maison.
   *
   * L'expert en mission de conseil ne renomme pas : le parcellaire appartient
   * à l'exploitation. Le serveur le refuserait de toute façon — cette
   * condition-ci évite seulement de proposer un geste voué à l'échec.
   */
  const [renommage, setRenommage] = useState(false);
  const [nom, setNom] = useState(parcel.name);
  const [numero, setNumero] = useState(parcel.internalNumber ?? '');
  const [lieu, setLieu] = useState(parcel.lieuDit ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  function ouvrirRenommage(): void {
    setNom(parcel.name);
    setNumero(parcel.internalNumber ?? '');
    setLieu(parcel.lieuDit ?? '');
    setErreur(null);
    setRenommage(true);
  }

  async function enregistrerNom(): Promise<void> {
    const propre = nom.trim();
    if (!propre) {
      setErreur('Donnez un nom à la parcelle.');
      return;
    }
    setEnvoi(true);
    try {
      const valeurs = {
        name: propre,
        internalNumber: numero.trim() || null,
        lieuDit: lieu.trim() || null,
      };
      // Comme toute saisie : par la file d'attente, réseau ou pas. Un seul
      // chemin de code, donc un seul comportement à vérifier.
      await enqueue({
        clientId: crypto.randomUUID(),
        kind: 'parcel.rename',
        parcelId: parcel.id,
        label: `Parcelle « ${propre} »`,
        capturedAt: new Date().toISOString(),
        attempts: 0,
        payload: valeurs,
      });
      await renommerLocalement(parcel.id, valeurs);
      await refreshPending();
      setRenommage(false);
    } finally {
      setEnvoi(false);
    }
  }

  const ADVISOR_ACTIONS = [
    {
      kind: 'preconisation' as const,
      title: 'Rédiger une préconisation',
      description:
        'Votre conseil et ce qui le motive. L’exploitation décidera de le suivre.',
      icon: (
        <path
          d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.3.2.5.6.5 1V15h6v-.1c0-.4.2-.8.5-1A6 6 0 0012 3z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    },
  ];

  const actions = [
    {
      kind: 'phyto' as const,
      title: 'Traitement phytosanitaire',
      description: 'Produit, dose, date — pour le registre réglementaire.',
      icon: (
        <path
          d="M9 3h6M10 3v5.5L5.5 17A2.5 2.5 0 008 21h8a2.5 2.5 0 002.5-4L14 8.5V3"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    },
    {
      kind: 'apport' as const,
      title: 'Apport de fertilisant',
      description: 'Engrais minéral ou produit organique, avec la dose.',
      icon: (
        <path
          d="M12 3s5 5.5 5 9a5 5 0 01-10 0c0-3.5 5-9 5-9z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    },
    {
      kind: 'travaux' as const,
      title: 'Travail réalisé',
      description: 'Labour, semis, récolte, irrigation… avec le matériel employé.',
      icon: (
        <path
          d="M4 17h3l2-6h6l2 6h3M7 21a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    },
    {
      // Le semis d'un CIPAN se fait rarement à portée de réseau, et le noter le
      // soir venu, c'est le noter de mémoire — donc parfois pas du tout.
      kind: 'couvert' as const,
      title: 'Couvert d’interculture',
      description: 'CIPAN, dérobée, repousses — avec semis et destruction.',
      icon: (
        <path
          d="M12 20V9m0 0c0-3 2-5 5-5 0 3-2 5-5 5zm0 0c0-3-2-5-5-5 0 3 2 5 5 5zM6 20h12"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ),
    },
  ];

  const interventions = (
    <div>
      <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
        {readOnly ? 'Conseiller sur cette parcelle' : 'Enregistrer une intervention'}
      </h2>
      <ul className="space-y-2.5">
        {(readOnly ? ADVISOR_ACTIONS : actions).map((action) => (
          <li key={action.kind}>
            <Card
              onClick={() =>
                action.kind === 'preconisation'
                  ? navigate({ name: 'new-recommendation', parcelId: parcel.id })
                  : navigate({ name: 'entry', kind: action.kind, parcelId: parcel.id })
              }
            >
              <div className="flex items-center gap-3.5">
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    {action.icon}
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    {action.title}
                  </span>
                  <span className="block text-[13px] leading-snug text-ink-3">
                    {action.description}
                  </span>
                </span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="shrink-0 text-ink-3"
                >
                  <path
                    d="M9 5l7 7-7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={parcel.name}
        subtitle={
          [
            nomDitLeNumero(parcel.name, parcel.internalNumber) ? null : parcel.internalNumber,
            parcel.lieuDit,
            parcel.commune,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        onBack={back}
        action={
          readOnly || renommage ? undefined : (
            <button
              type="button"
              onClick={ouvrirRenommage}
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-accent-ink"
            >
              Renommer
            </button>
          )
        }
      />

      <div className="flex-1 space-y-4 px-4 py-4">
        {renommage ? (
          <Card>
            <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Renommer la parcelle
            </h2>
            <div className="space-y-3">
              {erreur ? <Banner tone="danger">{erreur}</Banner> : null}

              <Field label="Nom de la parcelle" required>
                <Input
                  value={nom}
                  onChange={(event) => setNom(event.target.value)}
                  placeholder="La Croix Rouge"
                  autoFocus
                />
              </Field>

              <Field label="Numéro interne">
                <Input
                  value={numero}
                  onChange={(event) => setNumero(event.target.value)}
                  placeholder="39-3"
                  inputMode="text"
                />
              </Field>

              <Field label="Lieu-dit">
                <Input
                  value={lieu}
                  onChange={(event) => setLieu(event.target.value)}
                  placeholder="Les Vernes"
                />
              </Field>

              <p className="text-[12px] leading-snug text-ink-3">
                Le nom que vous employez sur l’exploitation. Il ne change rien à votre
                déclaration PAC, et part à la synchronisation comme vos autres saisies.
              </p>

              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setRenommage(false)} disabled={envoi}>
                  Annuler
                </Button>
                <Button onClick={() => void enregistrerNom()} disabled={envoi}>
                  {envoi ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        <Card>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Superficie</p>
          <p className="mt-0.5 text-[28px] font-bold leading-tight tabular-nums text-ink">
            {formatAreaHa(parcel.areaHa)}
          </p>
          {/* Le libellé entier ici, et non la forme courte des listes : c'est
              la fiche, on a la place de le lire. */}
          <div className="mt-3 flex items-start gap-2.5 border-t border-line pt-3">
            {parcel.cropName ? <PointCulture nom={parcel.cropName} className="mt-1.5" /> : null}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Culture</p>
              {parcel.cropName ? (
                <p className="text-[15px] font-medium leading-snug text-ink">{parcel.cropName}</p>
              ) : (
                <p className="text-[15px] text-ble-600 dark:text-ble-400">Non renseignée</p>
              )}
            </div>
          </div>
        </Card>

        <nav
          role="tablist"
          aria-label="Rubriques de la parcelle"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
        >
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              type="button"
              role="tab"
              aria-selected={onglet === o.cle}
              onClick={() => ouvrir(o.cle)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-2 text-[14px] font-medium',
                onglet === o.cle
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-surface text-ink-2 active:bg-surface-2',
              )}
            >
              {o.libelle}
            </button>
          ))}
        </nav>

        <div role="tabpanel" aria-label={ONGLETS.find((o) => o.cle === onglet)?.libelle}>
          {onglet === 'general' ? (
            <div className="space-y-4">
              {interventions}
              <PanneauGeneral parcel={parcel} fiche={fiche} />
            </div>
          ) : !fiche ? (
            registresEtat.enCours && !registres ? (
              <Card>
                <p className="flex items-center gap-2.5 text-[14px] text-ink-2">
                  <Spinner /> Chargement des registres…
                </p>
              </Card>
            ) : (
              <Banner tone="info">
                {registres
                  ? 'Les registres de cette parcelle ne sont pas encore sur le téléphone : ils arriveront à la prochaine synchronisation.'
                  : 'Les registres ne sont pas encore sur le téléphone. Ils arrivent à la première synchronisation avec du réseau.'}
              </Banner>
            )
          ) : onglet === 'cultures' ? (
            <PanneauCultures
              fiche={fiche}
              campagne={registres?.campaignYear ?? snapshot?.campaignYear ?? new Date().getFullYear()}
              enAttente={<EnAttente operations={enFile} kind="soilCover.create" libelleCouvert={libelleCouvert} />}
              ajouterCouvert={saisir('couvert')}
            />
          ) : onglet === 'apports' ? (
            <PanneauApports
              fiche={fiche}
              enAttente={<EnAttente operations={enFile} kind="fertilization.create" />}
              ajouter={saisir('apport')}
            />
          ) : onglet === 'phyto' ? (
            <PanneauPhyto
              fiche={fiche}
              enAttente={<EnAttente operations={enFile} kind="phyto.create" />}
              ajouter={saisir('phyto')}
            />
          ) : onglet === 'travaux' ? (
            <PanneauTravaux
              fiche={fiche}
              enAttente={<EnAttente operations={enFile} kind="operation.create" libelleTravail={libelleTravail} />}
              ajouter={saisir('travaux')}
            />
          ) : (
            <PanneauHistorique fiche={fiche} />
          )}
        </div>

        {/* D'où viennent ces registres, et de quand : hors réseau, on lit ce
            qu'il y avait à la dernière synchronisation, et il faut le savoir. */}
        <div className="px-1 text-[12.5px] leading-snug text-ink-3">
          {registres ? (
            <p>
              Registres à jour au {new Date(registres.verifiedAt).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {enFile.length > 0
                ? ` · ${enFile.length} saisie${enFile.length > 1 ? 's' : ''} en attente d’envoi`
                : ''}
              .
            </p>
          ) : null}
          {registresEtat.erreur ? <p className="mt-0.5">{registresEtat.erreur}</p> : null}
          {online ? (
            <button
              type="button"
              onClick={() => void actualiserRegistres()}
              disabled={registresEtat.enCours}
              className="mt-1 font-semibold text-accent-ink disabled:opacity-60"
            >
              {registresEtat.enCours ? 'Actualisation…' : 'Actualiser'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
