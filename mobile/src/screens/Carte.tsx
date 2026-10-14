import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AppContext } from '../App';
import type { Position } from '../lib/types';
import { dansLaParcelle, distanceMeters, formatAreaHa, formatDistance } from '../lib/geo';
import { GeolocationDenied, watchPosition } from '../lib/geolocation';
import {
  FOND_PLAN_DEFAUT,
  FOND_SATELLITE,
  STYLE_PARCELLE,
  STYLE_PARCELLE_CHOISIE,
  STYLE_POSITION,
  STYLE_PRECISION,
  ZOOM_MAX_CADRAGE,
  lignesDEtiquette,
} from '@commun/carte';
import { Badge, Banner, Card, Header, formatDateFr } from '../components/ui';

/**
 * Le parcellaire sur une carte.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LA MÊME CARTE QUE SUR LE SITE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Même bibliothèque (Leaflet), mêmes fonds de plan, mêmes couleurs de
 * parcelles — les constantes viennent du terrain commun, partagées avec
 * `src/components/map/`. Une carte « pour le mobile » dessinée autrement
 * aurait obligé l'exploitant à reconnaître ses pièces deux fois, d'un écran à
 * l'autre.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CE QUI CHANGE AU CHAMP, ET POURQUOI
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Le fond de plan demande du réseau. Au milieu d'une parcelle, il n'y en a
 * souvent pas — et c'est précisément là qu'on ouvre la carte. **Les contours,
 * eux, viennent du cache local** : ils s'affichent toujours, avec ou sans
 * réseau, et l'écran dit franchement quand le fond manque au lieu de laisser
 * chercher pourquoi l'image n'arrive pas.
 *
 * On ne recadre pas sur la parcelle désignée, contrairement au site : là-bas
 * la sélection vient d'une liste, et recentrer aide ; ici elle vient du doigt
 * posé sur la carte, et bouger la vue sous le doigt désoriente.
 */

type Fond = 'plan' | 'satellite';

/** Géométrie GeoJSON telle que Leaflet l'attend. */
type GeometrieLeaflet = Parameters<typeof L.geoJSON>[0];

