import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractFacturesPrestataires } from '../extractors/facture-prestataire.extractor';
import { loadFacturesPrestataires } from '../loaders/facts.loader';

const JOB_NAME = 'daily_prestataires';

// Quotidien : factures prestataires, alertes de retard, encaissements
// du jour (cf. §8.1). C'est le job le plus fréquent car ce sont les
// indicateurs les plus sensibles au délai (seuil de 45 jours).
export async function runDailyJob(): Promise<void> {
  const logger = new EtlLogger();
  await logger.start(JOB_NAME);

  try {

    const since = await getWatermark(JOB_NAME);
    const factures = await extractFacturesPrestataires(since);
    const facturesLoaded = await loadFacturesPrestataires(factures);

    await logger.success(factures.length, facturesLoaded);
  } catch (err) {
    await logger.failure(err);
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runDailyJob)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
