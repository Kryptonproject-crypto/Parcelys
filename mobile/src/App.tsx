import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network } from '@capacitor/network';
import { clearCache, clearOutbox, outboxCount, readSnapshot } from './lib/db';
import {
  clearSession,
  forgetLegacyServerUrl,
  loadActiveFarmId,
  loadSession,
  saveActiveFarmId,
  saveSession,
} from './lib/storage';
import { SERVER_URL } from './lib/config';
import { ApiError, fetchSnapshot, logout as apiLogout, OfflineError } from './lib/api';
import { actualiserRegistres, lireRegistres, type RegistresLocaux } from './lib/registres';
import { synchronize, type SyncReport } from './lib/sync';
import { syncStatusFrom, type SyncStatus } from '@commun/sync-status';
import { writeSnapshot } from './lib/db';
import { actualiserCouches, couchesAAfficher } from './lib/couches';
import type { CachedParcel, Session, Snapshot } from './lib/types';
import { LoginScreen } from './screens/Login';
import { ParcelsScreen } from './screens/Parcels';
import { CarteScreen } from './screens/Carte';
import { StockScreen } from './screens/Stock';
import { NewPurchaseScreen } from './screens/NewPurchase';
import { NewParcelScreen } from './screens/NewParcel';
import { ParcelScreen } from './screens/Parcel';
import { EntryScreen, type EntryKind } from './screens/Entry';
import { QueueScreen } from './screens/Queue';
import { SettingsScreen } from './screens/Settings';
import { SecurityScreen } from './screens/Security';
import { PortfolioScreen } from './screens/Portfolio';
import { RecommendationsScreen } from './screens/Recommendations';
import { RecommendationScreen } from './screens/Recommendation';
import { NewRecommendationScreen } from './screens/NewRecommendation';
import { AideScreen } from './screens/Aide';
import { ContactScreen } from './screens/Contact';
import { DemandeScreen, DemandesScreen } from './screens/Demandes';

/**
 * Coque de l'application.
 *
 * Navigation par état plutôt que par routeur : une dizaine d'écrans, aucune URL
 * à partager, aucun historique à restaurer. Un routeur ajouterait une
 * dépendance et un poids d'APK pour un besoin qui tient en une union de types.
 *
 * Deux métiers cohabitent. L'exploitant ouvre son parcellaire ; l'expert
 * agronomique ouvre son portefeuille, y choisit un domaine, et l'application
 * recharge alors l'instantané de ce domaine. C'est le serveur qui décide de
 * l'un ou l'autre — l'application ne fait qu'obéir à `accountType`.
 */

export type Screen =
  | { name: 'portfolio' }
  | { name: 'parcels' }
  | { name: 'carte' }
  | { name: 'new-parcel' }
  | { name: 'parcel'; parcelId: string }
  | { name: 'entry'; kind: EntryKind; parcelId: string }
  | { name: 'recommendations' }
  | { name: 'recommendation'; recommendationId: string }
  | { name: 'new-recommendation'; parcelId?: string }
  | { name: 'stock' }
  | { name: 'new-purchase' }
  | { name: 'queue' }
  | { name: 'settings' }
  | { name: 'security' }
  | { name: 'aide' }
  | { name: 'contact'; sujet?: string }
  | { name: 'demandes' }
  | { name: 'demande'; ticketId: string };

// `SyncStatus` vient du terrain commun : le voyant et son calcul vont ensemble.
export type { SyncStatus };

