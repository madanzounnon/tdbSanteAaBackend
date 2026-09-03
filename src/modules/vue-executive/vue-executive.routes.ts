import { Router } from 'express';
import { getSynthese } from './vue-executive.controller';

const router = Router();

// GET /api/vue-executive/synthese?exercice=2026
router.get('/synthese', getSynthese);

export default router;
