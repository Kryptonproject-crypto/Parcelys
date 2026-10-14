import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppContext } from '../App';
import type { CachedParcel, Position } from '../lib/types';
import { dansLaParcelle, formatAreaHa, formatDistance, distanceMeters } from '../lib/geo';
import { GeolocationDenied, watchPosition } from '../lib/geolocation';
import {
  ajusterAuCadre,
  anneauxDeGeometrie,
  barreDEchelle,
  cadreDUnPoint,
  cadreDesGeometries,
  centroideSurfacique,
  creerProjection,
  deplacer,
  etiquetteAjustee,
  METRES_PAR_DEGRE_LAT,
  zoomer,
  type AnneauxPolygone,
  type Projection,
} from '@commun/carte';
import { Badge, Banner, Card, Header, formatDateFr } from '../components/ui';

/**
 * Le parcellaire sur une carte.
 *
 * Dessinée depuis les contours déjà présents dans l'instantané local : elle
 * s'ouvre donc au milieu d'un champ, sans réseau, ce qui est le seul moment où
 * l'on en a vraiment besoin. Aucune tuile n'est téléchargée — il n'y a pas de
 * fond de plan, et l'écran le dit plutôt que de laisser chercher pourquoi la
 * photo aérienne n'arrive pas.
 *
 * Les maths — projection, cadrage, zoom, étiquettes — vivent dans
 * `@commun/carte`, où elles sont testées. Ce fichier ne fait que les gestes et
 * le dessin : c'est la partie qu'un test de la racine ne peut pas atteindre, et
 * elle doit donc rester la plus mince possible.
 */

/** Ce qu'il faut savoir d'une parcelle pour la dessiner. */
type ParcelleDessinable = {
  parcel: CachedParcel;
  anneaux: AnneauxPolygone[];
};

/** Bornes de zoom : de la bande enherbée à la petite région. */
const SPAN_MIN_LAT = 40 / METRES_PAR_DEGRE_LAT;
const SPAN_MAX_LAT = 60_000 / METRES_PAR_DEGRE_LAT;

/** Au-delà de ce diamètre à l'écran, la parcelle porte son nom. */
const TAILLE_MIN_ETIQUETTE = 54;

/**
 * Largeur moyenne d'un caractère à 11 px, en gras.
 *
 * Estimée, et volontairement un peu large : surévaluer rogne un nom qui aurait
 * tenu de justesse, sous-évaluer le laisse déborder sur la parcelle voisine.
 * Des deux erreurs, la première se voit moins.
 */
const LARGEUR_CARACTERE = 6.2;

/** Déplacement du doigt toléré pour que l'on considère un geste comme un appui. */
const TOLERANCE_APPUI = 10;

