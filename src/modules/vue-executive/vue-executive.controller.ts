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

export const getTendanceN1 = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const data = await service.getTendanceN1(exercice);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération tendance vs N-1' });
  }
};

export const getSpParTypeCanal = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getSpParTypeCanal(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération S/P par type de canal' });
  }
};

export const getProjectionAnnuelle = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const data = await service.getProjectionAnnuelle(exercice);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération projection annuelle' });
  }
};
