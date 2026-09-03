import { Request, Response } from 'express';
import { ChiffreAffairesService } from './chiffre-affaires.service';

const service = new ChiffreAffairesService();

export const getKpis = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getKpis(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération KPIs CA' });
  }
};

export const getParCanal = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getParCanal(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération CA par canal' });
  }
};

export const getRepartitionParTranche = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getRepartitionParTranche(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur répartition par tranche de prime' });
  }
};
