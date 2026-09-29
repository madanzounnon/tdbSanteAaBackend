import { Request, Response } from 'express';
import { PrestatairesService } from './prestataires.service';

const service = new PrestatairesService();

export const getFacturesStats = async (_req: Request, res: Response) => {
  try {
    res.json(await service.getFacturesStats());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération statistiques factures' });
  }
};

export const getFactures = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    const statut = typeof req.query.statut === 'string' ? req.query.statut : null;
    const recherche = typeof req.query.recherche === 'string' && req.query.recherche.trim() !== '' ? req.query.recherche.trim() : null;
    const page = Number(req.query.page) || 1;
    const limite = Number(req.query.limite) || 10;
    res.json(await service.getFactures(exercice, statut, recherche, page, limite));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération factures' });
  }
};

export const getFacturesReglees = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getFacturesReglees(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération factures réglées' });
  }
};

export const getParCategorie = async (_req: Request, res: Response) => {
  try {
    res.json(await service.getParCategorie());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération répartition par catégorie' });
  }
};

export const getReseauStats = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.query.exercice) || new Date().getFullYear();
    res.json(await service.getReseauStats(exercice));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération statistiques réseau' });
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
