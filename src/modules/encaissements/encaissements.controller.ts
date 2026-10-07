import { Request, Response } from 'express';
import { CATEGORIES_ENCAISSEMENT, CategorieEncaissement, EncaissementsService } from './encaissements.service';

const service = new EncaissementsService();

const exerciceDe = (req: Request) => Number(req.query.exercice) || new Date().getFullYear();

export const getSynthese = async (req: Request, res: Response) => {
  try {
    res.json(await service.getSynthese(exerciceDe(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération de la synthèse des encaissements' });
  }
};

// GET /api/encaissements/liste?exercice=2026&categorie=ANNULE&page=1&taille=15&q=...
export const getListe = async (req: Request, res: Response) => {
  try {
    const categorie = String(req.query.categorie || 'ENCAISSEMENT').toUpperCase() as CategorieEncaissement;
    if (!CATEGORIES_ENCAISSEMENT.includes(categorie)) {
      res.status(400).json({ error: `categorie : ${CATEGORIES_ENCAISSEMENT.join(', ')}` });
      return;
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const taille = Math.min(100, Math.max(1, Number(req.query.taille) || 15));
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
    res.json(await service.getListe(exerciceDe(req), categorie, page, taille, q));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération de la liste des encaissements' });
  }
};
