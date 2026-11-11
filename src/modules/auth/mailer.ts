import { echapperHtml, emailConfigure, envoyerEmail, gabaritEmail } from '../commun/email';

// Envoi des codes OTP par email (SMTP configuré dans .env).
// Sans SMTP_HOST, en développement uniquement, le code est écrit dans la
// console de l'API pour pouvoir tester ; en production l'envoi échoue.

const OBJETS = {
  CONNEXION: {
    sujet: 'Votre code de connexion',
    phrase: 'Voici votre code de vérification pour vous connecter au tableau de bord :',
  },
  REINITIALISATION: {
    sujet: 'Réinitialisation de votre mot de passe',
    phrase: 'Voici votre code pour réinitialiser votre mot de passe :',
  },
} as const;

export type ObjetOtp = keyof typeof OBJETS;

export const envoyerCodeOtp = async (
  destinataire: { email: string; nom: string },
  code: string,
  objet: ObjetOtp,
  dureeMinutes: number,
): Promise<void> => {
  const { sujet, phrase } = OBJETS[objet];

  if (!emailConfigure()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP non configuré (SMTP_HOST manquant)');
    }
    console.warn(`[AUTH] SMTP non configuré — code ${objet} pour ${destinataire.email} : ${code}`);
    return;
  }

  const nom = echapperHtml(destinataire.nom || 'Madame, Monsieur');
  await envoyerEmail({
    a: destinataire.email,
    sujet: `${sujet} — Tableau de bord`,
    texte:
      `Bonjour ${destinataire.nom},\n\n${phrase}\n\n${code}\n\n` +
      `Ce code est valable ${dureeMinutes} minutes. Ne le communiquez à personne.\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    html: gabaritEmail(
      sujet,
      `<p>Bonjour ${nom},</p>
       <p>${phrase}</p>
       <p style="font-size:28px;font-weight:bold;letter-spacing:8px;text-align:center;color:#0b6e4f;margin:24px 0">${code}</p>
       <p>Ce code est valable <strong>${dureeMinutes} minutes</strong>. Ne le communiquez à personne.</p>
       <p style="color:#6b7280;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
    ),
  });
};
