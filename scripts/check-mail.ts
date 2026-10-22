import 'dotenv/config';
import nodemailer from 'nodemailer';
import { validateEnvironment } from '../src/config/environment';

// Vérifie uniquement le compte expéditeur. Aucun mot de passe, destinataire ou lien n'est journalisé.
async function main() {
  const config = validateEnvironment(process.env);
  if (
    !config.MAIL_ENABLED ||
    !config.SMTP_HOST ||
    !config.SMTP_USER ||
    !config.SMTP_PASSWORD ||
    !config.MAIL_FROM ||
    !config.MAIL_ENCRYPTION_KEY
  )
    throw new Error('Configuration e-mail incomplète');
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
  });
  try {
    await transport.verify();
    if (process.argv.includes('--send-self')) {
      await transport.sendMail({
        from: { name: 'Gaindé Sportif', address: config.MAIL_FROM },
        to: config.MAIL_FROM,
        subject: 'Test de la messagerie Gaindé Sportif',
        text: 'Ce message technique confirme que le compte expéditeur peut envoyer un e-mail. Aucun compte client ni demande commerciale n’a été créé.',
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      process.stdout.write(
        'MAIL_SELF_TEST_ACCEPTED : message de test accepté par Gmail. Vérifiez sa réception dans la boîte de l’expéditeur.\n',
      );
    } else
      process.stdout.write(
        'MAIL_CONNECTION_OK : connexion SMTP authentifiée. Aucun e-mail envoyé.\n',
      );
  } finally {
    transport.close();
  }
}
main().catch(() => {
  process.stderr.write(
    'MAIL_CHECK_FAILED : vérifiez les variables privées, le mot de passe d’application et la connexion réseau.\n',
  );
  process.exitCode = 1;
});
