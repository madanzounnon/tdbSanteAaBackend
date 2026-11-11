import { Request, Response, Router } from 'express';
import * as n from './notifications.service';
import { nomComplet } from '../auth/auth.service';

// /api/notifications — alertes email / SMS (anti-blanchiment, règlements
// de sinistres importants). Routes protégées par la session (app.ts).

const router = Router();

const auteur = (req: Request) => (req.utilisateur ? nomComplet(req.utilisateur).slice(0, 120) : null);

const id = (req: Request) => {
  const v = Number(req.params.id);
  if (!Number.isInteger(v) || v <= 0) throw new n.ErreurValidation(`Identifiant invalide : ${req.params.id}`);
  return v;
};

const traiter = (fn: (req: Request) => Promise<unknown>, statut = 200) => async (req: Request, res: Response) => {
  try {
    const resultat = await fn(req);
    if (resultat === null || resultat === false) {
      res.status(404).json({ error: 'Élément introuvable' });
      return;
    }
    res.status(statut).json(resultat ?? { ok: true });
  } catch (err: any) {
    if (err instanceof n.ErreurValidation) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof n.AnalyseEnCours) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error('[NOTIFICATIONS]', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

router.get('/etat', traiter(() => n.etat()));
router.post('/lancer', traiter((req) => n.lancerAnalyse('MANUEL', auteur(req))));

router.get('/parametres', traiter(() => n.getParametres()));
router.put('/parametres', traiter((req) => n.updateParametres(req.body ?? {}, auteur(req))));

router.get('/destinataires', traiter(() => n.listDestinataires()));
router.post('/destinataires', traiter((req) => n.createDestinataire(req.body ?? {}, auteur(req)), 201));
router.put('/destinataires/:id', traiter((req) => n.updateDestinataire(id(req), req.body ?? {})));
router.delete('/destinataires/:id', traiter((req) => n.deleteDestinataire(id(req))));
router.post('/destinataires/:id/test', traiter((req) => n.envoyerTest(id(req))));

router.get(
  '/envois',
  traiter((req) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const taille = Math.min(100, Math.max(1, Number(req.query.taille) || 15));
    const type = req.query.type === 'LBC' || req.query.type === 'SINISTRE' ? req.query.type : null;
    return n.listEnvois({ page, taille, type });
  }),
);
router.get('/envois/:id', traiter((req) => n.getEnvoi(id(req))));

// Centre d'alertes de l'utilisateur connecté (lu / non lu).
const moi = (req: Request) => {
  if (!req.utilisateur) throw new n.ErreurValidation('Session requise.');
  return req.utilisateur.id;
};
// Types d'alerte visibles selon les privilèges de l'utilisateur.
const types = (req: Request) => {
  const p = req.utilisateur?.privileges ?? [];
  return [...(p.includes('ALERTES_LBC') ? ['LBC'] : []), ...(p.includes('ALERTES_SINISTRES') ? ['SINISTRE'] : [])];
};
router.get(
  '/alertes',
  traiter((req) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const taille = Math.min(100, Math.max(1, Number(req.query.taille) || 15));
    const type = req.query.type === 'LBC' || req.query.type === 'SINISTRE' ? req.query.type : null;
    return n.listAlertes(moi(req), types(req), { page, taille, type, nonLues: req.query.nonLues === 'true' });
  }),
);
router.get('/alertes/resume', traiter((req) => n.resumeAlertes(moi(req), types(req))));
router.post('/alertes/tout-lu', traiter((req) => n.toutMarquerLu(moi(req), types(req))));
router.get('/alertes/:id', traiter((req) => n.ouvrirAlerte(moi(req), types(req), id(req))));
router.post('/alertes/:id/lu', traiter((req) => n.marquerLue(moi(req), types(req), id(req))));
router.delete('/alertes/:id/lu', traiter((req) => n.marquerNonLue(moi(req), id(req))));

export default router;
