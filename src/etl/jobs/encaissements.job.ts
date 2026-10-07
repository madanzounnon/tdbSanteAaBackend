import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractEncaissements } from '../extractors/encaissement.extractor';
import { loadEncaissements } from '../loaders/encaissement.loader';

const JOB_NAME = 'daily_encaissements';

// Quotidien : détail des encaissements Santé (page "Encaissements").
// Premier run = historique complet (watermark par défaut en 2000).
export async function runEncaissementsJob(): Promise<void> {
  const logger = new EtlLogger();
  await logger.start(JOB_NAME);
  try {
    const since = await getWatermark(JOB_NAME);
    const encaissements = await extractEncaissements(since);
    const charges = await loadEncaissements(encaissements);
    await logger.success(encaissements.length, charges);
  } catch (err) {
    await logger.failure(err);
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runEncaissementsJob)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
