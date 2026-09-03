import { Router } from 'express';
import {
  getPolicesCritiques,
  getMontantsARegulariser,
  getSuiviParCanal,
} from './regularisation.controller';

const router = Router();

// GET /api/regularisation/polices-critiques?exercice=2025
router.get('/polices-critiques', getPolicesCritiques);
// GET /api/regularisation/montants?exercice=2025
router.get('/montants', getMontantsARegulariser);
// GET /api/regularisation/par-canal?exercice=2025
router.get('/par-canal', getSuiviParCanal);

export default router;
