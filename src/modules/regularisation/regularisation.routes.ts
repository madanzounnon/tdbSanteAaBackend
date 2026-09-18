import { Router } from 'express';
import {
  getPolicesCritiques,
  getPolicesParStatut,
  getMontantsARegulariser,
  getSuiviParCanal,
} from './regularisation.controller';

const router = Router();

// GET /api/regularisation/polices-critiques?exercice=2025
router.get('/polices-critiques', getPolicesCritiques);
// GET /api/regularisation/polices-par-statut?exercice=2025 (échues à régulariser vs actives déjà critiques)
router.get('/polices-par-statut', getPolicesParStatut);
// GET /api/regularisation/montants?exercice=2025
router.get('/montants', getMontantsARegulariser);
// GET /api/regularisation/par-canal?exercice=2025
router.get('/par-canal', getSuiviParCanal);

export default router;
