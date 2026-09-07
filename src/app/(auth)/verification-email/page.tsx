import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { VerifyForm } from '@/app/(auth)/verification-email/VerifyForm';

export const metadata: Metadata = { title: 'Vérification de l’adresse e-mail' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Vérifier mon adresse e-mail"
      subtitle="Saisissez le code à 6 chiffres que nous venons de vous envoyer. Sans cette vérification, l’accès à Parcelys reste bloqué."
      footer={
        <Link href="/connexion" className="font-medium text-champ-700 dark:text-champ-400 hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      <VerifyForm initialEmail={params.email ?? ''} />
    </AuthShell>
  );
}
