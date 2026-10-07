import express from 'express';
import cors from 'cors';

import vueExecutiveRoutes from './modules/vue-executive/vue-executive.routes';
import chiffreAffairesRoutes from './modules/chiffre-affaires/chiffre-affaires.routes';
import sinistraliteRoutes from './modules/sinistralite/sinistralite.routes';
import prestatairesRoutes from './modules/prestataires/prestataires.routes';
import regularisationRoutes from './modules/regularisation/regularisation.routes';
import topContratsRoutes from './modules/top-contrats/top-contrats.routes';
import objectifsRoutes from './modules/objectifs/objectifs.routes';
import encaissementsRoutes from './modules/encaissements/encaissements.routes';
import lbcRoutes from './modules/lbc/lbc.routes';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Un routeur par module du cahier d'indicateurs — mapping direct
  // avec les 6 vues du tableau de bord.
  app.use('/api/vue-executive', vueExecutiveRoutes);
  app.use('/api/chiffre-affaires', chiffreAffairesRoutes);
  app.use('/api/sinistralite', sinistraliteRoutes);
  app.use('/api/prestataires', prestatairesRoutes);
  app.use('/api/regularisation', regularisationRoutes);
  app.use('/api/top-contrats', topContratsRoutes);
  app.use('/api/objectifs', objectifsRoutes);
  app.use('/api/encaissements', encaissementsRoutes);
  // Module anti-blanchiment (LBC/FT) — toutes branches, hors cahier Santé.
  app.use('/api/lbc', lbcRoutes);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
};
