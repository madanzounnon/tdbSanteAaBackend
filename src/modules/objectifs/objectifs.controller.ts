import { Request, Response } from 'express';
import { ObjectifsService } from './objectifs.service';

const service = new ObjectifsService();

export const getAll = async (_req: Request, res: Response) => {
  try {
    res.json(await service.getAll());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération des objectifs' });
  }
};

export const getByExercice = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.params.exercice);
    const objectif = await service.getByExercice(exercice);
    if (!objectif) {
      res.status(404).json({ error: `Aucun objectif pour l'exercice ${exercice}` });
      return;
    }
    res.json(objectif);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur récupération de l\'objectif' });
  }
};

export const create = async (req: Request, res: Response) => {
  try {
    const { exercice, montantCaObjectif } = req.body;
    if (!exercice || !montantCaObjectif || Number(montantCaObjectif) <= 0) {
      res.status(400).json({ error: 'exercice et montantCaObjectif (> 0) sont requis' });
      return;
    }
    const objectif = await service.create(Number(exercice), Number(montantCaObjectif));
    res.status(201).json(objectif);
  } catch (err: any) {
    console.error(err);
    res.status(409).json({ error: err.message || 'Erreur création de l\'objectif' });
  }
};

export const update = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.params.exercice);
    const { montantCaObjectif } = req.body;
    if (!montantCaObjectif || Number(montantCaObjectif) <= 0) {
      res.status(400).json({ error: 'montantCaObjectif (> 0) est requis' });
      return;
    }
    const objectif = await service.update(exercice, Number(montantCaObjectif));
    if (!objectif) {
      res.status(404).json({ error: `Aucun objectif pour l'exercice ${exercice}` });
      return;
    }
    res.json(objectif);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur mise à jour de l\'objectif' });
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    const exercice = Number(req.params.exercice);
    const supprime = await service.delete(exercice);
    if (!supprime) {
      res.status(404).json({ error: `Aucun objectif pour l'exercice ${exercice}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur suppression de l\'objectif' });
  }
};
