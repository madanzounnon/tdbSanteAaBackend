import { Router } from 'express';
import { getSynthese, getTendanceN1 } from './vue-executive.controller';

const router = Router();

// GET /api/vue-executive/synthese?exercice=2026
router.get('/synthese', getSynthese);
// GET /api/vue-executive/tendance-n1?exercice=2026 (comparaison même période N vs N-1)
router.get('/tendance-n1', getTendanceN1);

export default router;
