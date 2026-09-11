import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { runMonthlyJob } from './monthly.job';

const JOB_NAME = 'quarterly_regularisation_top_contrats';

// Trimestriel : Vue Exécutive complète, projection annuelle, revue du
// portefeuille, Top Contrats, régularisation (§8.1). On rejoue d'abord le
// job mensuel pour garantir la fraîcheur du socle CA/sinistralité — Top
// Contrats, Vue Exécutive et régularisation (vue v_regularisation, cf.
// fait_prime) sont ensuite des lectures directes de l'entrepôt, sans
// chargement dédié.
export async function runQuarterlyJob(): Promise<void> {
  const logger = new EtlLogger();
  await logger.start(JOB_NAME);

  try {
    await runMonthlyJob();
    await logger.success(0, 0);
  } catch (err) {
    await logger.failure(err);
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runQuarterlyJob)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