export type AppContext = {
  session: Session;
  snapshot: Snapshot | null;
  online: boolean;
  pending: number;
  /** Voyant de synchronisation, dérivé du réseau, de la file et du dernier envoi. */
  syncStatus: SyncStatus;
  /** Message du dernier échec, s'il y en a eu un. */
  syncError: string | null;
  /** Lance un envoi. Rend le compte rendu, ou lève si l'envoi a échoué. */
  runSync: () => Promise<SyncReport | null>;
  /** Exploitation ouverte ; `null` tant que rien n'a été téléchargé. */
  activeFarmId: string | null;
  /**
   * Registres des parcelles (cultures, apports, traitements, travaux,
   * historique) gardés sur l'appareil ; `null` tant qu'aucun n'a été reçu.
   */
  registres: RegistresLocaux | null;
  /** État de la dernière demande de registres au serveur. */
  registresEtat: { enCours: boolean; erreur: string | null };
  /** Redemande les registres au serveur (rien ne transite s'ils sont à jour). */
  actualiserRegistres: () => Promise<void>;
  /** `true` si le compte est un expert agronomique. */
  isExpert: boolean;
  /** `true` si l'exploitation ouverte est suivie et non détenue : lecture seule. */
  readOnly: boolean;
  refreshPending: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  /**
   * Renomme une parcelle dans l'instantané local, tout de suite.
   *
   * Le renommage part par la file d'attente comme toute saisie, et la file
   * peut attendre des heures avant de trouver du réseau. Sans cette écriture
   * locale, on renomme au champ et l'écran continue d'afficher « Îlot 39 —
   * parcelle 3 » : on croit que ça n'a pas marché, et on recommence.
   *
   * Ce que ce n'est pas : une vérité. Le serveur reste seul juge — il peut
   * refuser un numéro interne déjà pris —, et le prochain instantané écrase
   * cette valeur locale par la sienne.
   */
  renommerLocalement: (
    parcelId: string,
    valeurs: { name: string; internalNumber: string | null; lieuDit: string | null },
  ) => Promise<void>;
  selectFarm: (farmId: string) => Promise<void>;
  navigate: (screen: Screen) => void;
  back: () => void;
  logout: () => Promise<void>;
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [activeFarmId, setActiveFarmId] = useState<string | null>(null);
  const [stack, setStack] = useState<Screen[]>([{ name: 'parcels' }]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [registres, setRegistres] = useState<RegistresLocaux | null>(null);
  const [registresEtat, setRegistresEtat] = useState<{ enCours: boolean; erreur: string | null }>({
    enCours: false,
    erreur: null,
  });

  const isExpert = session?.accountType === 'AGRONOMIST';
  const homeScreen: Screen = isExpert ? { name: 'portfolio' } : { name: 'parcels' };

  // --- Démarrage : session et cache local, avant tout appel réseau ---------
  useEffect(() => {
    void (async () => {
      const [stored, cached, count, farmId] = await Promise.all([
        loadSession(),
        readSnapshot(),
        outboxCount(),
        loadActiveFarmId(),
      ]);
      // Une version antérieure laissait saisir l'adresse du serveur. Une
      // session gardée pour une autre instance porte un jeton que celle-ci ne
      // reconnaîtra pas : mieux vaut redemander la connexion tout de suite que
      // laisser l'application échouer à chaque appel sans dire pourquoi.
      const valide = stored && stored.serverUrl === SERVER_URL ? stored : null;
      if (stored && !valide) await clearSession();
      await forgetLegacyServerUrl();

      setSession(valide);
      setSnapshot(cached);
      setPending(count);
      setActiveFarmId(farmId ?? cached?.farm.id ?? null);
      // Les registres déjà reçus s'affichent tout de suite, réseau ou pas.
      setRegistres(await lireRegistres(cached?.farm.id));
      setStack([
        valide?.accountType === 'AGRONOMIST' ? { name: 'portfolio' } : { name: 'parcels' },
      ]);
      setBooting(false);
    })();
  }, []);

  // --- État du réseau ------------------------------------------------------
  useEffect(() => {
    let detach: (() => void) | undefined;

    void (async () => {
      const status = await Network.getStatus();
      setOnline(status.connected);
      const handle = await Network.addListener('networkStatusChange', (next) => {
        setOnline(next.connected);
      });
      detach = () => void handle.remove();
    })();

    return () => detach?.();
  }, []);

  const refreshPending = useCallback(async () => {
    setPending(await outboxCount());
  }, []);

  /**
   * Redemande les registres de `farmId`. En arrière-plan : ni l'instantané ni
   * la synchronisation ne l'attendent, et un échec laisse ceux d'avant — avec
   * un message qui dit pourquoi ils n'ont pas été rafraîchis.
   */
  const majRegistres = useCallback(
    async (farmId: string) => {
      if (!session) return;
      setRegistresEtat({ enCours: true, erreur: null });
      try {
        setRegistres(await actualiserRegistres(session, farmId));
        setRegistresEtat({ enCours: false, erreur: null });
      } catch (error) {
        setRegistresEtat({
          enCours: false,
          erreur:
            error instanceof OfflineError
              ? 'Hors réseau : registres de la dernière synchronisation.'
              : error instanceof ApiError && error.status === 404
                ? 'Le serveur ne fournit pas encore les registres : il doit être mis à jour.'
                : error instanceof Error
                  ? error.message
                  : 'Registres indisponibles.',
        });
      }
    },
    [session],
  );

  const refreshSnapshot = useCallback(async () => {
    if (!session) return;
    try {
      const fresh = await fetchSnapshot(session, activeFarmId);
      await writeSnapshot(fresh);
      setSnapshot(fresh);
      setActiveFarmId(fresh.farm.id);
      await saveActiveFarmId(fresh.farm.id);
      // Ceux de l'exploitation qu'on vient d'ouvrir, puis leur mise à jour.
      setRegistres(await lireRegistres(fresh.farm.id));
      void majRegistres(fresh.farm.id);
      // Les couches de la carte (cours d'eau d'abord), enregistrées pour être
      // affichées au champ, sans réseau. En arrière-plan : la synchronisation
      // ne les attend pas, et un échec laisse simplement les précédentes.
      void actualiserCouches(session, fresh.farm.id, couchesAAfficher).catch(() => undefined);
    } catch (error) {
      // Hors ligne : le cache précédent reste affiché, c'est tout l'intérêt.
      if (!(error instanceof OfflineError)) throw error;
    }
  }, [session, activeFarmId, majRegistres]);

  // Instantané rafraîchi à la connexion, puis à chaque retour du réseau.
  useEffect(() => {
    if (session && online) void refreshSnapshot();
  }, [session, online, refreshSnapshot]);

  /**
   * Envoi de la file, appelable de n'importe où.
   *
   * Remonté ici plutôt que laissé dans l'écran de la file : le voyant doit
   * pouvoir passer à l'orange pendant l'envoi, où que l'on soit dans
   * l'application, et un envoi lancé depuis un écran ne doit pas devenir
   * invisible parce qu'on en a changé.
   */
  const runSync = useCallback(async (): Promise<SyncReport | null> => {
    if (!session) return null;
    setSyncing(true);
    setSyncError(null);
    try {
      const rapport = await synchronize(session, activeFarmId);
      setPending(await outboxCount());
      if (rapport.snapshotRefreshed) await refreshSnapshot();
      // Des saisies refusées ne font pas échouer l'envoi, mais elles ne sont
      // pas parties : le voyant doit rester rouge, sans quoi l'exploitant
      // croirait tout envoyé.
      if (rapport.errors.length > 0) {
        setSyncError(
          `${rapport.errors.length} saisie(s) refusée(s) — ouvrez la file pour voir lesquelles.`,
        );
      }
      return rapport;
    } catch (cause) {
      setSyncError(
        cause instanceof Error ? cause.message : 'Synchronisation impossible.',
      );
      throw cause;
    } finally {
      setSyncing(false);
    }
  }, [session, activeFarmId, refreshSnapshot]);

  /**
   * Envoi automatique des saisies en attente.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * POURQUOI
   * ───────────────────────────────────────────────────────────────────────────
   *
   * `runSync` n'avait qu'un seul appelant : le bouton de l'écran de la file
   * d'attente. Rien ne partait donc jamais tout seul — ni à la connexion, ni au
   * retour du réseau, ni après une saisie faite avec du réseau. L'exploitant
   * renommait une parcelle, voyait le nouveau nom (l'écriture locale est
   * optimiste), et rien n'arrivait au serveur tant qu'il n'allait pas presser
   * un bouton sur un autre écran — qu'aucune ligne de l'interface ne lui
   * demandait de presser. Le bandeau hors réseau promettait même l'inverse :
   * « vos saisies partiront à la reconnexion ».
   *
   * Vérifié en pilotant l'application contre un vrai serveur : la parcelle
   * renommée gardait son ancien nom en base.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * CE QUI DÉCLENCHE, ET CE QUI RETIENT
   * ───────────────────────────────────────────────────────────────────────────
   *
   * L'effet se déclenche dès qu'il y a du réseau et quelque chose en attente :
   * cela couvre d'un coup l'ouverture de l'application, le retour du réseau et
   * la saisie faite en zone couverte.
   *
   * Un envoi réussi vide la file, donc l'effet ne se rejoue pas. Ce qui compte
   * est l'autre cas : une saisie que le serveur **refuse** reste en file, et
   * réessayer sans fin la viderait la batterie sans rien changer — un refus
   * reste un refus. On espace donc les tentatives, puis on s'arrête : le
   * voyant rouge et l'écran de la file sont là pour ça, et c'est à
   * l'exploitant de corriger.
   */
  const [essaisAuto, setEssaisAuto] = useState(0);
  const echecsDeSuite = useRef(0);
  const envoiAutoEnCours = useRef(false);
  /** Au-delà, on laisse la main : réessayer n'est plus une réponse. */
  const ECHECS_AVANT_ABANDON = 4;

  const fileObservee = useRef<number | null>(null);

  useEffect(() => {
    if (!session || !online || pending === 0 || syncing) return;

    // La file a changé de taille : une saisie de plus, ou un envoi qui a
    // avancé. Dans les deux cas la situation n'est plus celle qui avait fait
    // abandonner, et un envoi manuel réussi réarme ainsi l'automatique.
    if (fileObservee.current !== pending) {
      fileObservee.current = pending;
      echecsDeSuite.current = 0;
    }

    if (echecsDeSuite.current >= ECHECS_AVANT_ABANDON) return;

    // Première tentative tout de suite ; les suivantes de plus en plus
    // espacées, jusqu'à cinq minutes.
    const attente =
      echecsDeSuite.current === 0
        ? 0
        : Math.min(5 * 60_000, 15_000 * 2 ** (echecsDeSuite.current - 1));

    const minuteur = setTimeout(() => {
      if (envoiAutoEnCours.current) return;
      envoiAutoEnCours.current = true;

      void runSync()
        .then((rapport) => {
          // La file peut rester garnie pour deux raisons opposées : le lot est
          // plafonné (l'envoi avance, il faut continuer), ou le serveur a
          // refusé (insister ne servirait à rien). `applied` les distingue.
          if (rapport && rapport.remaining > 0 && rapport.applied === 0) {
            echecsDeSuite.current += 1;
          } else {
            echecsDeSuite.current = 0;
          }
        })
        .catch(() => {
          // L'erreur est déjà portée par `syncError` et par le voyant : ici on
          // ne fait que compter, pour espacer la suite.
          echecsDeSuite.current += 1;
        })
        .finally(() => {
          envoiAutoEnCours.current = false;
          setEssaisAuto((nombre) => nombre + 1);
        });
    }, attente);

    return () => clearTimeout(minuteur);
  }, [session, online, pending, syncing, essaisAuto, runSync]);

  // Le voyant se calcule, il ne se stocke pas : voir `syncStatusFrom`.
  const syncStatus: SyncStatus = syncStatusFrom({
    online,
    pending,
    syncing,
    error: syncError,
  });

  const navigate = useCallback((screen: Screen) => {
    setStack((current) => [...current, screen]);
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }, []);

  /**
   * Ouvre un domaine du portefeuille.
   *
   * Le cache est celui d'une seule exploitation à la fois : changer de domaine
   * le remplace. C'est assumé — embarquer tout un portefeuille remplirait le
   * téléphone, et l'expert travaille sur une exploitation à la fois.
   */
  const selectFarm = useCallback(
    async (farmId: string) => {
      if (!session) return;
      setActiveFarmId(farmId);
      await saveActiveFarmId(farmId);
      try {
        const fresh = await fetchSnapshot(session, farmId);
        await writeSnapshot(fresh);
        setSnapshot(fresh);
        setRegistres(await lireRegistres(fresh.farm.id));
        void majRegistres(fresh.farm.id);
        setStack((current) => [...current, { name: 'parcels' }]);
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        // Hors réseau : seul le domaine déjà en cache reste consultable.
        if (snapshot?.farm.id === farmId) {
          setStack((current) => [...current, { name: 'parcels' }]);
        } else {
          throw error;
        }
      }
    },
    [session, snapshot, majRegistres],
  );

  const renommerLocalement = useCallback(
    async (
      parcelId: string,
      valeurs: { name: string; internalNumber: string | null; lieuDit: string | null },
    ) => {
      if (!snapshot) return;
      const suivant = {
        ...snapshot,
        parcels: snapshot.parcels.map((parcel) =>
          parcel.id === parcelId ? { ...parcel, ...valeurs } : parcel,
        ),
      };
      // Écrit sur le disque autant qu'en mémoire : redémarrer l'application
      // hors réseau ne doit pas faire réapparaître l'ancien nom.
      await writeSnapshot(suivant);
      setSnapshot(suivant);
    },
    [snapshot],
  );

  const logout = useCallback(async () => {
    if (session) await apiLogout(session);
    await Promise.all([
      clearSession(),
      clearCache(),
      clearOutbox(),
      saveActiveFarmId(null),
    ]);
    setSession(null);
    setSnapshot(null);
    setRegistres(null);
    setActiveFarmId(null);
    setPending(0);
    setStack([{ name: 'parcels' }]);
  }, [session]);

  const parcels: CachedParcel[] = useMemo(
    () => snapshot?.parcels ?? [],
    [snapshot],
  );

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-accent border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onAuthenticated={async (next) => {
          await saveSession(next);
          setSession(next);
          setStack([
            next.accountType === 'AGRONOMIST' ? { name: 'portfolio' } : { name: 'parcels' },
          ]);
        }}
      />
    );
  }

  const context: AppContext = {
    session,
    snapshot,
    online,
    pending,
    syncStatus,
    syncError,
    runSync,
    activeFarmId,
    registres,
    registresEtat,
    actualiserRegistres: async () => {
      if (snapshot) await majRegistres(snapshot.farm.id);
    },
    isExpert,
    // La lecture seule vient du serveur, pas d'une déduction locale : c'est lui
    // qui sait si l'accès relève d'une mission de conseil.
    readOnly: snapshot?.advisory ?? false,
    refreshPending,
    refreshSnapshot,
    renommerLocalement,
    selectFarm,
    navigate,
    back,
    logout,
  };

  const current = stack[stack.length - 1] ?? homeScreen;

  switch (current.name) {
    case 'portfolio':
      return <PortfolioScreen context={context} />;

    case 'carte':
      return <CarteScreen context={context} />;

    case 'stock':
      return <StockScreen context={context} />;

    case 'new-purchase':
      return <NewPurchaseScreen context={context} />;

    case 'new-parcel':
      return <NewParcelScreen context={context} />;

    case 'parcel': {
      const parcel = parcels.find((item) => item.id === current.parcelId);
      if (!parcel) {
        back();
        return null;
      }
      return <ParcelScreen context={context} parcel={parcel} />;
    }

    case 'entry': {
      const parcel = parcels.find((item) => item.id === current.parcelId);
      if (!parcel) {
        back();
        return null;
      }
      return <EntryScreen context={context} parcel={parcel} kind={current.kind} />;
    }

    case 'recommendations':
      return <RecommendationsScreen context={context} />;

    case 'recommendation': {
      const recommendation = (snapshot?.recommendations ?? []).find(
        (item) => item.id === current.recommendationId,
      );
      if (!recommendation) {
        back();
        return null;
      }
      return (
        <RecommendationScreen context={context} recommendation={recommendation} />
      );
    }

    case 'new-recommendation':
      return (
        <NewRecommendationScreen
          context={context}
          {...(current.parcelId ? { parcelId: current.parcelId } : {})}
        />
      );

    case 'queue':
      return <QueueScreen context={context} />;

    case 'settings':
      return <SettingsScreen context={context} />;

    case 'security':
      return <SecurityScreen context={context} />;

    case 'aide':
      return <AideScreen context={context} />;

    case 'contact':
      return <ContactScreen context={context} sujet={current.sujet ?? ''} />;

    case 'demandes':
      return <DemandesScreen context={context} />;

    case 'demande':
      return <DemandeScreen context={context} ticketId={current.ticketId} />;

    default:
      return <ParcelsScreen context={context} />;
  }
}
