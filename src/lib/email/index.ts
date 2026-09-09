import 'server-only';
import { getEnv } from '@/lib/env';

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Fournisseur `console` : n'envoie rien, écrit le message dans les logs.
 * C'est le mode par défaut en développement — aucun secret n'est requis, et le
 * code de vérification reste lisible dans le terminal.
 */
class ConsoleProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    console.info(
      [
        '',
        '──────────── E-MAIL (mode console) ────────────',
        `À       : ${message.to}`,
        `Objet   : ${message.subject}`,
        '',
        message.text,
        '───────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

/** SMTP via nodemailer, chargé dynamiquement pour rester optionnel. */
class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';

  async send(message: EmailMessage): Promise<void> {
    const env = getEnv();
    if (!env.SMTP_HOST) {
      throw new Error('SMTP_HOST doit être défini avec EMAIL_PROVIDER=smtp');
    }

    const nodemailer = await import('nodemailer').catch(() => {
      throw new Error(
        "Le paquet 'nodemailer' est requis pour EMAIL_PROVIDER=smtp. " +
          'Installez-le avec : npm install nodemailer',
      );
    });

    // Un relais installé sur la machine même (Postfix, voir scripts/setup-mail.sh)
    // se présente avec un certificat auto-signé, que la validation rejette : les
    // e-mails ne partent pas, et l'erreur — « self-signed certificate » — ne dit
    // pas d'où elle vient. Sur la boucle locale on renonce donc à STARTTLS : le
    // trafic ne quitte pas la machine, il n'y a rien à y intercepter, et c'est
    // le relais local qui chiffrera le trajet suivant.
    //
    // Partout ailleurs la validation reste stricte : c'est sur ce trajet-là que
    // circule le mot de passe du relais.
    const host = env.SMTP_HOST;
    const surBoucleLocale = /^(127(\.\d{1,3}){3}|::1|\[::1\]|localhost)$/i.test(host);

    const transport = nodemailer.default.createTransport({
      host,
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE,
      ignoreTLS: surBoucleLocale,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
    });

    await transport.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

/** Service transactionnel Resend (API HTTP, aucune dépendance supplémentaire). */
class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  async send(message: EmailMessage): Promise<void> {
    const env = getEnv();
    if (!env.EMAIL_API_KEY) {
      throw new Error('EMAIL_API_KEY doit être défini avec EMAIL_PROVIDER=resend');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.EMAIL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Envoi Resend échoué (${response.status}) : ${body}`);
    }
  }
}

export function getEmailProvider(): EmailProvider {
  switch (getEnv().EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpProvider();
    case 'resend':
      return new ResendProvider();
    default:
      return new ConsoleProvider();
  }
}

/**
 * Envoi non bloquant : un incident du fournisseur d'e-mail ne doit jamais faire
 * échouer une inscription. L'erreur est journalisée et l'utilisateur peut
 * demander un renvoi du code.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    await getEmailProvider().send(message);
    return true;
  } catch (error) {
    console.error('[email] envoi échoué', error);
    return false;
  }
}
