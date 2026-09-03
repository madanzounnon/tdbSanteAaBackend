import 'dotenv/config';
import cron from 'node-cron';
import { AppDataSource } from '../data-source';
import { runDailyJob } from './jobs/daily.job';
import { runMonthlyJob } from './jobs/monthly.job';
import { runQuarterlyJob } from './jobs/quarterly.job';

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
