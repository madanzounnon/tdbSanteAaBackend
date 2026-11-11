import { Request, Response, Router } from 'express';
import * as u from './utilisateurs.service';
import { aUnDe, exiger } from '../droits/droits.service';

// /api/utilisateurs — gestion des comptes (privilège UTILISATEURS_GERER).
// Exception : chacun peut lire et modifier les informations de son propre
// compte (page « Mon compte »), sans toucher à ses rôles.

const router = Router();

const id = (req: Request) => {
  const v = Number(req.params.id);
  if (!Number.isInteger(v) || v <= 0) throw new u.ErreurUtilisateur(`Identifiant invalide : ${req.params.id}`);
  return v;
};

const auteur = (req: Request) => {
  if (!req.utilisateur) throw new u.ErreurUtilisateur('Session requise.', 401);
  return { id: req.utilisateur.id, email: req.utilisateur.email };
};

const traiter = (fn: (req: Request) => Promise<unknown>, statut = 200) => async (req: Request, res: Response) => {
  try {
    const resultat = await fn(req);
    if (resultat === null) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }
    res.status(statut).json(resultat);
  } catch (err: any) {
    if (err instanceof u.ErreurUtilisateur) {
      res.status(err.statut).json({ error: err.message });
      return;
    }
    console.error('[UTILISATEURS]', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

const STATUTS = ['ACTIF', 'INACTIF', 'VERROUILLE', 'PREMIERE_CONNEXION', 'SANS_ROLE'];

const GERER = 'UTILISATEURS_GERER';
const gestion = exiger(GERER);
const gestionnaire = (req: Request) => aUnDe(req, [GERER]);
// Son propre compte, ou le droit de gérer les comptes.
const soiOuGestion = (req: Request, res: Response, next: () => void) => {
  if (gestionnaire(req) || Number(req.params.id) === req.utilisateur?.id) return next();
  res.status(403).json({ error: "Vous n'avez pas les droits nécessaires pour cette action.", code: 'ACCES_REFUSE' });
};

router.get(
  '/',
  gestion,
  traiter((req) =>
    u.listUtilisateurs({
      q: typeof req.query.q === 'string' ? req.query.q : null,
      statut: STATUTS.includes(String(req.query.statut)) ? String(req.query.statut) : null,
      role: Number(req.query.role) > 0 ? Number(req.query.role) : null,
    }),
  ),
);
router.get('/:id', soiOuGestion, traiter((req) => u.getUtilisateur(id(req))));
router.post('/', gestion, traiter((req) => u.createUtilisateur(req.body ?? {}, auteur(req), req.ip), 201));
router.put(
  '/:id',
  soiOuGestion,
  traiter((req) => u.updateUtilisateur(id(req), req.body ?? {}, auteur(req), req.ip, gestionnaire(req))),
);
router.patch(
  '/:id/actif',
  gestion,
  traiter((req) => u.changerActif(id(req), req.body?.actif === true, auteur(req), req.ip)),
);
router.post('/:id/debloquer', gestion, traiter((req) => u.debloquer(id(req), auteur(req), req.ip)));
router.post('/:id/reinitialiser', gestion, traiter((req) => u.reinitialiser(id(req), req.body ?? {}, auteur(req), req.ip)));

export default router;
