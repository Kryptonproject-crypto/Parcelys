import type { AppContext } from '../App';
import type { CachedParcel } from '../lib/types';
import { formatAreaHa } from '../lib/geo';
import { Badge, Card, Header } from '../components/ui';

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
  const { back, navigate, readOnly } = context;

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
      description: 'Labour, semis, récolte… avec le matériel employé.',
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
  ];

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={parcel.name}
        subtitle={
          [parcel.internalNumber, parcel.commune].filter(Boolean).join(' · ') ||
          undefined
        }
        onBack={back}
      />

      <div className="flex-1 space-y-4 px-4 py-4">
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
