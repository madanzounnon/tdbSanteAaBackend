import { NextFunction, Request, Response, Router } from 'express';
import * as auth from './auth.service';
import { exigerSession } from './auth.middleware';

const router = Router();

const ip = (req: Request) => req.ip || req.socket.remoteAddress || undefined;

const traiter = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
  try {
    const resultat = await fn(req);
    res.json(resultat ?? { ok: true });
  } catch (err) {
    if (err instanceof auth.ErreurAuth) {
      res.status(err.statut).json({ error: err.message, code: err.code });
      return;
    }
    console.error('[AUTH]', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
};

// Limite simple par adresse IP sur les routes publiques (essais de mots de
// passe et de codes en rafale). En mémoire : suffisant pour une instance.
const limiter = (max: number, fenetreMinutes: number) => {
  const compteurs = new Map<string, { n: number; fin: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const cle = `${ip(req)}`;
    const maintenant = Date.now();
    const c = compteurs.get(cle);
    if (!c || c.fin < maintenant) {
      compteurs.set(cle, { n: 1, fin: maintenant + fenetreMinutes * 60000 });
      if (compteurs.size > 10000) {
        for (const [k, v] of compteurs) if (v.fin < maintenant) compteurs.delete(k);
      }
      return next();
    }
    if (++c.n > max) {
      res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
      return;
    }
    next();
  };
};

const limitePublique = limiter(30, 15);

router.post('/connexion', limitePublique, traiter((req) => auth.connexion(req.body?.email, req.body?.motDePasse, ip(req))));
router.post('/verifier-otp', limitePublique, traiter((req) => auth.verifierOtpConnexion(req.body?.defi, req.body?.code, ip(req))));
router.post('/renvoyer-otp', limitePublique, traiter((req) => auth.renvoyerOtp(req.body?.defi)));
router.post('/mot-de-passe-oublie', limitePublique, traiter((req) => auth.motDePasseOublie(req.body?.email, ip(req))));
router.post(
  '/reinitialiser-mot-de-passe',
  limitePublique,
  traiter(async (req) => {
    await auth.reinitialiserMotDePasse(req.body?.defi, req.body?.code, req.body?.nouveauMotDePasse, ip(req));
    return { message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' };
  }),
);

router.get('/moi', exigerSession, traiter(async (req) => ({ utilisateur: req.utilisateur })));
router.post(
  '/changer-mot-de-passe',
  exigerSession,
  traiter((req) => auth.changerMotDePasse(req.utilisateur!.id, req.body?.ancienMotDePasse, req.body?.nouveauMotDePasse, ip(req))),
);
router.post('/jeton-fichier', exigerSession, traiter(async (req) => ({ jeton: await auth.jetonFichier(req.utilisateur!.id) })));
router.post('/deconnexion', exigerSession, traiter(async (req) => auth.deconnexion(req.utilisateur!, ip(req))));

export default router;