export function CarteScreen({ context }: { context: AppContext }) {
  const { snapshot, online, navigate, back } = context;

  const conteneur = useRef<HTMLDivElement | null>(null);
  const carte = useRef<L.Map | null>(null);
  const fonds = useRef<Record<Fond, L.TileLayer> | null>(null);
  const couches = useRef<Map<string, L.GeoJSON>>(new Map());
  const repere = useRef<{ point: L.CircleMarker; precision: L.Circle } | null>(null);

  const [fond, setFond] = useState<Fond>('satellite');
  const [selection, setSelection] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [erreurGps, setErreurGps] = useState<string | null>(null);
  const [fondManquant, setFondManquant] = useState(false);

  // Le clic sur une parcelle est posé une fois pour toutes sur la couche
  // Leaflet ; il doit pourtant appeler la navigation la plus récente. Sans
  // cette référence, il appellerait celle du premier rendu.
  const choisir = useRef<(parcelId: string) => void>(() => {});
  choisir.current = (parcelId: string) => setSelection(parcelId);

  const avecContour = useMemo(
    () => (snapshot?.parcels ?? []).filter((parcel) => parcel.geometry !== null),
    [snapshot],
  );
  const sansContour = useMemo(
    () => (snapshot?.parcels ?? []).filter((parcel) => parcel.geometry === null),
    [snapshot],
  );

  /**
   * Fond « plan » : celui que l'instance configure, sinon le repli.
   *
   * Gardé dans une référence parce que la carte est créée une seule fois,
   * avant que l'instantané ne soit forcément là. Un effet plus bas repose
   * l'adresse si elle change — sans quoi l'appareil resterait sur le repli
   * jusqu'à la prochaine réinstallation.
   */
  const fondPlan = {
    url: snapshot?.carte?.tileUrl ?? FOND_PLAN_DEFAUT.url,
    attribution: snapshot?.carte?.attribution ?? FOND_PLAN_DEFAUT.attribution,
  };
  const fondPlanRef = useRef(fondPlan);
  fondPlanRef.current = fondPlan;

  // --- La carte, créée une fois -------------------------------------------
  useEffect(() => {
    if (!conteneur.current || carte.current) return;

    const map = L.map(conteneur.current, {
      // France, en attendant le cadrage sur les parcelles : une carte qui
      // s'ouvre sur l'île de Null au large de l'Afrique a l'air cassée.
      center: [46.6, 2.4],
      zoom: 6,
      zoomControl: false,
      /*
       * L'attribution est affichée **sous** la carte, et non dedans.
       *
       * Sur 390 points de large, celle d'Esri tient sur deux lignes et passait
       * par-dessus la barre d'échelle, qui devenait illisible. La licence
       * exige que l'attribution soit visible, pas qu'elle soit dans le cadre :
       * elle est donc rendue juste en dessous, où elle tient.
       */
      attributionControl: false,
    });
    carte.current = map;

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // Échelle métrique seule : personne ne mesure un champ en miles.
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

    const construits: Record<Fond, L.TileLayer> = {
      plan: L.tileLayer(fondPlanRef.current.url, {
        attribution: fondPlanRef.current.attribution,
        maxZoom: FOND_PLAN_DEFAUT.maxZoom,
      }),
      satellite: L.tileLayer(FOND_SATELLITE.url, {
        attribution: FOND_SATELLITE.attribution,
        maxZoom: FOND_SATELLITE.maxZoom,
      }),
    };
    fonds.current = construits;

    // Une tuile qui n'arrive pas n'est pas une panne : c'est l'ordinaire au
    // champ. On le dit, plutôt que de laisser un damier gris inexpliqué.
    for (const couche of Object.values(construits)) {
      couche.on('tileerror', () => setFondManquant(true));
      couche.on('tileload', () => setFondManquant(false));
    }

    construits.satellite.addTo(map);

    // Leaflet mesure son conteneur à la création ; dans une pile d'écrans, la
    // mise en page n'est pas toujours finie à cet instant, et la carte se
    // retrouve haute de zéro pixel.
    const mesurer = window.setTimeout(() => map.invalidateSize(), 60);

    return () => {
      window.clearTimeout(mesurer);
      map.remove();
      carte.current = null;
      fonds.current = null;
      couches.current.clear();
      repere.current = null;
    };
    // Les fonds sont construits une seule fois : changer d'instance de carte à
    // chaque rafraîchissement d'instantané ferait clignoter l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Fond affiché --------------------------------------------------------
  useEffect(() => {
    const map = carte.current;
    const construits = fonds.current;
    if (!map || !construits) return;

    setFondManquant(false);
    for (const cle of ['plan', 'satellite'] as const) {
      if (cle === fond) {
        if (!map.hasLayer(construits[cle])) construits[cle].addTo(map);
      } else if (map.hasLayer(construits[cle])) {
        map.removeLayer(construits[cle]);
      }
    }
  }, [fond]);

  // L'instantané est arrivé après la création de la carte, ou l'instance a
  // changé de fournisseur : on repose l'adresse plutôt que de rester sur le
  // repli jusqu'à la prochaine réinstallation.
  useEffect(() => {
    const construits = fonds.current;
    if (!construits) return;
    if (construits.plan.options.attribution !== fondPlan.attribution) {
      construits.plan.options.attribution = fondPlan.attribution;
    }
    construits.plan.setUrl(fondPlan.url);
  }, [fondPlan.url, fondPlan.attribution]);

  // --- Les parcelles -------------------------------------------------------
  useEffect(() => {
    const map = carte.current;
    if (!map) return;

    for (const couche of couches.current.values()) couche.remove();
    couches.current.clear();

    const ensemble = L.featureGroup();

    for (const parcel of avecContour) {
      const couche = L.geoJSON(parcel.geometry as unknown as GeometrieLeaflet, {
        style: STYLE_PARCELLE,
      });

      /*
       * Pas d'infobulle, contrairement au site.
       *
       * Une infobulle s'ouvre au survol, et un doigt ne survole pas : au
       * premier appui elle s'ouvre et reste, posée en travers des parcelles
       * voisines qu'on cherchait justement à comparer. Vu à l'écran.
       *
       * Le même libellé s'affiche sous la carte, dans la fiche de la parcelle
       * désignée — plus lisible au soleil, et à portée du pouce.
       */
      couche.on('click', () => choisir.current(parcel.id));
      couche.addTo(map);
      ensemble.addLayer(couche);
      couches.current.set(parcel.id, couche);
    }

    if (avecContour.length > 0) {
      const limites = ensemble.getBounds();
      if (limites.isValid()) {
        map.fitBounds(limites, { padding: [24, 24], maxZoom: ZOOM_MAX_CADRAGE });
      }
    }
  }, [avecContour]);

  // --- La parcelle désignée ------------------------------------------------
  useEffect(() => {
    for (const [id, couche] of couches.current) {
      couche.setStyle(id === selection ? STYLE_PARCELLE_CHOISIE : STYLE_PARCELLE);
      if (id === selection) couche.bringToFront();
    }
  }, [selection]);

  // --- Position de l'appareil ---------------------------------------------
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

  useEffect(() => {
    const map = carte.current;
    if (!map || !position) return;

    const centre: L.LatLngExpression = [position.lat, position.lng];
    // Le cercle de précision est dessiné parce qu'il existe : annoncer une
    // position au mètre quand le GPS en annonce quinze ferait saisir sur la
    // parcelle voisine.
    const rayon = position.accuracy ?? 0;

    if (!repere.current) {
      // `interactive: false` : le repère et son cercle de précision ne doivent
      // pas intercepter l'appui. Sinon, debout dans sa parcelle — le cas
      // ordinaire —, on tape sur son propre point et rien ne s'ouvre.
      repere.current = {
        precision: L.circle(centre, {
          ...STYLE_PRECISION,
          radius: rayon,
          interactive: false,
        }).addTo(map),
        point: L.circleMarker(centre, { ...STYLE_POSITION, interactive: false }).addTo(
          map,
        ),
      };
    } else {
      repere.current.precision.setLatLng(centre).setRadius(rayon);
      repere.current.point.setLatLng(centre);
    }
    repere.current.point.bringToFront();
  }, [position]);

  function centrerSurMoi(): void {
    const map = carte.current;
    if (!map || !position) return;
    // L'échelle est conservée : changer la vue et le zoom d'un coup fait
    // perdre le fil de ce qu'on regardait.
    map.panTo([position.lat, position.lng]);
  }

  function toutVoir(): void {
    const map = carte.current;
    if (!map || couches.current.size === 0) return;
    const ensemble = L.featureGroup([...couches.current.values()]);
    const limites = ensemble.getBounds();
    if (limites.isValid()) {
      map.fitBounds(limites, { padding: [24, 24], maxZoom: ZOOM_MAX_CADRAGE });
    }
  }

  const parcelleChoisie = selection
    ? ((snapshot?.parcels ?? []).find((parcel) => parcel.id === selection) ?? null)
    : null;

  /**
   * Distance jusqu'à la parcelle désignée.
   *
   * Indicative, et dite comme telle : elle part du centre de la parcelle et non
   * de son bord. C'est un ordre de grandeur pour se repérer — « c'est celle
   * d'à côté » —, jamais une mesure.
   */
  const distanceChoisie = useMemo(() => {
    if (!position || !parcelleChoisie) return null;
    // Debout dedans, la distance n'a rien à dire — et « à environ 0 m de
    // vous » se lit comme une panne. Le bandeau au-dessus annonce déjà qu'on
    // y est.
    if (dansLaParcelle(position, parcelleChoisie.geometry)) return null;
    const couche = couches.current.get(parcelleChoisie.id);
    const centre = couche?.getBounds().getCenter();
    return centre
      ? distanceMeters(position, { lat: centre.lat, lng: centre.lng })
      : null;
  }, [position, parcelleChoisie]);

  const dansLaquelle = useMemo(() => {
    if (!position) return null;
    return (
      avecContour.find((parcel) => dansLaParcelle(position, parcel.geometry)) ?? null
    );
  }, [position, avecContour]);

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      <Header
        title="Carte du parcellaire"
        subtitle={
          avecContour.length > 0
            ? `${avecContour.length} parcelle(s) avec contour`
            : 'Aucun contour relevé'
        }
        onBack={back}
        action={
          <button
            type="button"
            onClick={toutVoir}
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
        }
      />

      <div className="flex-1 space-y-3 px-4 py-4">
        {erreurGps ? <Banner tone="warning">{erreurGps}</Banner> : null}

        {avecContour.length === 0 ? (
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
            <div className="relative isolate">
              {/* Le choix du fond, posé sur la carte comme sur le site. */}
              <div className="absolute right-2.5 top-2.5 z-[500] flex rounded-lg border border-line bg-surface p-0.5 shadow-sm">
                {(['satellite', 'plan'] as const).map((cle) => (
                  <button
                    key={cle}
                    type="button"
                    onClick={() => setFond(cle)}
                    className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${
                      fond === cle ? 'bg-champ-600 text-white' : 'text-ink-2'
                    }`}
                  >
                    {cle === 'satellite' ? 'Satellite' : 'Plan'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={centrerSurMoi}
                disabled={!position}
                aria-label="Centrer sur ma position"
                className="absolute left-2.5 top-2.5 z-[500] flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 shadow-sm active:bg-surface-2 disabled:opacity-40"
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

              <div
                ref={conteneur}
                className="h-[58vh] w-full min-w-0 overflow-hidden rounded-2xl border border-line"
              />
            </div>

            {/*
              Attribution du fond affiché. Elle suit le fond : passer au plan
              ne doit pas laisser l'imagerie créditée à sa place.

              Rendue en HTML parce qu'elle porte le lien vers la licence du
              fournisseur, et que c'est ainsi que Leaflet la pose sur le site.
              Les deux sources sont de confiance : une constante du dépôt pour
              le satellite, et `MAP_TILE_ATTRIBUTION` — un réglage de
              l'instance — pour le plan. Aucune saisie d'utilisateur n'arrive
              ici.
            */}
            <p
              className="px-1 text-[11px] leading-snug text-ink-3"
              dangerouslySetInnerHTML={{
                __html:
                  fond === 'satellite'
                    ? FOND_SATELLITE.attribution
                    : fondPlan.attribution,
              }}
            />

            {fondManquant || !online ? (
              <div className="rounded-xl border border-ble-500/40 bg-ble-500/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ble-600 dark:text-ble-400">
                Fond de plan indisponible — il demande du réseau. Vos contours,
                eux, viennent du cache de l’appareil et restent affichés.
              </div>
            ) : null}

            {dansLaquelle ? (
              <button
                type="button"
                onClick={() => setSelection(dansLaquelle.id)}
                className="w-full rounded-xl border border-champ-500/40 bg-champ-500/10 px-3.5 py-2.5 text-left text-[13.5px] text-champ-600 active:bg-champ-500/20 dark:text-champ-400"
              >
                {/* Espaces insécables : le guillemet fermant ne doit pas
                    partir seul à la ligne suivante, comme il le faisait sur
                    un nom un peu long. */}
                Vous êtes dans «&nbsp;{dansLaquelle.name}&nbsp;».
              </button>
            ) : null}

            {parcelleChoisie ? (
              <Card onClick={() => navigate({ name: 'parcel', parcelId: parcelleChoisie.id })}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/*
                      Le libellé vient du terrain commun : une parcelle se
                      nomme de la même façon ici et dans l'infobulle du site.
                    */}
                    <p className="truncate font-semibold text-ink">
                      {lignesDEtiquette({
                        name: parcelleChoisie.name,
                        internalNumber: parcelleChoisie.internalNumber,
                        commune: parcelleChoisie.commune,
                        areaHa: parcelleChoisie.areaHa,
                        cropName: parcelleChoisie.cropName,
                      })[0]}
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {[
                        formatAreaHa(parcelleChoisie.areaHa),
                        parcelleChoisie.lieuDit,
                        parcelleChoisie.commune,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {distanceChoisie !== null ? (
                      <p className="mt-0.5 text-[12px] text-ink-3">
                        À environ {formatDistance(distanceChoisie)} de vous (depuis
                        son centre)
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-[12px] font-medium text-accent-ink">
                      Ouvrir la fiche pour renommer ou saisir une intervention →
                    </p>
                  </div>
                  {parcelleChoisie.cropName ? (
                    <Badge tone="green">{parcelleChoisie.cropName}</Badge>
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
          L'attribution du fond, elle, est posée par Leaflet dans le coin de la
          carte, comme la licence du fournisseur l'exige.
        */}
        <p className="px-1 text-[12px] leading-relaxed text-ink-3">
          Contours issus de votre parcellaire Parcelys, tel que synchronisé
          {snapshot ? ` le ${formatDateFr(snapshot.syncedAt)}` : ''}. Les
          superficies affichées sont celles calculées par PostGIS à
          l’enregistrement. Les positions sont celles du GPS de l’appareil, avec
          sa précision annoncée.
        </p>
      </div>
    </div>
  );
}

