import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '../../data-source';
import { envoyerCodeOtp, ObjetOtp } from './mailer';
import { droitsUtilisateur } from '../droits/droits.service';

// Authentification en deux étapes :
//   1. email + mot de passe  -> un code OTP est envoyé par email, le frontend
//      reçoit un "défi" (identifiant opaque du code) ;
//   2. défi + code           -> jeton JWT de session.
// Mot de passe oublié : email -> code OTP -> nouveau mot de passe.

export class ErreurAuth extends Error {
  constructor(message: string, public statut = 400, public code?: string) {
    super(message);
  }
}

const OTP_DUREE_MINUTES = 10;
const OTP_TENTATIVES_MAX = 5;
const OTP_DELAI_RENVOI_SECONDES = 60;
const ECHECS_AVANT_VERROUILLAGE = 5;
const VERROUILLAGE_MINUTES = 15;
const JETON_FICHIER_DUREE = '2m';

// ------------------------------------------------------------------ JWT
const secretJwt = (() => {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET manquant ou trop court (32 caractères minimum)');
  }
  console.warn('[AUTH] JWT_SECRET absent : secret temporaire (les sessions sont perdues au redémarrage de l\'API).');
  return crypto.randomBytes(48).toString('hex');
})();

const DUREE_SESSION = (process.env.JWT_DUREE || '8h') as jwt.SignOptions['expiresIn'];

type TypeJeton = 'session' | 'fichier';

// Le jeton porte la date du dernier changement de mot de passe (mdp) :
// changer ou réinitialiser le mot de passe invalide toutes les sessions.
const versionMdp = (u: { mot_de_passe_modifie_le: Date }) => new Date(u.mot_de_passe_modifie_le).getTime();

const signer = (u: LigneUtilisateur, type: TypeJeton, expiresIn: jwt.SignOptions['expiresIn']) =>
  jwt.sign({ sub: String(u.id), typ: type, mdp: versionMdp(u) }, secretJwt, { expiresIn });

export const verifierJeton = (jeton: string): { utilisateurId: number; type: TypeJeton; mdp: number } => {
  const charge = jwt.verify(jeton, secretJwt) as jwt.JwtPayload;
  return { utilisateurId: Number(charge.sub), type: charge.typ, mdp: Number(charge.mdp) };
};

// Jeton très court pour ouvrir un PDF / une pièce dans un nouvel onglet
// (un lien ne peut pas porter l'en-tête Authorization).
export const jetonFichier = async (utilisateurId: number) => {
  const u = await parId(utilisateurId);
  if (!u) throw new ErreurAuth('Utilisateur introuvable.', 401);
  return signer(u, 'fichier', JETON_FICHIER_DUREE);
};

// ----------------------------------------------------------- Utilisateur
export interface UtilisateurConnecte {
  id: number;
  nom: string;
  prenom: string | null;
  email: string;
  telephone: string | null;
  fonction: string | null;
  doitChangerMotDePasse: boolean;
  // Droits d'accès (union des rôles), relus à chaque requête : un changement
  // de rôle s'applique sans reconnexion.
  roles: { id: number; nom: string }[];
  privileges: string[];
}

interface LigneUtilisateur {
  id: number;
  nom: string;
  prenom: string | null;
  email: string;
  telephone: string | null;
  fonction: string | null;
  mot_de_passe_hash: string;
  actif: boolean;
  doit_changer_mot_de_passe: boolean;
  echecs_connexion: number;
  verrouille_jusqu_au: Date | null;
  mot_de_passe_modifie_le: Date;
}

const versPublic = async (u: LigneUtilisateur): Promise<UtilisateurConnecte> => ({
  id: u.id,
  nom: u.nom,
  prenom: u.prenom,
  email: u.email,
  telephone: u.telephone,
  fonction: u.fonction,
  doitChangerMotDePasse: u.doit_changer_mot_de_passe,
  ...(await droitsUtilisateur(u.id)),
});

export const nomComplet = (u: Pick<UtilisateurConnecte, 'nom' | 'prenom'>) => [u.prenom, u.nom].filter(Boolean).join(' ');

const parEmail = async (email: string): Promise<LigneUtilisateur | null> => {
  const [u] = await AppDataSource.query(`SELECT * FROM utilisateur WHERE lower(email) = lower($1)`, [email.trim()]);
  return u ?? null;
};

const parId = async (id: number): Promise<LigneUtilisateur | null> => {
  const [u] = await AppDataSource.query(`SELECT * FROM utilisateur WHERE id = $1`, [id]);
  return u ?? null;
};

