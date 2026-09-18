import { Router } from 'express';
import { getTopParPrime, getTopParSinistralite, getProfilPolice } from './top-contrats.controller';

const router = Router();

// GET /api/top-contrats/par-prime?exercice=2026&limite=10
router.get('/par-prime', getTopParPrime);
// GET /api/top-contrats/par-sinistralite?exercice=2026&limite=10
router.get('/par-sinistralite', getTopParSinistralite);
// GET /api/top-contrats/police/:numeroPolice?exercice=2026
router.get('/police/:numeroPolice', getProfilPolice);

export default router;
