import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { isBootstrapAllowed } from '@/lib/auth/invitations';
import { AuthShell } from '@/components/auth/AuthShell';
import { RegisterForm } from '@/app/(auth)/inscription/RegisterForm';

export const metadata: Metadata = { title: 'Créer un compte' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await getAuthContext()) redirect('/dashboard');

  // Instance vierge : le premier compte s'ouvre sans code, puisque personne ne
  // peut encore en délivrer. Dès qu'un compte existe, l'invitation est requise.
  const bootstrap = await isBootstrapAllowed();

  return (
    <AuthShell
      title={bootstrap ? "Créer le compte administrateur" : 'Créer mon compte'}
      subtitle={
        bootstrap
          ? "Cette instance ne contient encore aucun compte. Le premier créé administre Parcelys et invite ensuite les autres utilisateurs."
          : "Les inscriptions sont réservées aux personnes disposant d'un code d'invitation."
      }
      footer={
        <>
          Vous avez déjà un compte ?{' '}
          <Link href="/connexion" className="font-medium text-champ-700 dark:text-champ-400 hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <RegisterForm bootstrap={bootstrap} />
    </AuthShell>
  );
}