// Utilisateur d'une requête authentifiée : compte toujours actif et jeton
// émis après le dernier changement de mot de passe.
export const utilisateurDuJeton = async (jeton: string, typeAttendu: TypeJeton): Promise<UtilisateurConnecte> => {
  let charge;
  try {
    charge = verifierJeton(jeton);
  } catch (err: any) {
    throw new ErreurAuth(
      err?.name === 'TokenExpiredError' ? 'Votre session a expiré, veuillez vous reconnecter.' : 'Session invalide, veuillez vous reconnecter.',
      401,
    );
  }
  if (charge.type !== typeAttendu) throw new ErreurAuth('Session invalide, veuillez vous reconnecter.', 401);
  const u = await parId(charge.utilisateurId);
  if (!u || !u.actif) throw new ErreurAuth('Compte inexistant ou désactivé.', 401);
  if (charge.mdp !== versionMdp(u)) {
    throw new ErreurAuth('Votre mot de passe a changé, veuillez vous reconnecter.', 401);
  }
  return versPublic(u);
};

// ------------------------------------------------------------ Mot de passe
export const verifierRegleMotDePasse = (mdp: unknown): string => {
  if (typeof mdp !== 'string' || mdp.length < 8) throw new ErreurAuth('Le mot de passe doit contenir au moins 8 caractères.');
  if (mdp.length > 72) throw new ErreurAuth('Le mot de passe ne doit pas dépasser 72 caractères.');
  if (!/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) {
    throw new ErreurAuth('Le mot de passe doit contenir au moins une lettre et un chiffre.');
  }
  return mdp;
};

export const hacherMotDePasse = (mdp: string) => bcrypt.hash(mdp, 10);

