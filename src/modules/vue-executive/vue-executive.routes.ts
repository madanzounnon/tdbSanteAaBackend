import { Router } from 'express';
import {
  getSynthese, getTendanceN1, getProjectionAnnuelle, getSpParTypeCanal,
} from './vue-executive.controller';

const router = Router();

// GET /api/vue-executive/synthese?exercice=2026
router.get('/synthese', getSynthese);
// GET /api/vue-executive/tendance-n1?exercice=2026 (comparaison même période N vs N-1)
router.get('/tendance-n1', getTendanceN1);
// GET /api/vue-executive/projection?exercice=2026 (projection fin d'année, saisonnalité N-1)
router.get('/projection', getProjectionAnnuelle);
// GET /api/vue-executive/sp-par-canal?exercice=2026 (pour la reco "mix d'apporteurs")
router.get('/sp-par-canal', getSpParTypeCanal);

export default router;
