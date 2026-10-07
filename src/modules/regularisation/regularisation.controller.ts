import { Request, Response } from 'express';
import { RegularisationService } from './regularisation.service';

const service = new RegularisationService();

export const getPolicesCritiques = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const page = Math.max(1, Number(req.query.page) || 1);
    const taille = Math.min(100, Math.max(1, Number(req.query.taille) || 15));
    res.json(await service.getPolicesCritiques(exercice, page, taille));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération polices critiques' });
  }
};

export const getPolicesParStatut = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getPolicesParStatut(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération polices par statut' });
  }
};

export const getTauxRegularisationComplete = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getTauxRegularisationComplete(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération taux de régularisation complété' });
  }
};

export const getMontantsARegulariser = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getMontantsARegulariser(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération montants à régulariser' });
  }
};

export const getSuiviParCanal = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getSuiviParCanal(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur suivi encaissement par canal' });
  }
};
