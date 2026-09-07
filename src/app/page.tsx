import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { LinkButton } from '@/components/ui';
import { HeroParcels } from '@/components/marketing/HeroParcels';
import {
  IconArrowRight,
  IconCrops,
  IconExport,
  IconHistory,
  IconInputs,
  IconParcels,
  IconPhyto,
  IconRegistry,
  IconSecurity,
  IconWeather,
  type LucideIcon,
} from '@/components/ui/icons';

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: IconParcels,
    title: 'Parcellaire cartographié',
    text: 'Dessinez vos contours sur la carte. La superficie est calculée par PostGIS à partir de la géométrie réelle, sur l’ellipsoïde WGS84.',
  },
  {
    icon: IconCrops,
    title: 'Suivi des cultures',
    text: 'Culture, variété, semis, récolte, rendement. L’assolement se construit campagne après campagne, sans ressaisie.',
  },
  {
    icon: IconInputs,
    title: 'Registre des apports',
    text: 'Organiques et minéraux. La quantité totale et le bilan N, P₂O₅, K₂O se calculent seuls à partir de la dose et de la surface.',
  },
  {
    icon: IconPhyto,
    title: 'Phytosanitaire E-Phy',
    text: 'Recherchez le produit dans le catalogue officiel de l’ANSES : AMM, substances actives et usages autorisés sont repris tels quels.',
  },
  {
    icon: IconWeather,
    title: 'Météo à la parcelle',
    text: 'Conditions du moment et prévisions, avec relevé automatique lors d’un traitement et évaluation de la fenêtre de pulvérisation.',
  },
  {
    icon: IconHistory,
    title: 'Historique complet',
    text: 'Chaque parcelle porte sa chronologie : cultures, apports, traitements, travaux et documents, du plus récent au plus ancien.',
  },
  {
    icon: IconExport,
    title: 'Exports conformes',
    text: 'Registre parcellaire, phytosanitaire, apports et historique en PDF, Excel et CSV, filtrables par campagne et par parcelle.',
  },
  {
    icon: IconSecurity,
    title: 'Sécurité et rôles',
    text: 'Vérification de l’adresse e-mail, sessions révocables, quatre rôles par exploitation et isolation stricte des données.',
  },
];

const STEPS = [
  ['Créez votre compte', 'Inscription, vérification par code, création de l’exploitation.'],
  ['Dessinez vos parcelles', 'Cherchez votre commune, tracez le contour, la superficie tombe.'],
  ['Renseignez vos cultures', 'Culture, variété, semis et récolte pour la campagne.'],
  ['Saisissez vos interventions', 'Apports, traitements et travaux, avec la météo du jour.'],
  ['Consultez l’historique', 'Toute la vie de la parcelle sur une seule chronologie.'],
  ['Éditez vos registres', 'PDF, Excel ou CSV, prêts à imprimer ou à transmettre.'],
];

