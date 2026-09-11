import { Router } from 'express';
import { getKpis, getParCanal, getProduction, getRepartitionParTranche } from './chiffre-affaires.controller';

const router = Router();

// GET /api/chiffre-affaires/kpis?exercice=2026
router.get('/kpis', getKpis);
// GET /api/chiffre-affaires/par-canal?exercice=2026
router.get('/par-canal', getParCanal);
// GET /api/chiffre-affaires/production?exercice=2026 (nouvelles affaires vs renouvellement)
router.get('/production', getProduction);
// GET /api/chiffre-affaires/par-tranche?exercice=2026
router.get('/par-tranche', getRepartitionParTranche);

export default router;
