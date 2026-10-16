import { useMemo, useState } from 'react';
import type { AppContext } from '../App';
import {
  dansLaParcelle,
  distanceMeters,
  formatAreaHa,
  formatDistance,
} from '../lib/geo';
import { contientSansAccent } from '@commun/texte';
import { comparerParcelles, nomCourtDeCulture, nomDitLeNumero } from '@commun/cultures';
import { PointCulture } from '../components/culture';
import {
  IconeCarte,
  IconeConseil,
  IconeFermer,
  IconeLocaliser,
  IconePlus,
  IconeRecherche,
  IconeReglages,
  IconeStock,
  IconeSuite,
} from '../components/icones';
import { releverPosition } from '../lib/geolocation';
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
  Banner,
  Button,
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
  const [culture, setCulture] = useState<string | null>(null);
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
    setMessageLocalisation('Recherche de la position…');
    try {
      // Plusieurs points, pas le premier venu : le premier est souvent celui
      // du réseau, à trente mètres, et suffit à ouvrir la parcelle voisine.
      const position = await releverPosition({
        onProgres: ({ precision, points }) =>
          setMessageLocalisation(
            precision === null
              ? 'Recherche de la position…'
              : `Recherche de la position… ±${Math.round(precision)} m (${points} point${points > 1 ? 's' : ''})`,
          ),
      });
      const trouvee = (snapshot?.parcels ?? []).find((parcel) =>
        dansLaParcelle(position, parcel.geometry),
      );

      if (trouvee) {
        setLocalisation('repos');
        setMessageLocalisation(null);
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
      // La précision est dite : « aucune parcelle » à ±4 m et à ±40 m ne
      // valent pas la même chose quand on est en bordure.
      const precision =
        position.accuracy !== undefined ? ` (position à ±${Math.round(position.accuracy)} m)` : '';
      setMessageLocalisation(
        proche
          ? `Vous n’êtes dans aucune de vos parcelles${precision}. La plus proche est ` +
            `« ${proche.parcel.name} », à ${formatDistance(proche.distance)}.`
          : `Vous n’êtes dans aucune de vos parcelles${precision}.`,
      );
    } catch (cause) {
      setLocalisation('erreur');
      setMessageLocalisation(
        cause instanceof Error
          ? cause.message
          : 'Position introuvable. Sous les arbres ou en bâtiment, le GPS met du temps.',
      );
    }
  }

  const waiting = (snapshot?.recommendations ?? []).filter(
    (item) => item.status === 'PROPOSED',
  ).length;

  /**
   * La recherche, telle qu'on tape au champ.
   *
   * Elle comparait en minuscules seulement : « cote » ne trouvait pas
   * « La Côte », « chene » ne trouvait pas « Le Chêne ». Les parcelles portent
   * des noms de lieux français, et personne ne met les accents sur un clavier
   * de téléphone, une main sur le volant. `contientSansAccent` vient du
   * terrain commun — c'est la même règle que le site, et un test confronte les
   * deux implémentations, celle-ci et celle de la base.
   *
   * Le lieu-dit s'ajoute aux quatre champs déjà cherchés : c'est souvent par
   * lui qu'on désigne une parcelle à quelqu'un.
   */
  const parcels = useMemo(() => {
    const term = search.trim();
    const all = [...(snapshot?.parcels ?? [])].sort(comparerParcelles);
    return all.filter((parcel) => {
      if (culture === SANS_CULTURE ? parcel.cropName : culture && parcel.cropName !== culture) return false;
      if (!term) return true;
      return contientSansAccent(
        [parcel.name, parcel.internalNumber, parcel.commune, parcel.lieuDit, parcel.cropName]
          .filter(Boolean)
          .join(' '),
        term,
      );
    });
  }, [snapshot, search, culture]);

  /**
   * Les cultures de l'exploitation, de la plus fréquente à la plus rare : sur
   * cent parcelles, c'est par la culture qu'on cherche « mes blés ».
   */
  const cultures = useMemo(() => {
    const parCulture = new Map<string, number>();
    let sans = 0;
    for (const parcel of snapshot?.parcels ?? []) {
      if (parcel.cropName) parCulture.set(parcel.cropName, (parCulture.get(parcel.cropName) ?? 0) + 1);
      else sans += 1;
    }
    return {
      liste: [...parCulture].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')),
      sans,
    };
  }, [snapshot]);

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
            ? `${snapshot.parcels.length} parcelle${snapshot.parcels.length > 1 ? 's' : ''} · ${formatAreaHa(totalArea)}`
            : 'Aucune donnée en cache'
        }
        // L'expert revient à son portefeuille ; l'exploitant est déjà chez lui.
        {...(isExpert ? { onBack: back } : {})}
        action={
          <div className="flex shrink-0 items-center gap-1">
            {/* Le voyant porte l'état, le nombre en attente et la navigation
                vers l'écran d'envoi. */}
            <SyncBadge
              status={syncStatus}
              pending={pending}
              compact
              onClick={() => navigate({ name: 'queue' })}
            />
            <button
              type="button"
              onClick={() => navigate({ name: 'settings' })}
              aria-label="Réglages"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
            >
              <IconeReglages size={21} />
            </button>
          </div>
        }
      />

      <div className="flex-1 space-y-4 px-4 pb-4 pt-3">
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
          <>
            {/*
              Les quatre gestes du champ, à portée de pouce. « Où suis-je ? »
              répond par un nom, la carte par un dessin : les deux se calculent
              dans le téléphone, depuis les contours en cache, donc sans réseau.
            */}
            <div className="grid grid-cols-4 gap-2">
              <Tuile
                libelle="Où suis-je ?"
                icone={<IconeLocaliser />}
                chargement={localisation === 'recherche'}
                onClick={() => void ouLeSuisJe()}
              />
              <Tuile libelle="Carte" icone={<IconeCarte />} onClick={() => navigate({ name: 'carte' })} />
              <Tuile libelle="Stock" icone={<IconeStock />} onClick={() => navigate({ name: 'stock' })} />
              <Tuile
                libelle="Conseils"
                icone={<IconeConseil />}
                pastille={waiting}
                onClick={() => navigate({ name: 'recommendations' })}
              />
            </div>

            {messageLocalisation ? (
              <Banner tone={localisation === 'erreur' ? 'warning' : 'info'}>
                {messageLocalisation}
              </Banner>
            ) : null}

            <label className="relative block">
              <span className="sr-only">Rechercher une parcelle</span>
              <IconeRecherche size={19} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nom, numéro, culture, commune…"
                inputMode="search"
                autoCapitalize="none"
                className="pl-11 pr-11"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 active:bg-surface-2"
                >
                  <IconeFermer size={18} />
                </button>
              ) : null}
            </label>

            {cultures.liste.length > 1 ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                <Puce actif={culture === null} onClick={() => setCulture(null)}>
                  Toutes <span className="tabular-nums text-ink-3">{snapshot.parcels.length}</span>
                </Puce>
                {cultures.liste.map(([nom, nombre]) => (
                  <Puce key={nom} actif={culture === nom} onClick={() => setCulture(culture === nom ? null : nom)}>
                    <PointCulture nom={nom} />
                    <span className="max-w-[10rem] truncate">{nomCourtDeCulture(nom)}</span>
                    <span className="tabular-nums text-ink-3">{nombre}</span>
                  </Puce>
                ))}
                {cultures.sans > 0 ? (
                  <Puce actif={culture === SANS_CULTURE} onClick={() => setCulture(culture === SANS_CULTURE ? null : SANS_CULTURE)}>
                    Sans culture <span className="tabular-nums text-ink-3">{cultures.sans}</span>
                  </Puce>
                ) : null}
              </div>
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
            title={search || culture ? 'Aucun résultat' : 'Aucune parcelle'}
            description={
              search || culture
                ? 'Aucune parcelle ne correspond à cette recherche.'
                : 'Relevez votre première parcelle en marchant son contour.'
            }
          />
        ) : (
          <section>
            {search || culture ? (
              <p className="mb-2 px-1 text-[13px] text-ink-3">
                {parcels.length} parcelle{parcels.length > 1 ? 's' : ''} ·{' '}
                {formatAreaHa(parcels.reduce((somme, parcel) => somme + parcel.areaHa, 0))}
              </p>
            ) : null}
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {parcels.map((parcel) => (
                <li key={parcel.id}>
                  <LigneParcelle parcel={parcel} onClick={() => navigate({ name: 'parcel', parcelId: parcel.id })} />
                </li>
              ))}
            </ul>
          </section>
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
            <IconePlus size={20} />
            Rédiger une préconisation
          </Button>
        ) : (
          <Button full onClick={() => navigate({ name: 'new-parcel' })}>
            <IconePlus size={20} />
            Relever une parcelle
          </Button>
        )}
      </div>
    </div>
  );
}

