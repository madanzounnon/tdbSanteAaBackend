import { Request, Response } from 'express';
import { SinistraliteService } from './sinistralite.service';

const service = new SinistraliteService();

export const getSpPortefeuille = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getSpPortefeuille(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération S/P portefeuille' });
  }
};

export const getParNatureActe = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getParNatureActe(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur répartition par nature d\'acte' });
  }
};

export const getSpMensuel = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getSpMensuel(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération S/P mensuel' });
  }
};
