import nodemailer, { Transporter } from 'nodemailer';

// Envoi d'emails par SMTP (variables SMTP_* du .env), partagé par
// l'authentification (codes OTP) et les alertes.

let transporteur: Transporter | null = null;

export const emailConfigure = () => !!process.env.SMTP_HOST;

const obtenirTransporteur = (): Transporter => {
  if (transporteur) return transporteur;
  const port = Number(process.env.SMTP_PORT) || 587;
  // SMTP_TLS : STARTTLS (défaut, port 587 — Office 365), SSL (TLS implicite,
  // port 465) ou AUCUN (déconseillé). Dans tous les cas chiffrés : TLS 1.2 minimum.
  const modeTls = (process.env.SMTP_TLS || (port === 465 ? 'SSL' : 'STARTTLS')).toUpperCase();
  transporteur = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: modeTls === 'SSL',
    requireTLS: modeTls === 'STARTTLS',
    ignoreTLS: modeTls === 'AUCUN',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    tls: {
      minVersion: 'TLSv1.2',
      servername: process.env.SMTP_HOST,
      // SMTP_IGNORER_CERTIFICAT=true (temporaire, accepté le 2026-11-09 pour
      // un certificat expiré) désactive la vérification du certificat.
      rejectUnauthorized: process.env.SMTP_IGNORER_CERTIFICAT !== 'true',
    },
  });
  if (process.env.SMTP_IGNORER_CERTIFICAT === 'true') {
    console.warn('[EMAIL] Vérification du certificat SMTP désactivée (SMTP_IGNORER_CERTIFICAT=true) — à retirer après renouvellement.');
  }
  return transporteur;
};

export interface Email {
  a: string | string[];
  sujet: string;
  texte: string;
  html?: string;
}

export const envoyerEmail = async ({ a, sujet, texte, html }: Email): Promise<void> => {
  if (!emailConfigure()) throw new Error('SMTP non configuré (SMTP_HOST manquant)');
  await obtenirTransporteur().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: a,
    subject: sujet,
    text: texte,
    html,
  });
};

export const echapperHtml = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Gabarit commun : bandeau vert L'Africaine, contenu, pied.
export const gabaritEmail = (titre: string, contenu: string) => `
  <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#1f2937">
    <div style="background:#052e22;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
      <div style="font-weight:bold">L'Africaine des Assurances — Tableau de bord</div>
      <div style="color:#f2e94e;font-size:14px;margin-top:4px">${echapperHtml(titre)}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      ${contenu}
    </div>
  </div>`;
