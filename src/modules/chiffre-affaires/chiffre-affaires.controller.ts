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

export const getProduction = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getProduction(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération production NA/renouvellement' });
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

export const getCaMensuel = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getCaMensuel(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération CA mensuel' });
  }
};

export const getPrimeConsommationParAssure = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getPrimeConsommationParAssure(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération prime & consommation par assuré' });
  }
};

export const getHistorique = async (req: Request, res: Response) => {
  try {
    const debut = Number(req.query.debut) || 2021;
    const fin = Number(req.query.fin) || 2026;
    res.json(await service.getHistorique(debut, fin));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération historique pluriannuel' });
  }
};
