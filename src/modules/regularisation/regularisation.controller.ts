import { Request, Response } from 'express';
import { RegularisationService } from './regularisation.service';

const service = new RegularisationService();

export const getPolicesCritiques = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getPolicesCritiques(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération polices critiques' });
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
