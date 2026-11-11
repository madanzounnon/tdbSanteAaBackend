import { NextFunction, Request, Response } from 'express';
import { ErreurAuth, UtilisateurConnecte, utilisateurDuJeton } from './auth.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: UtilisateurConnecte;
    }
  }
}

const jetonEnTete = (req: Request) => {
  const entete = req.header('authorization') ?? '';
  const [schema, jeton] = entete.split(' ');
  return schema?.toLowerCase() === 'bearer' && jeton && jeton !== 'null' ? jeton : null;
};

const repondre = (res: Response, err: unknown) => {
  if (err instanceof ErreurAuth) {
    return res.status(err.statut).json({ error: err.message, code: err.code });
  }
  console.error('[AUTH]', err);
  return res.status(500).json({ error: 'Erreur interne du serveur' });
};

// Exige une session valide. Pour un GET, accepte aussi un jeton "fichier"
// de courte durée en paramètre ?jeton= (PDF / pièces ouverts dans un onglet).
// Un compte qui doit changer son mot de passe n'accède qu'aux routes d'auth.
export const exigerAuthentification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const enTete = jetonEnTete(req);
    const parametre = req.method === 'GET' && typeof req.query.jeton === 'string' ? req.query.jeton : null;
    if (!enTete && !parametre) throw new ErreurAuth('Authentification requise.', 401);

    const utilisateur = enTete
      ? await utilisateurDuJeton(enTete, 'session')
      : await utilisateurDuJeton(parametre!, 'fichier');

    if (utilisateur.doitChangerMotDePasse) {
      throw new ErreurAuth('Vous devez changer votre mot de passe avant de continuer.', 403, 'CHANGEMENT_MOT_DE_PASSE_REQUIS');
    }
    req.utilisateur = utilisateur;
    next();
  } catch (err) {
    repondre(res, err);
  }
};

// Variante pour les routes d'auth accessibles pendant le changement imposé
// du mot de passe (moi, changement, déconnexion).
export const exigerSession = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const jeton = jetonEnTete(req);
    if (!jeton) throw new ErreurAuth('Authentification requise.', 401);
    req.utilisateur = await utilisateurDuJeton(jeton, 'session');
    next();
  } catch (err) {
    repondre(res, err);
  }
};
