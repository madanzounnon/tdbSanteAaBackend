import { Router } from 'express';
import { getSpPortefeuille, getParNatureActe, getSpMensuel } from './sinistralite.controller';

const router = Router();

// GET /api/sinistralite/sp-portefeuille?exercice=2026
router.get('/sp-portefeuille', getSpPortefeuille);
// GET /api/sinistralite/par-nature-acte?exercice=2026
router.get('/par-nature-acte', getParNatureActe);
// GET /api/sinistralite/sp-mensuel?exercice=2026
router.get('/sp-mensuel', getSpMensuel);

export default router;
