import 'dotenv/config';
import { envoyerEmail, gabaritEmail } from '../modules/commun/email';

// Envoi d'un email de test avec la configuration SMTP du .env :
//   npm run email:test -- destinataire@exemple.com
const destinataire = process.argv[2];
if (!destinataire) {
  console.error('Usage : npm run email:test -- <email>');
  process.exit(1);
}
envoyerEmail({
  a: destinataire,
  sujet: 'Test des alertes — Tableau de bord',
  texte: "Bonjour,\n\nCeci est un email de test du tableau de bord de L'Africaine des Assurances : l'envoi des alertes et des codes de connexion fonctionne.",
  html: gabaritEmail(
    'Email de test',
    "<p>Bonjour,</p><p>Ceci est un email de test du tableau de bord de L'Africaine des Assurances : l'envoi des alertes et des codes de connexion fonctionne.</p>",
  ),
})
  .then(() => console.log(`Email de test envoyé à ${destinataire}`))
  .catch((e) => {
    console.error('Échec :', e?.code ?? '', e?.message ?? e);
    process.exit(1);
  });
