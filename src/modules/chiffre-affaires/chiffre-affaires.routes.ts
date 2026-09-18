import { Router } from 'express';
import {
  getKpis, getParCanal, getProduction, getRepartitionParTranche, getHistorique,
  getCaMensuel, getPrimeConsommationParAssure,
} from './chiffre-affaires.controller';

const router = Router();

// GET /api/chiffre-affaires/kpis?exercice=2026
router.get('/kpis', getKpis);
// GET /api/chiffre-affaires/par-canal?exercice=2026
router.get('/par-canal', getParCanal);
// GET /api/chiffre-affaires/production?exercice=2026 (nouvelles affaires vs renouvellement)
router.get('/production', getProduction);
// GET /api/chiffre-affaires/par-tranche?exercice=2026
router.get('/par-tranche', getRepartitionParTranche);
// GET /api/chiffre-affaires/historique?debut=2021&fin=2026
router.get('/historique', getHistorique);
// GET /api/chiffre-affaires/ca-mensuel?exercice=2026
router.get('/ca-mensuel', getCaMensuel);
// GET /api/chiffre-affaires/prime-consommation?exercice=2026
router.get('/prime-consommation', getPrimeConsommationParAssure);

export default router;