export default async function HomePage() {
  // Un utilisateur déjà connecté n'a pas besoin de la page de présentation.
  const auth = await getAuthContext();
  if (auth) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-canvas">
      {/* En-tête */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink"
          >
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft"
            >
              🌾
            </span>
            Parcelys
          </Link>
          <nav className="flex items-center gap-2">
            <LinkButton href="/connexion" variant="ghost" size="sm">
              Se connecter
            </LinkButton>
            <LinkButton href="/inscription" size="sm">
              Créer mon compte
            </LinkButton>
          </nav>
        </div>
      </header>

      {/* Bandeau principal */}
      <section className="relative overflow-hidden border-b border-line">
        {/* Halo décoratif : profondeur sans image à charger. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_20%_-10%,var(--color-champ-200)_0%,transparent_60%)] opacity-60 dark:opacity-25"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_50%_at_90%_10%,var(--color-ble-100)_0%,transparent_55%)] opacity-70 dark:opacity-15"
        />

        {/* Parcellaire stylisé : occupe l'espace à droite du texte sur grand écran. */}
        <HeroParcels className="pointer-events-none absolute -right-16 top-8 hidden h-[440px] w-[440px] opacity-90 lg:block xl:right-4" />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-3xl lg:max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] font-medium text-ink-2 shadow-card">
              <span className="h-1.5 w-1.5 rounded-full bg-champ-500" aria-hidden />
              Logiciel de gestion parcellaire agricole
            </span>

            <h1 className="mt-6 text-[2.25rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[3.5rem]">
              Votre parcellaire, vos cultures{' '}
              <span className="text-champ-600 dark:text-champ-400">et vos registres</span>{' '}
              au même endroit.
            </h1>

            <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2">
              Parcelys réunit la cartographie de vos parcelles, le suivi des cultures, le
              registre des apports et le registre phytosanitaire. Une saisie rapide sur le
              terrain, des exports conformes au bureau.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <LinkButton href="/inscription" size="lg" icon={IconArrowRight}>
                Créer mon compte
              </LinkButton>
              <LinkButton href="/connexion" variant="outline" size="lg">
                Se connecter
              </LinkButton>
            </div>

            <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-5 border-t border-line pt-8 sm:grid-cols-4">
              {[
                ['PostGIS', 'Superficies calculées'],
                ['E-Phy', 'Source officielle ANSES'],
                ['PDF · Excel · CSV', 'Exports de registres'],
                ['Auto-hébergé', 'Vos données chez vous'],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-[15px] font-semibold text-ink">{value}</dt>
                  <dd className="mt-0.5 text-[13px] text-ink-3">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]">
            Tout ce qu&apos;il faut pour tenir son exploitation à jour
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
            Chaque module écrit dans la même base : une intervention saisie sur une
            parcelle alimente immédiatement son historique, ses registres et ses exports.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="group rounded-xl border border-line bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-champ-300 hover:shadow-raised"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-ink transition-transform group-hover:scale-105">
                  <Icon size={19} aria-hidden />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{feature.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">
                  {feature.text}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Parcours */}
      <section className="border-y border-line bg-surface-2">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[32px]">
            De la création du compte au registre exporté
          </h2>

          <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(([title, text], index) => (
              <li key={title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-champ-300 bg-surface text-[13px] font-semibold text-champ-700 dark:border-champ-700 dark:text-champ-400">
                    {index + 1}
                  </span>
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-gradient-to-r from-line to-transparent"
                  />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Note réglementaire */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[auto_1fr] lg:gap-10">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-ble-100 text-ble-700 dark:bg-ble-700/25 dark:text-ble-300">
              <IconRegistry size={22} aria-hidden />
            </span>
            <div>
              <h2 className="text-[20px] font-semibold tracking-tight text-ink">
                Données phytosanitaires : uniquement des sources officielles
              </h2>
              <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
                Les informations sur les produits phytopharmaceutiques — numéro d&apos;AMM,
                substances actives, usages et doses autorisées, conditions d&apos;emploi —
                proviennent exclusivement du catalogue officiel E-Phy publié par
                l&apos;ANSES. Parcelys ne génère aucune donnée réglementaire : la source et
                la date de dernière synchronisation sont affichées dans l&apos;application.
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-3">
                Ces informations ne se substituent pas à l&apos;étiquette du produit ni à la
                décision d&apos;autorisation en vigueur.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Appel à l'action */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-champ-800 px-8 py-14 text-center sm:px-12">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,var(--color-champ-600)_0%,transparent_70%)]"
          />
          <div className="relative">
            <h2 className="text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">
              Prêt à cartographier votre exploitation ?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-champ-100">
              Créez votre compte, tracez votre première parcelle, et vos registres se
              construisent au fil de vos saisies.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/inscription"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-6 text-[15px] font-medium text-champ-800 shadow-raised transition-transform hover:-translate-y-0.5"
              >
                Créer mon compte
                <IconArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-[13.5px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="flex items-center gap-2">
            <span aria-hidden>🌾</span> Parcelys — logiciel de gestion parcellaire agricole
          </p>
          <nav className="flex flex-wrap gap-5">
            <Link href="/confidentialite" className="transition-colors hover:text-ink">
              Confidentialité
            </Link>
            <Link href="/cgu" className="transition-colors hover:text-ink">
              Conditions générales
            </Link>
            <Link href="/connexion" className="transition-colors hover:text-ink">
              Se connecter
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
