import { AppDataSource } from '../../data-source';
import { hacherMotDePasse, journaliser, motDePasseProvisoire } from '../auth/auth.service';
import { echapperHtml, emailConfigure, envoyerEmail, gabaritEmail } from '../commun/email';
import { ErreurDroits, verifierAdministrateurRestant } from '../droits/droits.service';

// Gestion des comptes du tableau de bord : création (mot de passe provisoire
// à changer à la 1re connexion), modification, activation / désactivation,
// déblocage après trop d'échecs, réinitialisation du mot de passe.
// Les comptes ne sont jamais supprimés : on les désactive (traçabilité des
// déclarations et du journal de connexion).

export class ErreurUtilisateur extends Error {
  constructor(message: string, public statut = 400) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texte = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// TypeORM + pg : UPDATE … RETURNING renvoie [lignes, nombre].
const lignesMaj = (r: any): any[] => (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r);

const COLONNES = `u.id, u.nom, u.prenom, u.sexe, u.email, u.telephone, u.fonction, u.actif,
  u.doit_changer_mot_de_passe, u.echecs_connexion, u.derniere_connexion, u.cree_le, u.modifie_le,
  u.mot_de_passe_modifie_le,
  (u.verrouille_jusqu_au IS NOT NULL AND u.verrouille_jusqu_au > now()) AS verrouille,
  CASE WHEN u.verrouille_jusqu_au > now() THEN u.verrouille_jusqu_au END AS verrouille_jusqu_au,
  COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nom', r.nom) ORDER BY lower(r.nom))
              FROM utilisateur_role ur JOIN role r ON r.id = ur.role_id
             WHERE ur.utilisateur_id = u.id), '[]') AS roles`;

// Identifiants de rôles reçus du formulaire (null = ne pas modifier).
const rolesDemandes = (b: any): number[] | null =>
  Array.isArray(b?.roleIds)
    ? ([...new Set(b.roleIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[])
    : null;

// Remplace les rôles d'un compte (dans une transaction).
const appliquerRoles = async (m: any, utilisateurId: number, roleIds: number[]) => {
  if (roleIds.length) {
    const [{ n }] = await m.query(`SELECT COUNT(*)::int AS n FROM role WHERE id = ANY($1::int[])`, [roleIds]);
    if (n !== roleIds.length) throw new ErreurUtilisateur('Rôle inconnu.');
  }
  await m.query(`DELETE FROM utilisateur_role WHERE utilisateur_id = $1`, [utilisateurId]);
  for (const roleId of roleIds) {
    await m.query(`INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2)`, [utilisateurId, roleId]);
  }
};

// Au moins un administrateur actif doit subsister après la modification.
const garderAdministrateur = async (m: any) => {
  try {
    await verifierAdministrateurRestant(m);
  } catch (err) {
    if (err instanceof ErreurDroits) throw new ErreurUtilisateur(err.message, 409);
    throw err;
  }
};

const valider = (b: any) => {
  const nom = texte(b?.nom, 100);
  const email = texte(b?.email, 150)?.toLowerCase() ?? null;
  if (!nom) throw new ErreurUtilisateur('Le nom est obligatoire.');
  if (!email || !EMAIL_RE.test(email)) throw new ErreurUtilisateur('Adresse email invalide.');
  const sexe = b?.sexe === 'M' || b?.sexe === 'F' ? b.sexe : null;
  if (!sexe) throw new ErreurUtilisateur('Le sexe est obligatoire (masculin ou féminin).');
  return {
    nom,
    prenom: texte(b?.prenom, 100),
    sexe,
    email,
    telephone: texte(b?.telephone, 30),
    fonction: texte(b?.fonction, 120),
  };
};

const emailDejaUtilise = (err: any) => err?.code === '23505';

export async function listUtilisateurs(f: { q?: string | null; statut?: string | null; role?: number | null }) {
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const lignes = await AppDataSource.query(
    `SELECT ${COLONNES}
       FROM utilisateur u
      WHERE ($1::text IS NULL OR lower(u.nom || ' ' || coalesce(u.prenom, '') || ' ' || u.email || ' ' || coalesce(u.fonction, '')) LIKE $1)
        AND (
          $2::text IS NULL
          OR ($2 = 'ACTIF' AND u.actif)
          OR ($2 = 'INACTIF' AND NOT u.actif)
          OR ($2 = 'VERROUILLE' AND u.verrouille_jusqu_au > now())
          OR ($2 = 'PREMIERE_CONNEXION' AND u.doit_changer_mot_de_passe AND u.actif)
          OR ($2 = 'SANS_ROLE' AND NOT EXISTS (SELECT 1 FROM utilisateur_role ur WHERE ur.utilisateur_id = u.id))
        )
        AND ($3::int IS NULL OR EXISTS (SELECT 1 FROM utilisateur_role ur WHERE ur.utilisateur_id = u.id AND ur.role_id = $3))
      ORDER BY u.actif DESC, lower(u.nom), lower(coalesce(u.prenom, ''))`,
    [q, f.statut || null, f.role ?? null],
  );
  const [stats] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE actif)::int AS actifs,
            COUNT(*) FILTER (WHERE NOT actif)::int AS inactifs,
            COUNT(*) FILTER (WHERE verrouille_jusqu_au > now())::int AS verrouilles,
            COUNT(*) FILTER (WHERE actif AND doit_changer_mot_de_passe)::int AS premiere_connexion,
            COUNT(*) FILTER (WHERE derniere_connexion >= now() - interval '30 days')::int AS connectes_30j,
            COUNT(*) FILTER (WHERE actif AND NOT EXISTS (SELECT 1 FROM utilisateur_role ur WHERE ur.utilisateur_id = utilisateur.id))::int AS sans_role
       FROM utilisateur`,
  );
  return { donnees: lignes, stats };
}

export async function getUtilisateur(id: number) {
  const [u] = await AppDataSource.query(`SELECT ${COLONNES} FROM utilisateur u WHERE u.id = $1`, [id]);
  if (!u) return null;
  const journal = await AppDataSource.query(
    `SELECT evenement, email, ip, cree_le FROM auth_journal WHERE utilisateur_id = $1 ORDER BY cree_le DESC LIMIT 30`,
    [id],
  );
  return { ...u, journal };
}

// Email d'accueil / de réinitialisation avec le mot de passe provisoire.
const envoyerIdentifiants = async (u: { email: string; nom: string; prenom: string | null }, mdp: string, creation: boolean) => {
  const lien = process.env.FRONTEND_URL?.replace(/\/+$/, '');
  const nom = echapperHtml([u.prenom, u.nom].filter(Boolean).join(' ') || 'Madame, Monsieur');
  const objet = creation ? 'Votre accès au tableau de bord' : 'Votre nouveau mot de passe provisoire';
  const phrase = creation
    ? 'Un compte vient de vous être ouvert sur le tableau de bord de L\'Africaine des Assurances.'
    : 'Votre mot de passe du tableau de bord a été réinitialisé par un administrateur.';
  await envoyerEmail({
    a: u.email,
    sujet: `${objet} — Tableau de bord`,
    texte:
      `Bonjour ${[u.prenom, u.nom].filter(Boolean).join(' ')},\n\n${phrase}\n\n` +
      `Identifiant : ${u.email}\nMot de passe provisoire : ${mdp}\n\n` +
      'À la connexion, un code de vérification vous sera envoyé par email, puis il vous sera demandé de choisir votre propre mot de passe.' +
      (lien ? `\n\nAdresse : ${lien}` : ''),
    html: gabaritEmail(
      objet,
      `<p>Bonjour ${nom},</p>
       <p>${echapperHtml(phrase)}</p>
       <table style="border-collapse:collapse;margin:12px 0">
         <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Identifiant</td><td style="font-weight:bold">${echapperHtml(u.email)}</td></tr>
         <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Mot de passe provisoire</td><td style="font-family:monospace;font-size:16px;font-weight:bold;letter-spacing:1px">${echapperHtml(mdp)}</td></tr>
       </table>
       <p>À la connexion, un code de vérification vous sera envoyé par email, puis il vous sera demandé de choisir votre propre mot de passe.</p>
       ${lien ? `<p><a href="${echapperHtml(lien)}" style="display:inline-block;background:#0b6e4f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Ouvrir le tableau de bord</a></p>` : ''}`,
    ),
  });
};

// Résultat de l'envoi éventuel des identifiants (affiché à l'administrateur).
const tenterEnvoi = async (u: any, mdp: string, creation: boolean, demande: boolean) => {
  if (!demande) return { emailEnvoye: false, emailErreur: null };
  if (!emailConfigure()) return { emailEnvoye: false, emailErreur: "L'envoi d'emails n'est pas configuré." };
  try {
    await envoyerIdentifiants(u, mdp, creation);
    return { emailEnvoye: true, emailErreur: null };
  } catch (err: any) {
    console.error('[UTILISATEURS] Envoi des identifiants :', err?.message);
    return { emailEnvoye: false, emailErreur: "L'email n'a pas pu être envoyé." };
  }
};

export async function createUtilisateur(body: any, par: { id: number; email: string }, ip?: string) {
  const v = valider(body);
  const mdp = motDePasseProvisoire();
  const hash = await hacherMotDePasse(mdp);
  const roleIds = rolesDemandes(body) ?? [];
  let ligne: any;
  try {
    ligne = await AppDataSource.transaction(async (m) => {
      const [l] = await m.query(
        `INSERT INTO utilisateur (nom, prenom, email, telephone, fonction, mot_de_passe_hash, doit_changer_mot_de_passe, sexe)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
         RETURNING id`,
        [v.nom, v.prenom, v.email, v.telephone, v.fonction, hash, v.sexe],
      );
      await appliquerRoles(m, l.id, roleIds);
      return l;
    });
  } catch (err) {
    if (emailDejaUtilise(err)) throw new ErreurUtilisateur('Un compte existe déjà avec cette adresse email.', 409);
    throw err;
  }
  journaliser('COMPTE_CREE', ip, ligne.id, par.email);
  const envoi = await tenterEnvoi(v, mdp, true, body?.envoyerEmail !== false);
  return { utilisateur: await getUtilisateur(ligne.id), motDePasseProvisoire: mdp, ...envoi };
}

// « gererRoles » : faux quand l'utilisateur modifie son propre compte sans
// le droit de gérer les utilisateurs (les rôles reçus sont alors ignorés).
export async function updateUtilisateur(
  id: number,
  body: any,
  par: { id: number; email: string },
  ip?: string,
  gererRoles = true,
) {
  const v = valider(body);
  const roleIds = gererRoles ? rolesDemandes(body) : null;
  let r: any;
  try {
    r = await AppDataSource.transaction(async (m) => {
      const lignes = lignesMaj(
        await m.query(
          `UPDATE utilisateur SET nom = $2, prenom = $3, email = $4, telephone = $5, fonction = $6, sexe = $7, modifie_le = now()
            WHERE id = $1 RETURNING id`,
          [id, v.nom, v.prenom, v.email, v.telephone, v.fonction, v.sexe],
        ),
      );
      if (lignes.length && roleIds) {
        await appliquerRoles(m, id, roleIds);
        await garderAdministrateur(m);
      }
      return lignes;
    });
  } catch (err) {
    if (emailDejaUtilise(err)) throw new ErreurUtilisateur('Un autre compte utilise déjà cette adresse email.', 409);
    throw err;
  }
  if (!r.length) return null;
  journaliser('COMPTE_MODIFIE', ip, id, par.email);
  return getUtilisateur(id);
}

export async function changerActif(id: number, actif: boolean, par: { id: number; email: string }, ip?: string) {
  if (!actif && id === par.id) throw new ErreurUtilisateur('Vous ne pouvez pas désactiver votre propre compte.');
  // Désactiver change aussi la version du mot de passe : les sessions en
  // cours de ce compte sont coupées immédiatement.
  const r = await AppDataSource.transaction(async (m) => {
    const lignes = lignesMaj(
      await m.query(
        `UPDATE utilisateur
            SET actif = $2, modifie_le = now(),
                mot_de_passe_modifie_le = CASE WHEN $2 THEN mot_de_passe_modifie_le ELSE now() END
          WHERE id = $1 RETURNING id`,
        [id, actif],
      ),
    );
    if (lignes.length && !actif) await garderAdministrateur(m);
    return lignes;
  });
  if (!r.length) return null;
  journaliser(actif ? 'COMPTE_ACTIVE' : 'COMPTE_DESACTIVE', ip, id, par.email);
  return getUtilisateur(id);
}

export async function debloquer(id: number, par: { id: number; email: string }, ip?: string) {
  const r = lignesMaj(
    await AppDataSource.query(
      `UPDATE utilisateur SET echecs_connexion = 0, verrouille_jusqu_au = NULL, modifie_le = now()
        WHERE id = $1 RETURNING id`,
      [id],
    ),
  );
  if (!r.length) return null;
  journaliser('COMPTE_DEBLOQUE', ip, id, par.email);
  return getUtilisateur(id);
}

export async function reinitialiser(id: number, body: any, par: { id: number; email: string }, ip?: string) {
  if (id === par.id) {
    throw new ErreurUtilisateur('Pour votre propre compte, utilisez « Changer mon mot de passe » dans votre profil.');
  }
  const mdp = motDePasseProvisoire();
  const hash = await hacherMotDePasse(mdp);
  const r = lignesMaj(
    await AppDataSource.query(
      `UPDATE utilisateur
          SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = TRUE, echecs_connexion = 0,
              verrouille_jusqu_au = NULL, mot_de_passe_modifie_le = now(), modifie_le = now()
        WHERE id = $1
      RETURNING id, email, nom, prenom`,
      [id, hash],
    ),
  );
  if (!r.length) return null;
  journaliser('MDP_REINITIALISE_ADMIN', ip, id, par.email);
  const envoi = await tenterEnvoi(r[0], mdp, false, body?.envoyerEmail !== false);
  return { utilisateur: await getUtilisateur(id), motDePasseProvisoire: mdp, ...envoi };
}
