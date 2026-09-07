import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { LinkButton } from '@/components/ui';

const FEATURES = [
  {
    icon: '🗺️',
    title: 'Gestion des parcelles',
    text: "Dessinez vos parcelles sur la carte, la superficie est calculée automatiquement à partir de la géométrie réelle et conservée dans une base PostGIS.",
  },
  {
    icon: '📋',
    title: 'Registre parcellaire',
    text: "Numéro interne, commune, lieu-dit, référence cadastrale, identifiant PAC : votre parcellaire complet, prêt à être édité.",
  },
  {
    icon: '🌱',
    title: 'Suivi des cultures',
    text: 'Culture, variété, dates de semis et de récolte, rendement. L’assolement est conservé campagne après campagne.',
  },
  {
    icon: '💧',
    title: 'Suivi des apports',
    text: 'Apports organiques et minéraux, calcul automatique des quantités totales et bilan des éléments fertilisants N, P, K.',
  },
  {
    icon: '🧪',
    title: 'Phytosanitaire',
    text: "Recherche des produits dans le catalogue officiel E-Phy et registre phytosanitaire généré à partir de vos interventions.",
  },
  {
    icon: '🌦️',
    title: 'Météo locale',
    text: 'Conditions actuelles, prévisions horaires et journalières sur votre exploitation, enregistrables lors d’un traitement.',
  },
  {
    icon: '📤',
    title: 'Exports',
    text: 'Registre parcellaire, phytosanitaire, apports et historique en PDF, Excel et CSV, filtrables par campagne et par parcelle.',
  },
  {
    icon: '🔐',
    title: 'Sécurité et multi-utilisateurs',
    text: 'Vérification de l’adresse e-mail, sessions révocables, rôles par exploitation et isolation stricte des données.',
  },
];

export default async function HomePage() {
  // Un utilisateur déjà connecté n'a pas besoin de la page de présentation.
  const auth = await getAuthContext();
  if (auth) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-white">
      {/* En-tête */}
      <header className="sticky top-0 z-40 border-b border-ardoise-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-champ-700">
            <span aria-hidden>🌾</span> Parcelys
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
      <section className="relative overflow-hidden border-b border-ardoise-200 bg-gradient-to-b from-champ-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full border border-champ-200 bg-white px-3 py-1 text-xs font-medium text-champ-700">
              Logiciel de gestion parcellaire agricole
            </span>
            <h1 className="mt-5 text-3xl font-bold leading-tight tracking-tight text-ardoise-900 sm:text-5xl">
              Votre parcellaire, vos cultures et vos registres au même endroit.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ardoise-600">
              Parcelys réunit la cartographie de vos parcelles, le suivi des cultures,
              le registre des apports et le registre phytosanitaire. Une saisie rapide
              sur le terrain, des exports conformes au bureau.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/inscription" size="lg">
                Créer mon compte
              </LinkButton>
              <LinkButton href="/connexion" variant="outline" size="lg">
                Se connecter
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-ardoise-500">
              Données hébergées sur votre propre serveur · Aucune donnée réglementaire inventée
            </p>
          </div>
        </div>
      </section>

      {/* Fonctionnalités */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold text-ardoise-900">
          Tout ce qu&apos;il faut pour tenir son exploitation à jour
        </h2>
        <p className="mt-2 max-w-2xl text-ardoise-600">
          Chaque module écrit dans la même base : une intervention saisie sur une
          parcelle alimente immédiatement son historique, ses registres et ses exports.
        </p>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <article
              key={feature.title}
              className="rounded-xl border border-ardoise-200 bg-white p-5 transition hover:border-champ-300 hover:shadow-md"
            >
              <span className="text-2xl" aria-hidden>
                {feature.icon}
              </span>
              <h3 className="mt-3 font-semibold text-ardoise-900">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ardoise-600">
                {feature.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Parcours */}
      <section className="border-y border-ardoise-200 bg-ardoise-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold text-ardoise-900">
            De la création du compte au registre exporté
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['1', 'Créez votre compte', 'Inscription, vérification de l’adresse e-mail par code, création de l’exploitation.'],
              ['2', 'Dessinez vos parcelles', 'Recherchez votre commune, tracez le contour, la superficie est calculée par PostGIS.'],
              ['3', 'Renseignez vos cultures', 'Culture, variété, semis, récolte et rendement, campagne après campagne.'],
              ['4', 'Enregistrez vos interventions', 'Apports, traitements phytosanitaires et travaux, avec conditions météo.'],
              ['5', 'Consultez l’historique', 'Chaque parcelle dispose d’une chronologie complète de ses interventions.'],
              ['6', 'Exportez vos registres', 'PDF, Excel ou CSV, filtrés par campagne, parcelle ou type d’intervention.'],
            ].map(([step, title, text]) => (
              <li key={step} className="rounded-xl border border-ardoise-200 bg-white p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-champ-600 text-sm font-bold text-white">
                  {step}
                </span>
                <h3 className="mt-3 font-semibold text-ardoise-900">{title}</h3>
                <p className="mt-1 text-sm text-ardoise-600">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Note réglementaire */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="rounded-xl border border-ble-500/30 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-900">
            Données phytosanitaires : uniquement des sources officielles
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-amber-900/90">
            Les informations sur les produits phytopharmaceutiques (numéro d&apos;AMM,
            substances actives, usages et doses autorisées, conditions d&apos;emploi)
            proviennent exclusivement du catalogue officiel E-Phy publié par
            l&apos;ANSES. Parcelys ne génère aucune donnée réglementaire : la source et
            la date de dernière synchronisation sont affichées dans l&apos;application.
            Elles ne se substituent pas à l&apos;étiquette du produit.
          </p>
        </div>
      </section>

      <footer className="border-t border-ardoise-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ardoise-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>🌾 Parcelys — logiciel de gestion parcellaire agricole</p>
          <nav className="flex flex-wrap gap-4">
            <Link href="/confidentialite" className="hover:text-champ-700">
              Politique de confidentialité
            </Link>
            <Link href="/cgu" className="hover:text-champ-700">
              Conditions générales
            </Link>
            <Link href="/connexion" className="hover:text-champ-700">
              Se connecter
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
