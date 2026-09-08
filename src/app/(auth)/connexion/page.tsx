import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/rbac';
import { AuthShell } from '@/components/auth/AuthShell';
import { SpaceSwitch } from '@/components/auth/SpaceSwitch';
import { LoginForm } from '@/app/(auth)/connexion/LoginForm';

export const metadata: Metadata = { title: 'Connexion' };

export default async function LoginPage() {
  const auth = await getAuthContext();
  if (auth) redirect(homePathFor(auth));

  return (
    <AuthShell
      title="Se connecter"
      subtitle="Accédez à votre parcellaire, vos registres et vos exports."
      footer={
        <>
          Vous avez un code d&apos;invitation ?{' '}
          <Link href="/inscription" className="font-medium text-champ-700 dark:text-champ-400 hover:underline">
            Créer mon compte
          </Link>
        </>
      }
    >
      <SpaceSwitch active="farm" />
      <LoginForm space="farm" />
    </AuthShell>
  );
}
