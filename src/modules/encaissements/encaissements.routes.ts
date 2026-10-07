import { Router } from 'express';
import { getListe, getSynthese } from './encaissements.controller';

const router = Router();

// GET /api/encaissements/synthese?exercice=2026
router.get('/synthese', getSynthese);
// GET /api/encaissements/liste?exercice=2026&categorie=ENCAISSEMENT|ANNULE|REMBOURSEMENT&page=1&taille=15&q=
router.get('/liste', getListe);

export default router;
