import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractRegularisations } from '../extractors/regularisation.extractor';
import { loadRegularisations } from '../loaders/facts.loader';
import { runMonthlyJob } from './monthly.job';

const JOB_NAME = 'quarterly_regularisation_top_contrats';

// Trimestriel : Vue Exécutive complète, projection annuelle, revue du
// portefeuille, Top Contrats, régularisation (§8.1). On rejoue d'abord
// le job mensuel pour garantir la fraîcheur du socle CA/sinistralité,
// puis on ajoute les régularisations (Top Contrats et Vue Exécutive
// sont des lectures directes de l'entrepôt, pas de chargement dédié).
export async function runQuarterlyJob(): Promise<void> {
  const logger = new EtlLogger();
  await logger.start(JOB_NAME);

  try {
    await runMonthlyJob();

    const since = await getWatermark(JOB_NAME);
    const regularisations = await extractRegularisations(since);
    const regularisationsLoaded = await loadRegularisations(regularisations);

    await logger.success(regularisations.length, regularisationsLoaded);
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
