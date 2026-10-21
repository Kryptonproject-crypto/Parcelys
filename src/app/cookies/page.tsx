import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/PublicShell';
import { AutresPagesLegales, Corps, Section } from '@/components/legal/Juridique';
import { RESSOURCES_TIERCES, TRACEURS_APPLICATION, TRACEURS_SITE, type Traceur } from '@/lib/shared/traceurs';
import { getEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Cookies et traceurs',
  description: 'Ce que Parcelys dépose sur votre appareil, pourquoi, et pour combien de temps.',
};

/** Durées de session réellement configurées sur ce serveur, en clair. */
function dureeSession(): string {
  const env = getEnv();
  const jours = (h: number) => (h % 24 === 0 ? `${h / 24} jour${h / 24 > 1 ? 's' : ''}` : `${h} heures`);
  return `${jours(env.SESSION_TTL_HOURS)} au plus, ${jours(env.SESSION_IDLE_TIMEOUT_HOURS)} sans activité ; supprimé à la déconnexion.`;
}

function Tableau({ lignes }: { lignes: Traceur[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[560px] text-left text-[13.5px]">
        <thead className="bg-surface-2 text-ink">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Nom</th>
            <th scope="col" className="px-3 py-2 font-semibold">À quoi il sert</th>
            <th scope="col" className="px-3 py-2 font-semibold">Durée</th>
            <th scope="col" className="px-3 py-2 font-semibold">Consentement</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line text-ink-2">
          {lignes.map((t) => (
            <tr key={t.nom} className="align-top">
              <td className="px-3 py-2.5">
                <code className="break-all text-[12.5px] text-ink">{t.nom}</code>
                <span className="mt-0.5 block text-[12px] text-ink-3">{t.support}</span>
              </td>
              <td className="px-3 py-2.5">{t.finalite}</td>
              <td className="px-3 py-2.5">{t.nom === 'parcelys_session' ? dureeSession() : t.duree}</td>
              <td className="px-3 py-2.5">
                {t.exempte ? (
                  <>
                    Non requis
                    <span className="mt-0.5 block text-[12px] text-ink-3">{t.justification}</span>
                  </>
                ) : (
                  'Requis — demandé avant tout dépôt'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CookiesPage() {
  return (
    <PublicShell
      title="Cookies et traceurs"
      description="Ce que Parcelys dépose sur votre appareil, pourquoi, et pour combien de temps. Rien d’autre n’est déposé."
    >
      <Corps>
        <Section titre="En bref">
          <p>
            Parcelys n’utilise <strong>aucun</strong> cookie de publicité, de mesure
            d’audience ou de réseau social, et ne revend aucune donnée. Les seuls traceurs
            sont ceux sans lesquels le service ne fonctionnerait pas — vous garder connecté,
            retenir le thème choisi — ou qui facilitent une saisie que vous faites
            vous-même.
          </p>
          <p>
            Ces traceurs sont <strong>exemptés de consentement</strong> : l’article 82 de la
            loi Informatique et Libertés et les lignes directrices de la CNIL (délibération
            n° 2020-091 du 17 septembre 2020) dispensent de consentement les traceurs
            strictement nécessaires au service que vous avez demandé. Ils ne dispensent pas
            de vous en informer : c’est l’objet de cette page, et du bandeau affiché à votre
            première visite.
          </p>
        </Section>

        <Section titre="Sur le site">
          <Tableau lignes={TRACEURS_SITE} />
        </Section>

        <Section titre="Dans l’application de terrain">
          <p>
            L’application garde sur le téléphone ce qu’il faut pour travailler sans réseau.
            Ces données ne quittent l’appareil que pour être synchronisées avec votre
            compte.
          </p>
          <Tableau lignes={TRACEURS_APPLICATION} />
        </Section>

        <Section titre="Cartes : ce que reçoivent les fournisseurs de fonds">
          <p>
            Les fonds de carte sont des images chargées par votre navigateur directement
            chez leur fournisseur. Parcelys ne leur demande de déposer aucun cookie et ne
            leur transmet ni votre identité ni vos parcelles ; mais, comme pour toute image
            chargée depuis un autre site, le fournisseur reçoit l’adresse IP de votre
            appareil et la zone de carte affichée.
          </p>
          <ul className="list-inside list-disc space-y-1">
            {RESSOURCES_TIERCES.map((r) => (
              <li key={r.nom}>
                <strong>{r.nom}</strong> — {r.fournisseur}. {r.quand}
              </li>
            ))}
          </ul>
          <p>
            Pour ne rien transmettre au fournisseur satellite, restez en vue « plan ».
          </p>
        </Section>

        <Section titre="Effacer ces traceurs">
          <p>
            La déconnexion supprime le cookie de session. Les préférences s’effacent depuis
            les réglages de votre navigateur (« Effacer les données du site ») ; dans
            l’application, la déconnexion efface les données hors ligne, la désinstallation
            efface tout.
          </p>
          <p>
            Pour toute question :{' '}
            <Link href="/contact" className="font-medium text-champ-700 underline dark:text-champ-400">
              nous écrire
            </Link>
            . Le traitement de vos données personnelles est décrit dans la page{' '}
            <Link href="/confidentialite" className="font-medium text-champ-700 underline dark:text-champ-400">
              Données personnelles
            </Link>
            .
          </p>
        </Section>
      </Corps>
      <AutresPagesLegales courante="/cookies" />
    </PublicShell>
  );
}
