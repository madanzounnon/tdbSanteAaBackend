import { Request, Response } from 'express';
import { TopContratsService } from './top-contrats.service';

const service = new TopContratsService();

export const getTopParPrime = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const limite = Number(req.query.limite) || 10;
    res.json(await service.getTopParPrime(exercice, limite));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération top contrats par prime' });
  }
};

export const getTopParSinistralite = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const limite = Number(req.query.limite) || 10;
    res.json(await service.getTopParSinistralite(exercice, limite));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération top contrats par sinistralité' });
  }
};
