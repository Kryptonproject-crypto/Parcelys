import { getEnv } from '@/lib/env';
import type { EmailMessage } from '@/lib/email';

/** Échappement HTML — toutes les valeurs dynamiques passent par ici. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  const appName = getEnv().APP_NAME;
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f7f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2a1c;">
  <table role="presentation" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #dfe6d8;">
    <tr><td style="padding:24px 28px;border-bottom:1px solid #eef2ea;">
      <span style="font-size:18px;font-weight:700;color:#2f6b34;">🌾 ${escape(appName)}</span>
    </td></tr>
    <tr><td style="padding:28px;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #eef2ea;font-size:12px;color:#6b7a63;">
      Cet e-mail vous est envoyé par ${escape(appName)}. Si vous n'êtes pas à l'origine
      de cette demande, vous pouvez l'ignorer.
    </td></tr>
  </table>
</body></html>`;
}

export function verificationEmail(params: {
  to: string;
  firstName: string;
  code: string;
  expiresInMinutes: number;
}): EmailMessage {
  const { APP_NAME, APP_URL } = getEnv();
  const text = [
    `Bonjour ${params.firstName},`,
    '',
    `Votre code de vérification ${APP_NAME} est : ${params.code}`,
    '',
    `Ce code expire dans ${params.expiresInMinutes} minutes.`,
    `Saisissez-le sur ${APP_URL}/verification-email`,
  ].join('\n');

  return {
    to: params.to,
    subject: `${params.code} — votre code de vérification ${APP_NAME}`,
    text,
    html: layout(
      'Vérification de votre adresse e-mail',
      `<p>Bonjour ${escape(params.firstName)},</p>
       <p>Voici votre code de vérification :</p>
       <p style="font-size:32px;font-weight:700;letter-spacing:8px;color:#2f6b34;
                 background:#f2f7f0;border-radius:10px;padding:16px;text-align:center;">
         ${escape(params.code)}
       </p>
       <p>Ce code expire dans <strong>${params.expiresInMinutes} minutes</strong>.</p>
       <p><a href="${escape(APP_URL)}/verification-email"
             style="display:inline-block;background:#2f6b34;color:#fff;text-decoration:none;
                    padding:11px 20px;border-radius:8px;">Vérifier mon adresse</a></p>`,
    ),
  };
}

export function passwordResetEmail(params: {
  to: string;
  firstName: string;
  token: string;
  expiresInMinutes: number;
}): EmailMessage {
  const { APP_NAME, APP_URL } = getEnv();
  const link = `${APP_URL}/nouveau-mot-de-passe?token=${encodeURIComponent(params.token)}`;

  return {
    to: params.to,
    subject: `Réinitialisation de votre mot de passe ${APP_NAME}`,
    text: [
      `Bonjour ${params.firstName},`,
      '',
      'Vous avez demandé la réinitialisation de votre mot de passe.',
      `Lien (valable ${params.expiresInMinutes} minutes) : ${link}`,
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    ].join('\n'),
    html: layout(
      'Réinitialisation du mot de passe',
      `<p>Bonjour ${escape(params.firstName)},</p>
       <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
       <p><a href="${escape(link)}"
             style="display:inline-block;background:#2f6b34;color:#fff;text-decoration:none;
                    padding:11px 20px;border-radius:8px;">Choisir un nouveau mot de passe</a></p>
       <p style="color:#6b7a63;font-size:13px;">
         Ce lien expire dans ${params.expiresInMinutes} minutes.</p>`,
    ),
  };
}

export function securityAlertEmail(params: {
  to: string;
  firstName: string;
  event: string;
  detail: string;
}): EmailMessage {
  const { APP_NAME } = getEnv();
  return {
    to: params.to,
    subject: `${APP_NAME} — ${params.event}`,
    text: `Bonjour ${params.firstName},\n\n${params.detail}`,
    html: layout(
      params.event,
      `<p>Bonjour ${escape(params.firstName)},</p><p>${escape(params.detail)}</p>`,
    ),
  };
}

export function notificationEmail(params: {
  to: string;
  firstName: string;
  title: string;
  body: string;
  link?: string;
}): EmailMessage {
  const { APP_URL } = getEnv();
  const url = params.link ? `${APP_URL}${params.link}` : null;
  return {
    to: params.to,
    subject: params.title,
    text: `Bonjour ${params.firstName},\n\n${params.body}${url ? `\n\n${url}` : ''}`,
    html: layout(
      params.title,
      `<p>Bonjour ${escape(params.firstName)},</p>
       <p>${escape(params.body)}</p>
       ${url ? `<p><a href="${escape(url)}" style="color:#2f6b34;">Ouvrir dans Parcelys</a></p>` : ''}`,
    ),
  };
}
