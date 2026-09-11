import { useState } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel } from '../lib/types';
import { formatAreaHa } from '../lib/geo';
import { enqueue } from '../lib/db';
import { Badge, Banner, Button, Card, Field, Header, Input } from '../components/ui';

/**
 * Fiche d'une parcelle : ce qu'on en sait, et ce qu'on peut y saisir.
 *
 * Trois actions seulement, celles qui se font au champ. La consultation
 * détaillée des registres reste sur l'application web : la reproduire ici
 * alourdirait l'APK pour un usage qui se fait de toute façon au bureau.
 *
 * L'expert agronomique voit la même fiche, mais une seule action : rédiger une
 * préconisation. Il ne remplit aucun registre de l'exploitation — la règle est
 * la même ici que dans le contrôle de permissions du serveur.
 */
export function ParcelScreen({
  context,
  parcel,
}: {
  context: AppContext;
  parcel: CachedParcel;
}) {
  const { back, navigate, readOnly, refreshPending, renommerLocalement } = context;

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

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={parcel.name}
        subtitle={
          [parcel.internalNumber, parcel.lieuDit, parcel.commune]
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
                  placeholder="Les Sauvattes"
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                Superficie
              </p>
              <p className="mt-0.5 text-[26px] font-bold tabular-nums text-ink">
                {formatAreaHa(parcel.areaHa)}
              </p>
              <p className="text-[12px] text-ink-3">calculée par PostGIS</p>
            </div>
            {parcel.cropName ? (
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  Culture
                </p>
                <div className="mt-1">
                  <Badge tone="green">{parcel.cropName}</Badge>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

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
      </div>
    </div>
  );
}
