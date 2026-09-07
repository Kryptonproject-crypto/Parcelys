import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { AuthShell } from '@/components/auth/AuthShell';
import { RegisterForm } from '@/app/(auth)/inscription/RegisterForm';

export const metadata: Metadata = { title: 'Créer un compte' };

export default async function RegisterPage() {
  if (await getAuthContext()) redirect('/dashboard');

  return (
    <AuthShell
      title="Créer mon compte"
      subtitle="Renseignez votre identité et votre exploitation. Un code de vérification vous sera envoyé par e-mail."
      footer={
        <>
          Vous avez déjà un compte ?{' '}
          <Link href="/connexion" className="font-medium text-champ-700 hover:underline">
            Se connecter
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
