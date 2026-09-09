/**
 * Essai d'envoi d'un e-mail réel, avec la configuration de l'instance.
 *
 *   npm run email:test -- vous@exemple.fr
 *
 * L'application n'échoue jamais une inscription parce que l'e-mail n'est pas
 * parti : elle journalise et propose un renvoi. C'est le bon comportement, mais
 * il rend une configuration cassée invisible — les codes ne partent pas, et
 * rien ne le dit. Cette commande, elle, va au bout et rapporte l'erreur exacte.
 */
import { getEnv } from '@/lib/env';
import { getEmailProvider } from '@/lib/email';
import { verificationEmail } from '@/lib/email/templates';

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to || !to.includes('@')) {
    fail(
      'Indiquez une adresse de destination :\n' +
        '    npm run email:test -- vous@exemple.fr',
    );
  }

  const env = getEnv();
  const provider = getEmailProvider();

  console.info('Configuration');
  console.info(`  fournisseur : ${provider.name}`);
  console.info(`  expéditeur  : ${env.EMAIL_FROM}`);
  if (env.EMAIL_PROVIDER === 'smtp') {
    console.info(`  serveur     : ${env.SMTP_HOST ?? '(absent)'}:${env.SMTP_PORT ?? 587}`);
    console.info(`  TLS direct  : ${env.SMTP_SECURE ? 'oui' : 'non (STARTTLS)'}`);
    console.info(`  compte      : ${env.SMTP_USER ?? '(sans authentification)'}`);
  }
  console.info('');

  if (env.EMAIL_PROVIDER === 'console') {
    console.warn(
      "EMAIL_PROVIDER=console : rien ne partira, le message sera seulement écrit\n" +
        "ci-dessous. C'est le réglage d'essai — voyez le § 15 bis du guide\n" +
        'Raspberry Pi pour acheminer réellement les codes.\n',
    );
  }

  // Un vrai message de vérification : on éprouve le gabarit effectivement
  // employé à l'inscription, pas un texte d'essai qui pourrait passer là où le
  // vrai serait refusé.
  const message = verificationEmail({
    to,
    code: '123456',
    firstName: 'Essai',
    expiresInMinutes: 15,
  });

  console.info(`→ Envoi à ${to}…`);
  const started = Date.now();
  try {
    await provider.send(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      `Envoi échoué après ${Date.now() - started} ms :\n    ${detail}\n\n` +
        "  · « ECONNREFUSED » : aucun serveur n'écoute à cette adresse.\n" +
        '  · « EAUTH » / 535 : identifiants du relais refusés.\n' +
        '  · « ETIMEDOUT » sur le port 25 : le fournisseur d’accès le bloque —\n' +
        '    passez par un relais authentifié sur le port 587.\n' +
        '  · « 550 » avec mention de SPF/DKIM : les enregistrements DNS du\n' +
        '    domaine ne couvrent pas encore ce relais.',
    );
  }

  console.info(`\n✓ Message accepté par ${provider.name} en ${Date.now() - started} ms.`);
  console.info('');
  console.info('  « Accepté » ne veut pas dire « arrivé » : un relais peut accepter');
  console.info('  puis classer le message en indésirable. Vérifiez la boîte de');
  console.info('  réception ET le dossier « courrier indésirable ».');
  if (env.EMAIL_PROVIDER === 'smtp' && /^(127\.|localhost)/.test(env.SMTP_HOST ?? '')) {
    console.info('');
    console.info('  Le message a été remis à Postfix, qui le relaiera à son tour :');
    console.info('    mailq                 # ce qui reste en file');
    console.info('    journalctl -u postfix -n 30');
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
