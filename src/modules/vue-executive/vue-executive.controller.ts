import { Request, Response } from 'express';
import { VueExecutiveService } from './vue-executive.service';

const service = new VueExecutiveService();

export const getSynthese = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const data = await service.getSynthese(exercice);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération synthèse Vue Exécutive' });
  }
};
