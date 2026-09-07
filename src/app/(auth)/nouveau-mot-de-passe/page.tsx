import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { ResetForm } from '@/app/(auth)/nouveau-mot-de-passe/ResetForm';
import { Alert } from '@/components/ui';

export const metadata: Metadata = { title: 'Nouveau mot de passe' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      title="Choisir un nouveau mot de passe"
      subtitle="Toutes vos sessions seront fermées après le changement."
      footer={
        <Link href="/connexion" className="font-medium text-champ-700 dark:text-champ-400 hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      {token ? (
        <ResetForm token={token} />
      ) : (
        <Alert tone="danger" title="Lien invalide">
          Ce lien de réinitialisation est incomplet. Demandez-en un nouveau depuis la
          page « Mot de passe oublié ».
        </Alert>
      )}
    </AuthShell>
  );
}
