import { useMemo, useState } from 'react';
import type { AppContext } from '../App';
import {
  dansLaParcelle,
  distanceMeters,
  formatAreaHa,
  formatDistance,
} from '../lib/geo';
import { GeolocationDenied, currentPosition } from '../lib/geolocation';
import type { CachedParcel, Position } from '../lib/types';

/**
 * Centre approximatif d'une géométrie, pour ne donner qu'un ordre de distance.
 *
 * La moyenne des sommets, pas le centroïde exact : on s'en sert pour dire « la
 * plus proche est à 300 m », jamais pour décider dans quelle parcelle on est —
 * cette décision-là passe par `dansLaParcelle`, qui ne se contente pas d'un
 * à-peu-près.
 */
function centroidGeometrie(
  geometry: { type: string; coordinates: unknown } | null,
): Position | null {
  const points: Array<[number, number]> = [];
  const parcourir = (noeud: unknown): void => {
    if (!Array.isArray(noeud)) return;
    if (typeof noeud[0] === 'number' && typeof noeud[1] === 'number') {
      points.push([noeud[0], noeud[1]]);
      return;
    }
    for (const enfant of noeud) parcourir(enfant);
  };
  parcourir(geometry?.coordinates);
  if (points.length === 0) return null;
  const somme = points.reduce((a, [x, y]) => ({ x: a.x + x, y: a.y + y }), { x: 0, y: 0 });
  return { lng: somme.x / points.length, lat: somme.y / points.length };
}
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Header,
  Input,
  SyncBadge,
  cn,
} from '../components/ui';

/**
 * Écran d'accueil : les parcelles de l'exploitation.
 *
 * C'est la liste cachée localement, donc toujours disponible. Un bandeau
 * indique franchement quand elle date d'avant la dernière sortie hors réseau,
 * plutôt que de laisser croire qu'elle est à jour.
 */
