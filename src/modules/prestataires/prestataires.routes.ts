import { Router } from 'express';
import { getFacturesImpayees, getPerformanceParExercice, getParCategorie } from './prestataires.controller';

const router = Router();

// GET /api/prestataires/factures-impayees
router.get('/factures-impayees', getFacturesImpayees);
// GET /api/prestataires/performance
router.get('/performance', getPerformanceParExercice);
// GET /api/prestataires/par-categorie
router.get('/par-categorie', getParCategorie);

export default router;
