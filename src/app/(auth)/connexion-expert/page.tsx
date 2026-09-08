import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthContext } from '@/lib/auth/session';
import { homePathFor } from '@/lib/auth/rbac';
import { AuthShell } from '@/components/auth/AuthShell';
import { SpaceSwitch } from '@/components/auth/SpaceSwitch';
import { LoginForm } from '@/app/(auth)/connexion/LoginForm';

export const metadata: Metadata = { title: 'Connexion expert agronomique' };

export default async function ExpertLoginPage() {
  const auth = await getAuthContext();
  if (auth) redirect(homePathFor(auth));

  return (
    <AuthShell
      title="Espace expert agronomique"
      subtitle="Retrouvez les exploitations que vous suivez, leurs parcelles et vos préconisations."
      footer={
        <>
          Vous êtes exploitant ?{' '}
          <Link
            href="/connexion"
            className="font-medium text-champ-700 dark:text-champ-400 hover:underline"
          >
            Connexion exploitation
          </Link>
        </>
      }
    >
      <SpaceSwitch active="expert" />
      <LoginForm space="expert" />
    </AuthShell>
  );
}