/** Filtre « sans culture » : une valeur qu'aucun nom de culture ne peut prendre. */
const SANS_CULTURE = '\u0000sans-culture';

/**
 * Une parcelle dans la liste : le nom, la culture en clair et sa couleur, la
 * surface. Rien ne déborde : un nom ou une culture trop longs s'arrêtent sur
 * des points de suspension, la surface reste lisible.
 */
function LigneParcelle({ parcel, onClick }: { parcel: CachedParcel; onClick: () => void }) {
  const precisions = [
    nomDitLeNumero(parcel.name, parcel.internalNumber) ? null : parcel.internalNumber,
    parcel.lieuDit,
    parcel.commune,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{parcel.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-3">
          {parcel.cropName ? (
            <>
              <PointCulture nom={parcel.cropName} />
              <span className="truncate text-ink-2">{nomCourtDeCulture(parcel.cropName)}</span>
            </>
          ) : (
            <span className="truncate text-ble-600 dark:text-ble-400">Culture non renseignée</span>
          )}
          {precisions.length > 0 ? (
            <span className="shrink-0 truncate">· {precisions.join(' · ')}</span>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right font-semibold tabular-nums text-ink">
        {formatAreaHa(parcel.areaHa)}
      </span>
      <IconeSuite size={16} className="shrink-0 text-ink-3" />
    </button>
  );
}

function Tuile({
  libelle,
  icone,
  onClick,
  chargement = false,
  pastille = 0,
}: {
  libelle: string;
  icone: React.ReactNode;
  onClick: () => void;
  chargement?: boolean;
  pastille?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={chargement}
      className="relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface px-1 py-2.5 text-ink active:bg-surface-2 disabled:opacity-60"
    >
      <span className="text-accent-ink">{chargement ? <span className="block h-[22px] w-[22px] animate-spin rounded-full border-2 border-current border-t-transparent" /> : icone}</span>
      <span className="text-[12.5px] font-medium leading-tight">{libelle}</span>
      {pastille > 0 ? (
        <span className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ble-500 px-1 text-[11px] font-bold text-white">
          {pastille}
        </span>
      ) : null}
    </button>
  );
}

function Puce({
  actif,
  onClick,
  children,
}: {
  actif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium',
        actif ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-ink-2 active:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
