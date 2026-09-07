import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { ForgotForm } from '@/app/(auth)/mot-de-passe-oublie/ForgotForm';

export const metadata: Metadata = { title: 'Mot de passe oublié' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Indiquez votre adresse e-mail : si un compte y est associé, vous recevrez un lien de réinitialisation valable 30 minutes."
      footer={
        <Link href="/connexion" className="font-medium text-champ-700 hover:underline">
          Retour à la connexion
        </Link>
      }
    >
      <ForgotForm />
    </AuthShell>
  );
}
