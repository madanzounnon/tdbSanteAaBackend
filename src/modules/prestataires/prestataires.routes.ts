import { Router } from 'express';
import { getFacturesImpayees, getPerformanceParExercice } from './prestataires.controller';

const router = Router();

// GET /api/prestataires/factures-impayees
router.get('/factures-impayees', getFacturesImpayees);
// GET /api/prestataires/performance
router.get('/performance', getPerformanceParExercice);

export default router;
