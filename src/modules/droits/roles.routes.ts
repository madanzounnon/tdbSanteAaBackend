import { Request, Response, Router } from 'express';
import * as r from './roles.service';
import { ErreurDroits, exiger } from './droits.service';
import { nomComplet } from '../auth/auth.service';

// /api/roles — rôles et catalogue des privilèges.
// Lecture : gestion des rôles ou des utilisateurs (attribution des rôles).
// Modification : gestion des rôles uniquement.

const router = Router();

const id = (req: Request) => {
  const v = Number(req.params.id);
  if (!Number.isInteger(v) || v <= 0) throw new ErreurDroits(`Identifiant invalide : ${req.params.id}`);
  return v;
};

const traiter = (fn: (req: Request) => Promise<unknown>, statut = 200) => async (req: Request, res: Response) => {
  try {
    const resultat = await fn(req);
    if (resultat === null) {
      res.status(404).json({ error: 'Rôle introuvable' });
      return;
    }
    res.status(statut).json(resultat);
  } catch (err: any) {
    if (err instanceof ErreurDroits) {
      res.status(err.statut).json({ error: err.message });
      return;
    }
    console.error('[ROLES]', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

const lecture = exiger('ROLES_GERER', 'UTILISATEURS_GERER');
const ecriture = exiger('ROLES_GERER');

router.get('/', lecture, traiter(() => r.listRoles()));
router.get('/privileges', lecture, traiter(() => r.listPrivileges()));
router.post('/', ecriture, traiter((req) => r.createRole(req.body ?? {}, nomComplet(req.utilisateur!)), 201));
router.put('/:id', ecriture, traiter((req) => r.updateRole(id(req), req.body ?? {})));
router.delete('/:id', ecriture, traiter((req) => r.deleteRole(id(req))));

export default router;
