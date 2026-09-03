import { Request, Response } from 'express';
import { PrestatairesService } from './prestataires.service';

const service = new PrestatairesService();

export const getFacturesImpayees = async (_req: Request, res: Response) => {
  try {
    res.json(await service.getFacturesImpayees());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération factures impayées' });
  }
};

export const getPerformanceParExercice = async (_req: Request, res: Response) => {
  try {
    res.json(await service.getPerformanceParExercice());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération performance prestataires' });
  }
};
