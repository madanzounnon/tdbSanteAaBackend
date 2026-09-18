import { Router } from 'express';
import {
  getAll, getByExercice, create, update, remove,
} from './objectifs.controller';

const router = Router();

// GET /api/objectifs
router.get('/', getAll);
// GET /api/objectifs/2026
router.get('/:exercice', getByExercice);
// POST /api/objectifs { exercice, montantCaObjectif }
router.post('/', create);
// PUT /api/objectifs/2026 { montantCaObjectif }
router.put('/:exercice', update);
// DELETE /api/objectifs/2026
router.delete('/:exercice', remove);

export default router;
