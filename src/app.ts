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
import authRoutes from './modules/auth/auth.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import utilisateursRoutes from './modules/utilisateurs/utilisateurs.routes';
import { exigerAuthentification } from './modules/auth/auth.middleware';
import rolesRoutes from './modules/droits/roles.routes';
import journalRoutes from './modules/utilisateurs/journal.routes';
import { exiger, selonRegles } from './modules/droits/droits.service';
import { REGLES_LBC, REGLES_NOTIFICATIONS } from './modules/droits/regles';

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Authentification (publique : connexion, OTP, mot de passe oublié).
  app.use('/api/auth', authRoutes);
  // Toutes les autres routes de l'API exigent une session valide.
  app.use('/api', exigerAuthentification);

  // Un routeur par module du cahier d'indicateurs — mapping direct
  // avec les 6 vues du tableau de bord.
  // Chaque module exige ses privilèges (src/modules/droits/privileges.ts).
  // La Vue exécutive lit aussi quelques indicateurs du chiffre d'affaires et
  // de la régularisation : ces lectures sont ouvertes à ses utilisateurs.
  const VUE = 'SANTE_VUE_EXECUTIVE';
  app.use('/api/vue-executive', exiger(VUE), vueExecutiveRoutes);
  app.use(
    '/api/chiffre-affaires',
    selonRegles([
      { methodes: ['GET'], chemin: /^\/(historique|ca-mensuel|prime-consommation)\/?$/, privileges: ['SANTE_CHIFFRE_AFFAIRES', VUE] },
      { chemin: /.*/, privileges: ['SANTE_CHIFFRE_AFFAIRES'] },
    ]),
    chiffreAffairesRoutes,
  );
  app.use('/api/sinistralite', exiger('SANTE_SINISTRALITE'), sinistraliteRoutes);
  app.use('/api/prestataires', exiger('SANTE_PRESTATAIRES'), prestatairesRoutes);
  app.use(
    '/api/regularisation',
    selonRegles([
      { methodes: ['GET'], chemin: /^\/montants\/?$/, privileges: ['SANTE_REGULARISATION', VUE] },
      { chemin: /.*/, privileges: ['SANTE_REGULARISATION'] },
    ]),
    regularisationRoutes,
  );
  app.use('/api/top-contrats', exiger('SANTE_TOP_CONTRATS'), topContratsRoutes);
  app.use(
    '/api/objectifs',
    selonRegles([
      { methodes: ['GET'], chemin: /.*/, privileges: ['SANTE_OBJECTIFS_CONSULTER', 'SANTE_OBJECTIFS_GERER'] },
      { chemin: /.*/, privileges: ['SANTE_OBJECTIFS_GERER'] },
    ]),
    objectifsRoutes,
  );
  app.use('/api/encaissements', exiger('SANTE_ENCAISSEMENTS'), encaissementsRoutes);
  // Module anti-blanchiment (LBC/FT) — toutes branches, hors cahier Santé.
  app.use('/api/lbc', selonRegles(REGLES_LBC), lbcRoutes);
  // Alertes : centre d'alertes (filtré par type selon les privilèges) et
  // réglage des envois email / SMS.
  app.use('/api/notifications', selonRegles(REGLES_NOTIFICATIONS), notificationsRoutes);
  // Comptes (droits vérifiés dans le routeur : chacun peut lire et modifier
  // son propre compte) et rôles.
  app.use('/api/utilisateurs', utilisateursRoutes);
  app.use('/api/roles', rolesRoutes);
  app.use('/api/journal-connexions', exiger('JOURNAL_CONNEXIONS'), journalRoutes);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
};
