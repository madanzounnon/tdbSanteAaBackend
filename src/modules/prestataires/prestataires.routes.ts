import { Router } from 'express';
import {
  getFacturesStats, getFactures, getFacturesReglees, getPerformanceParExercice, getParCategorie, getReseauStats,
} from './prestataires.controller';

const router = Router();

// GET /api/prestataires/factures-stats — agrégats retard/attente (KPI)
router.get('/factures-stats', getFacturesStats);
// GET /api/prestataires/factures?exercice=2026&statut=retard&recherche=x&page=1&limite=10
router.get('/factures', getFactures);
// GET /api/prestataires/factures-reglees?exercice=2026
router.get('/factures-reglees', getFacturesReglees);
// GET /api/prestataires/performance
router.get('/performance', getPerformanceParExercice);
// GET /api/prestataires/par-categorie
router.get('/par-categorie', getParCategorie);
// GET /api/prestataires/reseau-stats?exercice=2026 — délai moyen & taux règlement dans les délais, RÉSEAU global
router.get('/reseau-stats', getReseauStats);

export default router;