export function ParcelsScreen({ context }: { context: AppContext }) {
  const { snapshot, online, pending, syncStatus, navigate, back, isExpert, readOnly } =
    context;
  const [search, setSearch] = useState('');
  const [localisation, setLocalisation] = useState<'repos' | 'recherche' | 'erreur'>(
    'repos',
  );
  const [messageLocalisation, setMessageLocalisation] = useState<string | null>(null);

  /**
   * Ouvre la parcelle où l'on se trouve.
   *
   * Trois réponses possibles, et toutes les trois doivent être dites : on est
   * dans une parcelle, on n'est dans aucune, ou on ne sait pas. Ouvrir « la
   * plus proche » quand on est sur la route serait la quatrième — celle qui
   * ferait saisir un traitement sur la mauvaise parcelle.
   */
  async function ouLeSuisJe(): Promise<void> {
    setLocalisation('recherche');
    setMessageLocalisation(null);
    try {
      const position = await currentPosition();
      const trouvee = (snapshot?.parcels ?? []).find((parcel) =>
        dansLaParcelle(position, parcel.geometry),
      );

      if (trouvee) {
        setLocalisation('repos');
        navigate({ name: 'parcel', parcelId: trouvee.id });
        return;
      }

      // Aucune parcelle ne contient le point : on le dit, et on donne la plus
      // proche **à titre indicatif**, sans l'ouvrir.
      const proche = (snapshot?.parcels ?? [])
        .map((parcel) => {
          const centre = centroidGeometrie(parcel.geometry);
          return centre
            ? { parcel, distance: distanceMeters(position, centre) }
            : null;
        })
        .filter((x): x is { parcel: CachedParcel; distance: number } => x !== null)
        .sort((a, b) => a.distance - b.distance)[0];

      setLocalisation('erreur');
      setMessageLocalisation(
        proche
          ? `Vous n’êtes dans aucune de vos parcelles. La plus proche est ` +
            `« ${proche.parcel.name} », à ${formatDistance(proche.distance)}.`
          : 'Vous n’êtes dans aucune de vos parcelles.',
      );
    } catch (cause) {
      setLocalisation('erreur');
      setMessageLocalisation(
        cause instanceof GeolocationDenied
          ? cause.message
          : 'Position introuvable. Sous les arbres ou en bâtiment, le GPS met du temps.',
      );
    }
  }

  const waiting = (snapshot?.recommendations ?? []).filter(
    (item) => item.status === 'PROPOSED',
  ).length;

  const parcels = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = snapshot?.parcels ?? [];
    if (!term) return all;
    return all.filter((parcel) =>
      [parcel.name, parcel.internalNumber, parcel.commune, parcel.cropName]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    );
  }, [snapshot, search]);

  const totalArea = (snapshot?.parcels ?? []).reduce(
    (sum, parcel) => sum + parcel.areaHa,
    0,
  );

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title={snapshot?.farm.name ?? 'Parcelys'}
        subtitle={
          snapshot
            ? `${snapshot.parcels.length} parcelle(s) · ${formatAreaHa(totalArea)}`
            : 'Aucune donnée en cache'
        }
        // L'expert revient à son portefeuille ; l'exploitant est déjà chez lui.
        {...(isExpert ? { onBack: back } : {})}
        action={
          <div className="flex items-center gap-1">
            {/* Le voyant remplace l'ancienne icône de file : il porte l'état,
                le nombre en attente et la navigation vers l'écran d'envoi.
                Deux indicateurs pour la même chose finissaient par se
                contredire — l'icône ne savait dire que « il y en a », pas
                « ça n'est pas parti ». */}
            <SyncBadge
              status={syncStatus}
              pending={pending}
              onClick={() => navigate({ name: 'queue' })}
            />
            <button
              type="button"
              onClick={() => navigate({ name: 'settings' })}
              aria-label="Réglages"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                <path
                  d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 3.68 1.65 1.65 0 009 2.17V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.32 8c.14.35.4.65.74.83H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        }
      />

      <div className="flex-1 space-y-3 px-4 py-4">
        {!online ? (
          <div className="flex items-center gap-2 rounded-xl border border-ble-500/40 bg-ble-500/10 px-3.5 py-2.5 text-[13.5px] text-ble-600 dark:text-ble-400">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-current" />
            Hors réseau — vos saisies partiront à la reconnexion.
          </div>
        ) : null}

        {readOnly ? (
          <div className="rounded-xl border border-ciel-500/40 bg-ciel-500/10 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-ciel-600 dark:text-ciel-500">
            Domaine suivi en conseil : vous consultez le parcellaire et rédigez
            des préconisations, sans écrire dans les registres.
          </div>
        ) : null}

        {snapshot ? (
          <button
            type="button"
            onClick={() => navigate({ name: 'recommendations' })}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 text-left active:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block font-semibold text-ink">Préconisations</span>
              <span className="block text-[13px] text-ink-3">
                {waiting > 0
                  ? `${waiting} en attente de décision`
                  : isExpert
                    ? 'Vos conseils pour ce domaine'
                    : 'Les conseils reçus de votre expert'}
              </span>
            </span>
            {waiting > 0 ? (
              <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-ble-500 px-1.5 text-[12px] font-bold text-white">
                {waiting}
              </span>
            ) : (
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
            )}
          </button>
        ) : null}

        {snapshot ? (
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Rechercher une parcelle"
              inputMode="search"
              autoCapitalize="none"
            />

            {/*
              « Où suis-je ? » — la question qu'on se pose vraiment au champ.
              Chercher par le nom suppose qu'on le connaisse ; sur cent
              parcelles importées d'un dossier PAC, les noms sont « Îlot 39 —
              parcelle 3 » et personne ne les a en tête.

              Le calcul se fait dans le téléphone, à partir des géométries déjà
              en cache : la réponse arrive sans réseau, ce qui est précisément
              la situation.
            */}
            <Button
              variant="secondary"
              full
              loading={localisation === 'recherche'}
              onClick={() => void ouLeSuisJe()}
            >
              Où suis-je ?
            </Button>

            {messageLocalisation ? (
              <Banner tone={localisation === 'erreur' ? 'warning' : 'info'}>
                {messageLocalisation}
              </Banner>
            ) : null}
          </>
        ) : null}

        {!snapshot ? (
          <EmptyState
            title="Rien en cache"
            description="Connectez-vous au réseau une première fois pour télécharger vos parcelles. Elles resteront ensuite disponibles hors ligne."
          />
        ) : parcels.length === 0 ? (
          <EmptyState
            title={search ? 'Aucun résultat' : 'Aucune parcelle'}
            description={
              search
                ? 'Aucune parcelle ne correspond à cette recherche.'
                : 'Relevez votre première parcelle en marchant son contour.'
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {parcels.map((parcel) => (
              <li key={parcel.id}>
                <Card onClick={() => navigate({ name: 'parcel', parcelId: parcel.id })}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{parcel.name}</p>
                      <p className="truncate text-[13.5px] text-ink-3">
                        {[parcel.internalNumber, parcel.commune]
                          .filter(Boolean)
                          .join(' · ') || 'Sans référence'}
                      </p>
                    </div>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums text-ink">
                        {formatAreaHa(parcel.areaHa)}
                      </span>
                      {parcel.cropName ? (
                        <Badge tone="green">{parcel.cropName}</Badge>
                      ) : null}
                    </span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className={cn(
          'safe-bottom sticky bottom-0 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur',
        )}
      >
        {/* Un expert missionné ne relève pas de parcelle : il conseille. */}
        {readOnly ? (
          <Button full onClick={() => navigate({ name: 'new-recommendation' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            Rédiger une préconisation
          </Button>
        ) : (
          <Button full onClick={() => navigate({ name: 'new-parcel' })}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
            Relever une parcelle
          </Button>
        )}
      </div>
    </div>
  );
}
