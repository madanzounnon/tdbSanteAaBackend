import 'dotenv/config';
import cron from 'node-cron';
import { AppDataSource } from '../data-source';
import { runDailyJob } from './jobs/daily.job';
import { runMonthlyJob } from './jobs/monthly.job';
import { runQuarterlyJob } from './jobs/quarterly.job';
import { runLbcJob } from './jobs/lbc.job';
import { runEncaissementsJob } from './jobs/encaissements.job';
import { runNotificationsJob } from './jobs/notifications.job';

// Process persistant unique qui planifie les 3 fréquences du §8.1.
// Alternative possible : ne pas garder ce process en vie et laisser
// cron/Task Scheduler du système lancer directement
// `node dist/etl/jobs/daily.job.js`, etc. — au choix de l'équipe infra.

async function main() {
  await AppDataSource.initialize();
  console.log('[ETL] Scheduler démarré');

  // Quotidien à 2h du matin — factures prestataires, retards, encaissements.
  cron.schedule('0 2 * * *', async () => {
    try {
      await runDailyJob();
    } catch (err) {
      console.error('[ETL] Échec job quotidien', err);
    }
  });

  // Quotidien à 2h15 — détail des encaissements Santé (page Encaissements).
  cron.schedule('15 2 * * *', async () => {
    try {
      await runEncaissementsJob();
    } catch (err) {
      console.error('[ETL] Échec job encaissements', err);
    }
  });

  // Quotidien à 2h30 — transactions toutes branches pour la détection
  // anti-blanchiment (module LBC/FT), puis alertes email / SMS (nouveaux
  // cas LBC, règlements de sinistres importants) sur les données à jour.
  cron.schedule('30 2 * * *', async () => {
    try {
      await runLbcJob();
    } catch (err) {
      console.error('[ETL] Échec job LBC', err);
    }
    try {
      await runNotificationsJob();
    } catch (err) {
      console.error('[ETL] Échec des alertes', err);
    }
  });

  // Mensuel, le 1er à 3h — CA émis, S/P mensuel, polices, renouvellements.
  cron.schedule('0 3 1 * *', async () => {
    try {
      await runMonthlyJob();
    } catch (err) {
      console.error('[ETL] Échec job mensuel', err);
    }
  });

  // Trimestriel, le 1er des mois 1/4/7/10 à 4h — Vue Exécutive, Top Contrats,
  // régularisation.
  cron.schedule('0 4 1 1,4,7,10 *', async () => {
    try {
      await runQuarterlyJob();
    } catch (err) {
      console.error('[ETL] Échec job trimestriel', err);
    }
  });
}

main().catch((err) => {
  console.error('[ETL] Échec démarrage scheduler', err);
  process.exit(1);
});