function cheminDe(anneaux: AnneauxPolygone[], projection: Projection): string {
  const segments: string[] = [];
  for (const { contour, trous } of anneaux) {
    for (const anneau of [contour, ...trous]) {
      const points = anneau.map(([lng, lat]) => projection.versVue({ lat, lng }));
      const premier = points[0];
      if (!premier) continue;
      segments.push(
        `M${premier.x.toFixed(1)} ${premier.y.toFixed(1)}` +
          points
            .slice(1)
            .map((point) => `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
            .join('') +
          'Z',
      );
    }
  }
  return segments.join(' ');
}

/** Encombrement à l'écran, pour décider si le nom tient dedans. */
function etendueEcran(
  anneaux: AnneauxPolygone[],
  projection: Projection,
): { largeur: number; hauteur: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { contour } of anneaux) {
    for (const [lng, lat] of contour) {
      const { x, y } = projection.versVue({ lat, lng });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { largeur: 0, hauteur: 0 };
  return { largeur: maxX - minX, hauteur: maxY - minY };
}

export function CarteScreen({ context }: { context: AppContext }) {
  const { snapshot, navigate, back } = context;

  const conteneur = useRef<HTMLDivElement | null>(null);
  const [vue, setVue] = useState<{ largeur: number; hauteur: number } | null>(null);
  const [cadrage, setCadrage] = useState<{
    centre: { lat: number; lng: number };
    spanLat: number;
  } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [erreurGps, setErreurGps] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);

  // --- Les parcelles qui ont un contour, et celles qui n'en ont pas ---------
  const dessinables = useMemo<ParcelleDessinable[]>(
    () =>
      (snapshot?.parcels ?? [])
        .map((parcel) => ({ parcel, anneaux: anneauxDeGeometrie(parcel.geometry) }))
        .filter(({ anneaux }) => anneaux.length > 0),
    [snapshot],
  );

  const sansContour = useMemo(
    () =>
      (snapshot?.parcels ?? []).filter(
        (parcel) => anneauxDeGeometrie(parcel.geometry).length === 0,
      ),
    [snapshot],
  );

  const cadreParcellaire = useMemo(
    () => cadreDesGeometries(dessinables.map(({ parcel }) => parcel.geometry)),
    [dessinables],
  );

  // --- Mesure de la vue ----------------------------------------------------
  useEffect(() => {
    const element = conteneur.current;
    if (!element) return;

    const mesurer = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setVue({ largeur: rect.width, hauteur: rect.height });
      }
    };
    mesurer();

    // Rotation du téléphone, apparition du clavier : la vue change de format,
    // et une projection calculée pour l'ancien cadrerait de travers.
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(element);
    return () => observateur.disconnect();
  }, []);

  // Premier cadrage : tout le parcellaire. On ne le refait pas à chaque rendu,
  // sinon le moindre déplacement serait aussitôt annulé.
  const dejaCadre = useRef<string | null>(null);
  useEffect(() => {
    const cle = snapshot?.farm.id ?? null;
    if (!vue || !cadreParcellaire || dejaCadre.current === cle) return;
    dejaCadre.current = cle;
    setCadrage(ajusterAuCadre(cadreParcellaire, vue));
  }, [vue, cadreParcellaire, snapshot?.farm.id]);

  // --- Position de l'opérateur --------------------------------------------
  useEffect(() => {
    let arreter: (() => void) | null = null;
    let abandonne = false;

    void (async () => {
      try {
        const stop = await watchPosition(
          (point) => setPosition(point),
          (message) => setErreurGps(message),
        );
        if (abandonne) stop();
        else arreter = stop;
      } catch (cause) {
        setErreurGps(
          cause instanceof GeolocationDenied
            ? cause.message
            : 'Position indisponible pour l’instant.',
        );
      }
    })();

    // Le suivi doit s'arrêter avec l'écran : laissé actif, il vide la batterie.
    return () => {
      abandonne = true;
      arreter?.();
    };
  }, []);

  const projection = useMemo(
    () => (vue && cadrage ? creerProjection({ ...cadrage, vue }) : null),
    [vue, cadrage],
  );

  // --- Gestes --------------------------------------------------------------
  const doigts = useRef(new Map<number, { x: number; y: number }>());
  const geste = useRef<{
    dernier: { x: number; y: number } | null;
    ecart: number | null;
    parcouru: number;
  }>({ dernier: null, ecart: null, parcouru: 0 });

  // La projection est lue dans les gestionnaires de geste, qui ne sont pas
  // réinstallés à chaque rendu : on la garde dans une référence pour éviter de
  // déplacer la carte d'après un cadrage périmé.
  const projectionRef = useRef<Projection | null>(null);
  projectionRef.current = projection;

  const coordonnees = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = conteneur.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  /**
   * Le geste vise-t-il la carte, ou une commande posée dessus ?
   *
   * Les boutons de zoom et de recentrage flottent au-dessus de la carte, donc
   * à l'intérieur de la zone qui écoute les gestes. Capturer le pointeur sur
   * cette zone détourne les évènements suivants et le bouton ne reçoit jamais
   * son clic : il paraît présent et ne fait rien. Vérifié en pilotant
   * l'application — le dessin ne bougeait pas d'un pixel.
   */
  const viseLaCarte = (event: React.PointerEvent): boolean =>
    !(event.target instanceof Element && event.target.closest('button'));

  function surPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!viseLaCarte(event)) return;
    doigts.current.set(event.pointerId, coordonnees(event));
    geste.current = {
      dernier: doigts.current.size === 1 ? coordonnees(event) : null,
      ecart: null,
      parcouru: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function surPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (!doigts.current.has(event.pointerId)) return;
    const projectionActuelle = projectionRef.current;
    if (!projectionActuelle) return;

    const point = coordonnees(event);
    doigts.current.set(event.pointerId, point);
    const points = [...doigts.current.values()];

    if (points.length >= 2) {
      const [a, b] = points;
      if (!a || !b) return;
      const ecart = Math.hypot(b.x - a.x, b.y - a.y);
      const precedent = geste.current.ecart;
      geste.current = { dernier: null, ecart, parcouru: TOLERANCE_APPUI + 1 };
      if (precedent && precedent > 0 && ecart > 0) {
        setCadrage(
          zoomer(
            projectionActuelle,
            { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            ecart / precedent,
            { spanMinLat: SPAN_MIN_LAT, spanMaxLat: SPAN_MAX_LAT },
          ),
        );
      }
      return;
    }

    const dernier = geste.current.dernier;
    if (!dernier) return;
    const dx = point.x - dernier.x;
    const dy = point.y - dernier.y;
    geste.current = {
      dernier: point,
      ecart: null,
      parcouru: geste.current.parcouru + Math.hypot(dx, dy),
    };
    setCadrage(deplacer(projectionActuelle, dx, dy));
  }

  function surPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    const point = doigts.current.get(event.pointerId);
    doigts.current.delete(event.pointerId);
    const projectionActuelle = projectionRef.current;

    // Un appui, et non un déplacement : on désigne une parcelle. Sans ce seuil,
    // le moindre tremblement de la main pendant un déplacement ouvrirait une
    // parcelle au relâchement.
    if (
      point &&
      projectionActuelle &&
      doigts.current.size === 0 &&
      geste.current.parcouru <= TOLERANCE_APPUI
    ) {
      const geo = projectionActuelle.versGeo(point.x, point.y);
      // Du dessus vers le dessous : c'est la dernière dessinée qu'on voit.
      const touchee = [...dessinables]
        .reverse()
        .find(({ parcel }) => dansLaParcelle(geo, parcel.geometry));
      setSelection(touchee ? touchee.parcel.id : null);
    }

    geste.current = { dernier: null, ecart: null, parcouru: 0 };
  }

  function zoomerDepuisBouton(facteur: number): void {
    if (!projection) return;
    setCadrage(
      zoomer(
        projection,
        { x: projection.vue.largeur / 2, y: projection.vue.hauteur / 2 },
        facteur,
        { spanMinLat: SPAN_MIN_LAT, spanMaxLat: SPAN_MAX_LAT },
      ),
    );
  }

  function centrerSurMoi(): void {
    if (!position || !vue) return;
    // On garde l'échelle courante et on se contente de recentrer : changer les
    // deux à la fois fait perdre le fil de ce qu'on regardait.
    setCadrage((precedent) => ({
      centre: { lat: position.lat, lng: position.lng },
      spanLat: precedent?.spanLat ?? ajusterAuCadre(cadreDUnPoint(position), vue).spanLat,
    }));
  }

  /**
   * Revenir à l'ensemble du parcellaire.
   *
   * Le parcellaire seul, et non « le parcellaire et moi » : la première
   * version englobait la position, et un relevé GPS pris à cent kilomètres —
   * ou simplement aberrant — réduisait les parcelles à trois pixels. Le bouton
   * dit « tout voir » et doit toujours montrer la même chose, quoi qu'annonce
   * le GPS. Se retrouver soi-même est le rôle du bouton d'à côté.
   */
  function toutVoirLeParcellaire(): void {
    if (!vue || !cadreParcellaire) return;
    setCadrage(ajusterAuCadre(cadreParcellaire, vue));
  }

  const echelle = projection
    ? barreDEchelle(projection.metresParUnite, Math.min(140, projection.vue.largeur - 48))
    : null;

  const parcelleSelectionnee = selection
    ? (snapshot?.parcels.find((parcel) => parcel.id === selection) ?? null)
    : null;

  /**
   * Distance jusqu'à la parcelle désignée.
   *
   * Indicative, et dite comme telle : elle part du centre de la parcelle, pas
   * de son bord. C'est un ordre de grandeur pour se repérer — « c'est celle
   * d'à côté », « c'est celle du fond » —, jamais une mesure.
   */
  const distanceSelection = useMemo(() => {
    if (!position || !parcelleSelectionnee) return null;
    const centre = centroideSurfacique(anneauxDeGeometrie(parcelleSelectionnee.geometry));
    return centre ? distanceMeters(position, centre) : null;
  }, [position, parcelleSelectionnee]);

  const dansLaquelle = useMemo(() => {
    if (!position) return null;
    return (
      dessinables.find(({ parcel }) => dansLaParcelle(position, parcel.geometry))
        ?.parcel ?? null
    );
  }, [position, dessinables]);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Carte du parcellaire"
        subtitle={
          dessinables.length > 0
            ? `${dessinables.length} parcelle(s) avec contour`
            : 'Aucun contour relevé'
        }
        onBack={back}
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toutVoirLeParcellaire}
              aria-label="Tout voir"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 active:bg-surface-2"
            >
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        }
      />

      <div className="flex-1 space-y-3 px-4 py-4">
        {erreurGps ? <Banner tone="warning">{erreurGps}</Banner> : null}

        {dessinables.length === 0 ? (
          <Card>
            <h2 className="font-semibold text-ink">Rien à cartographier pour l’instant</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
              Aucune de vos parcelles n’a de contour enregistré. Un contour arrive
              soit d’un import de votre déclaration PAC, soit d’un relevé fait au
              GPS en marchant le tour de la parcelle.
            </p>
          </Card>
        ) : (
          <>
            <div
              ref={conteneur}
              onPointerDown={surPointerDown}
              onPointerMove={surPointerMove}
              onPointerUp={surPointerUp}
              onPointerCancel={surPointerUp}
              className="relative h-[62vh] w-full touch-none select-none overflow-hidden rounded-2xl border border-line bg-surface-2"
            >
              {projection ? (
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${projection.vue.largeur} ${projection.vue.hauteur}`}
                  role="img"
                  aria-label={`Carte de ${dessinables.length} parcelle(s)`}
                >
                  {dessinables.map(({ parcel, anneaux }) => {
                    const choisie = parcel.id === selection;
                    return (
                      <path
                        key={parcel.id}
                        d={cheminDe(anneaux, projection)}
                        // Les trous doivent rester des trous : un bosquet au
                        // milieu d'une parcelle n'est pas de la parcelle.
                        fillRule="evenodd"
                        fill={
                          choisie ? 'var(--color-ble-500)' : 'var(--color-champ-500)'
                        }
                        fillOpacity={choisie ? 0.38 : 0.2}
                        stroke={
                          choisie ? 'var(--color-ble-600)' : 'var(--color-champ-600)'
                        }
                        strokeWidth={choisie ? 2.4 : 1.4}
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}

                  {/* Les noms par-dessus les contours, et seulement quand la
                      parcelle est assez grande à l'écran pour les porter :
                      superposés, ils ne se lisent plus et masquent le dessin. */}
                  {dessinables.map(({ parcel, anneaux }) => {
                    const etendue = etendueEcran(anneaux, projection);
                    if (Math.min(etendue.largeur, etendue.hauteur) < TAILLE_MIN_ETIQUETTE) {
                      return null;
                    }
                    const centre = centroideSurfacique(anneaux);
                    if (!centre) return null;

                    // Rogné à la largeur de la parcelle : écrit en entier, un
                    // nom long déborde sur la voisine et ne désigne plus rien.
                    const libelle = etiquetteAjustee(
                      parcel.name,
                      etendue.largeur - 8,
                      LARGEUR_CARACTERE,
                    );
                    if (!libelle) return null;

                    const { x, y } = projection.versVue(centre);

                    // Le repère de position se pose au même endroit quand on
                    // est au milieu de sa parcelle, et le nom devient illisible
                    // (« Les ● bles »). On descend alors l'étiquette : la
                    // position prime, c'est elle qu'on cherche des yeux.
                    const repere = position ? projection.versVue(position) : null;
                    const gene =
                      repere !== null &&
                      Math.abs(repere.x - x) < etendue.largeur / 2 &&
                      Math.abs(repere.y - y) < 12;

                    return (
                      <text
                        key={`nom-${parcel.id}`}
                        x={x}
                        y={gene ? y + 18 : y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-ink text-[11px] font-semibold"
                        stroke="var(--color-surface)"
                        strokeWidth="3"
                        paintOrder="stroke"
                      >
                        {libelle}
                      </text>
                    );
                  })}

                  {position
                    ? (() => {
                        const { x, y } = projection.versVue(position);
                        const rayon =
                          position.accuracy !== undefined
                            ? position.accuracy / projection.metresParUnite
                            : null;
                        return (
                          <g>
                            {/* Le cercle de précision est dessiné parce qu'il
                                existe : annoncer une position au mètre quand le
                                GPS annonce ±15 m ferait saisir sur la voisine. */}
                            {rayon && rayon > 2 ? (
                              <circle
                                cx={x}
                                cy={y}
                                r={rayon}
                                fill="var(--color-ciel-500)"
                                fillOpacity="0.14"
                                stroke="var(--color-ciel-500)"
                                strokeOpacity="0.5"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                              />
                            ) : null}
                            <circle
                              cx={x}
                              cy={y}
                              r="6"
                              fill="var(--color-ciel-500)"
                              stroke="var(--color-surface)"
                              strokeWidth="2.5"
                              vectorEffect="non-scaling-stroke"
                            />
                          </g>
                        );
                      })()
                    : null}
                </svg>
              ) : null}

              {/* Nord : sans lui, une carte sans fond de plan ne dit pas dans
                  quel sens on la regarde. Elle est toujours orientée au nord —
                  la projection ne tourne pas —, et c'est ce que dit la flèche. */}
              <div
                aria-hidden
                className="pointer-events-none absolute right-2.5 top-2.5 flex flex-col items-center text-ink-3"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3l4 9h-8l4-9z"
                    fill="currentColor"
                  />
                  <path
                    d="M12 12v9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="text-[10px] font-bold leading-none">N</span>
              </div>

              {echelle ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute bottom-2.5 left-2.5 text-ink-2"
                >
                  <div
                    className="h-2 border-x-2 border-b-2 border-current"
                    style={{ width: `${echelle.unites}px` }}
                  />
                  <span className="text-[11px] font-semibold tabular-nums">
                    {echelle.libelle}
                  </span>
                </div>
              ) : null}

              <div className="absolute bottom-2.5 right-2.5 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => zoomerDepuisBouton(1.6)}
                  aria-label="Zoomer"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/95 text-[19px] font-semibold text-ink-2 active:bg-surface-2"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => zoomerDepuisBouton(1 / 1.6)}
                  aria-label="Dézoomer"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/95 text-[19px] font-semibold text-ink-2 active:bg-surface-2"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={centrerSurMoi}
                  disabled={!position}
                  aria-label="Centrer sur ma position"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/95 text-ink-2 active:bg-surface-2 disabled:opacity-40"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                    <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.7" />
                    <path
                      d="M12 2v3M12 19v3M2 12h3M19 12h3"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {dansLaquelle ? (
              <button
                type="button"
                onClick={() => setSelection(dansLaquelle.id)}
                className="w-full rounded-xl border border-champ-500/40 bg-champ-500/10 px-3.5 py-2.5 text-left text-[13.5px] text-champ-600 active:bg-champ-500/20 dark:text-champ-400"
              >
                Vous êtes dans « {dansLaquelle.name} ».
              </button>
            ) : null}

            {parcelleSelectionnee ? (
              <Card onClick={() => navigate({ name: 'parcel', parcelId: selection! })}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">
                      {parcelleSelectionnee.name}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {[
                        formatAreaHa(parcelleSelectionnee.areaHa),
                        parcelleSelectionnee.internalNumber,
                        parcelleSelectionnee.lieuDit,
                        parcelleSelectionnee.commune,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {distanceSelection !== null ? (
                      <p className="mt-0.5 text-[12px] text-ink-3">
                        À environ {formatDistance(distanceSelection)} de vous (depuis
                        son centre)
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[12px] font-medium text-accent-ink">
                      Ouvrir la fiche pour renommer ou saisir une intervention →
                    </p>
                  </div>
                  {parcelleSelectionnee.cropName ? (
                    <Badge tone="green">{parcelleSelectionnee.cropName}</Badge>
                  ) : null}
                </div>
              </Card>
            ) : (
              <p className="px-1 text-[13px] text-ink-3">
                Touchez une parcelle pour l’ouvrir. Pincez pour zoomer, glissez
                pour vous déplacer.
              </p>
            )}
          </>
        )}

        {sansContour.length > 0 ? (
          <Card>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
              Sans contour — {sansContour.length}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
              Ces parcelles existent dans votre parcellaire mais n’ont pas de
              contour : elles ne peuvent pas être dessinées.
            </p>
            <ul className="mt-2 space-y-1.5">
              {sansContour.map((parcel) => (
                <li key={parcel.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ name: 'parcel', parcelId: parcel.id })}
                    className="w-full truncate rounded-lg px-1 py-1 text-left text-[13.5px] text-ink active:bg-surface-2"
                  >
                    {parcel.name}
                    <span className="text-ink-3">
                      {' · '}
                      {formatAreaHa(parcel.areaHa)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {/*
          Provenance de ce qui est affiché, et date de la dernière relève. Une
          carte est crue plus volontiers qu'un tableau : il faut qu'elle dise
          d'où elle vient et de quand elle date, surtout quand elle a été
          dessinée hors réseau d'après un instantané vieux de trois jours.
        */}
        <p className="px-1 text-[12px] leading-relaxed text-ink-3">
          Contours issus de votre parcellaire Parcelys, tel que synchronisé
          {snapshot ? ` le ${formatDateFr(snapshot.syncedAt)}` : ''}. Les
          superficies affichées sont celles calculées par PostGIS à
          l’enregistrement.
          <br />
          Aucun fond de plan : rien n’est téléchargé pour dessiner cette carte,
          elle fonctionne donc sans réseau. Les positions sont celles du GPS de
          l’appareil, avec sa précision annoncée.
        </p>
      </div>
    </div>
  );
}