// Mot de passe provisoire (création de compte, réinitialisation par un
// administrateur) : lettres et chiffres sans caractères ambigus (0/O, 1/l/I),
// au moins une lettre et un chiffre.
export const motDePasseProvisoire = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let mdp = '';
  while (!/\d/.test(mdp) || !/[A-Za-z]/.test(mdp)) {
    mdp = Array.from({ length: 12 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  }
  return mdp;
};

// Hachage factice : même temps de réponse que l'email existe ou non.
const HASH_FACTICE = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

// --------------------------------------------------------------- Journal
export const journaliser = (evenement: string, ip: string | undefined, utilisateurId: number | null, email?: string) =>
  AppDataSource.query(`INSERT INTO auth_journal (utilisateur_id, email, evenement, ip) VALUES ($1, $2, $3, $4)`, [
    utilisateurId,
    email?.slice(0, 150) ?? null,
    evenement,
    ip?.slice(0, 64) ?? null,
  ]).catch((err) => console.error('[AUTH] Journal :', err.message));

// ------------------------------------------------------------------- OTP
const masquerEmail = (email: string) => {
  const [local, domaine] = email.split('@');
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}@${domaine}`;
};

const creerEtEnvoyerOtp = async (u: LigneUtilisateur, objet: ObjetOtp): Promise<string> => {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  // Un seul code valide à la fois par objet.
  await AppDataSource.query(
    `UPDATE auth_otp SET utilise_le = now() WHERE utilisateur_id = $1 AND objet = $2 AND utilise_le IS NULL`,
    [u.id, objet],
  );
  const [{ id }] = await AppDataSource.query(
    `INSERT INTO auth_otp (utilisateur_id, objet, code_hash, expire_le)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id`,
    [u.id, objet, await bcrypt.hash(code, 10), OTP_DUREE_MINUTES],
  );
  try {
    await envoyerCodeOtp({ email: u.email, nom: nomComplet(u) }, code, objet, OTP_DUREE_MINUTES);
  } catch (err: any) {
    await AppDataSource.query(`DELETE FROM auth_otp WHERE id = $1`, [id]);
    console.error('[AUTH] Envoi email OTP :', err?.message ?? err);
    throw new ErreurAuth("L'email contenant le code n'a pas pu être envoyé. Réessayez plus tard ou contactez l'administrateur.", 503);
  }
  return id;
};

// TypeORM (pilote pg) : un UPDATE ... RETURNING renvoie [lignes, nombre].
const lignesMaj = (resultat: any): any[] => (Array.isArray(resultat?.[0]) ? resultat[0] : resultat);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Vérifie le code d'un défi ; renvoie l'utilisateur et marque le code utilisé.
const consommerOtp = async (defi: unknown, code: unknown, objet: ObjetOtp): Promise<LigneUtilisateur> => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    throw new ErreurAuth('Le code doit contenir exactement 6 chiffres.');
  }
  const invalide = new ErreurAuth('Code incorrect ou expiré. Demandez un nouveau code.');
  if (typeof defi !== 'string' || !UUID.test(defi)) throw invalide;

  const [otp] = await AppDataSource.query(
    `SELECT id, utilisateur_id, code_hash, tentatives, (expire_le < now()) AS expire
       FROM auth_otp WHERE id = $1 AND objet = $2 AND utilise_le IS NULL`,
    [defi, objet],
  );
  if (!otp || otp.expire || otp.tentatives >= OTP_TENTATIVES_MAX) throw invalide;

  if (!(await bcrypt.compare(code.trim(), otp.code_hash))) {
    const [{ tentatives }] = lignesMaj(
      await AppDataSource.query(`UPDATE auth_otp SET tentatives = tentatives + 1 WHERE id = $1 RETURNING tentatives`, [otp.id]),
    );
    const restantes = OTP_TENTATIVES_MAX - tentatives;
    throw new ErreurAuth(
      restantes > 0
        ? `Code incorrect. ${restantes} tentative${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}.`
        : 'Code incorrect. Nombre de tentatives dépassé : demandez un nouveau code.',
    );
  }

  // Marquage conditionnel : un même code ne sert qu'une fois, même en cas
  // de double soumission simultanée.
  const marques = lignesMaj(
    await AppDataSource.query(`UPDATE auth_otp SET utilise_le = now() WHERE id = $1 AND utilise_le IS NULL RETURNING id`, [otp.id]),
  );
  if (!marques.length) throw invalide;

  const u = await parId(otp.utilisateur_id);
  if (!u || !u.actif) throw invalide;
  return u;
};

// ------------------------------------------------------------- Connexion
export const connexion = async (email: unknown, motDePasse: unknown, ip?: string) => {
  if (typeof email !== 'string' || !email.trim() || typeof motDePasse !== 'string' || !motDePasse) {
    throw new ErreurAuth('Email et mot de passe requis.');
  }
  const refus = new ErreurAuth('Email ou mot de passe incorrect.', 401);
  const u = await parEmail(email);

  if (!u) {
    await bcrypt.compare(motDePasse, HASH_FACTICE);
    journaliser('ECHEC_EMAIL_INCONNU', ip, null, email);
    throw refus;
  }
  if (u.verrouille_jusqu_au && new Date(u.verrouille_jusqu_au) > new Date()) {
    const minutes = Math.ceil((new Date(u.verrouille_jusqu_au).getTime() - Date.now()) / 60000);
    throw new ErreurAuth(`Compte temporairement verrouillé après plusieurs échecs. Réessayez dans ${minutes} min.`, 423);
  }
  if (!(await bcrypt.compare(motDePasse, u.mot_de_passe_hash))) {
    await AppDataSource.query(
      `UPDATE utilisateur
          SET echecs_connexion = echecs_connexion + 1,
              verrouille_jusqu_au = CASE WHEN echecs_connexion + 1 >= $2
                                         THEN now() + make_interval(mins => $3) END
        WHERE id = $1`,
      [u.id, ECHECS_AVANT_VERROUILLAGE, VERROUILLAGE_MINUTES],
    );
    journaliser('ECHEC_MOT_DE_PASSE', ip, u.id, u.email);
    throw refus;
  }
  if (!u.actif) {
    journaliser('REFUS_COMPTE_INACTIF', ip, u.id, u.email);
    throw new ErreurAuth('Votre compte est désactivé. Contactez un administrateur.', 403);
  }

  await AppDataSource.query(`UPDATE utilisateur SET echecs_connexion = 0, verrouille_jusqu_au = NULL WHERE id = $1`, [u.id]);
  const defi = await creerEtEnvoyerOtp(u, 'CONNEXION');
  return { defi, email: masquerEmail(u.email), delaiRenvoi: OTP_DELAI_RENVOI_SECONDES, dureeCode: OTP_DUREE_MINUTES };
};

export const verifierOtpConnexion = async (defi: unknown, code: unknown, ip?: string) => {
  const u = await consommerOtp(defi, code, 'CONNEXION');
  await AppDataSource.query(`UPDATE utilisateur SET derniere_connexion = now() WHERE id = $1`, [u.id]);
  journaliser('CONNEXION', ip, u.id, u.email);
  return { jeton: signer(u, 'session', DUREE_SESSION), utilisateur: await versPublic(u) };
};

// Nouveau code pour le même utilisateur et le même objet (ancien invalidé).
export const renvoyerOtp = async (defi: unknown) => {
  const objetInvalide = new ErreurAuth('Demande expirée : recommencez depuis le début.');
  if (typeof defi !== 'string' || !UUID.test(defi)) throw objetInvalide;
  const [otp] = await AppDataSource.query(
    `SELECT utilisateur_id, objet, EXTRACT(EPOCH FROM (now() - cree_le))::int AS age
       FROM auth_otp WHERE id = $1 AND cree_le > now() - interval '1 hour'`,
    [defi],
  );
  if (!otp) throw objetInvalide;
  if (otp.age < OTP_DELAI_RENVOI_SECONDES) {
    throw new ErreurAuth(`Patientez ${OTP_DELAI_RENVOI_SECONDES - otp.age} s avant de demander un nouveau code.`, 429);
  }
  const u = await parId(otp.utilisateur_id);
  if (!u || !u.actif) throw objetInvalide;
  return { defi: await creerEtEnvoyerOtp(u, otp.objet), delaiRenvoi: OTP_DELAI_RENVOI_SECONDES };
};

// ------------------------------------------------------ Mot de passe oublié
// Réponse identique que l'email existe ou non (pas de divulgation des
// comptes) : pour un email inconnu, le défi est un UUID qui ne correspond
// à aucun code.
export const motDePasseOublie = async (email: unknown, ip?: string) => {
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) throw new ErreurAuth('Email invalide.');
  const reponse = (defi: string) => ({ defi, delaiRenvoi: OTP_DELAI_RENVOI_SECONDES, dureeCode: OTP_DUREE_MINUTES });

  const u = await parEmail(email);
  if (!u || !u.actif) {
    journaliser('OUBLI_EMAIL_INCONNU', ip, u?.id ?? null, email);
    return reponse(crypto.randomUUID());
  }
  const [recent] = await AppDataSource.query(
    `SELECT id FROM auth_otp
      WHERE utilisateur_id = $1 AND objet = 'REINITIALISATION' AND utilise_le IS NULL
        AND cree_le > now() - make_interval(secs => $2)`,
    [u.id, OTP_DELAI_RENVOI_SECONDES],
  );
  if (recent) return reponse(recent.id);

  journaliser('OUBLI_CODE_ENVOYE', ip, u.id, u.email);
  return reponse(await creerEtEnvoyerOtp(u, 'REINITIALISATION'));
};

export const reinitialiserMotDePasse = async (defi: unknown, code: unknown, nouveau: unknown, ip?: string) => {
  const mdp = verifierRegleMotDePasse(nouveau);
  const u = await consommerOtp(defi, code, 'REINITIALISATION');
  await AppDataSource.query(
    `UPDATE utilisateur
        SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = FALSE, echecs_connexion = 0,
            verrouille_jusqu_au = NULL, mot_de_passe_modifie_le = now(), modifie_le = now()
      WHERE id = $1`,
    [u.id, await hacherMotDePasse(mdp)],
  );
  await AppDataSource.query(`UPDATE auth_otp SET utilise_le = now() WHERE utilisateur_id = $1 AND utilise_le IS NULL`, [u.id]);
  journaliser('MOT_DE_PASSE_REINITIALISE', ip, u.id, u.email);
};

// --------------------------------------------- Changement de mot de passe
// L'ancien mot de passe n'est pas redemandé lors du changement imposé à la
// première connexion (l'utilisateur vient de le saisir, puis le code OTP).
export const changerMotDePasse = async (utilisateurId: number, ancien: unknown, nouveau: unknown, ip?: string) => {
  const mdp = verifierRegleMotDePasse(nouveau);
  const u = await parId(utilisateurId);
  if (!u) throw new ErreurAuth('Utilisateur introuvable.', 404);
  if (!u.doit_changer_mot_de_passe) {
    if (typeof ancien !== 'string' || !(await bcrypt.compare(ancien, u.mot_de_passe_hash))) {
      throw new ErreurAuth('Ancien mot de passe incorrect.');
    }
  }
  if (await bcrypt.compare(mdp, u.mot_de_passe_hash)) {
    throw new ErreurAuth("Le nouveau mot de passe doit être différent de l'ancien.");
  }
  await AppDataSource.query(
    `UPDATE utilisateur
        SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = FALSE,
            mot_de_passe_modifie_le = now(), modifie_le = now()
      WHERE id = $1`,
    [u.id, await hacherMotDePasse(mdp)],
  );
  journaliser('MOT_DE_PASSE_CHANGE', ip, u.id, u.email);
  // Le jeton précédent est invalidé par le changement : on en renvoie un neuf.
  const maj = (await parId(u.id))!;
  return { jeton: signer(maj, 'session', DUREE_SESSION), utilisateur: await versPublic(maj) };
};

export const deconnexion = (u: UtilisateurConnecte, ip?: string) => journaliser('DECONNEXION', ip, u.id, u.email);
