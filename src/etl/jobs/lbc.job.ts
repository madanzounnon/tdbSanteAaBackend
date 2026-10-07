import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractLbcOperations } from '../extractors/lbc-operation.extractor';
import { loadLbcOperations } from '../loaders/lbc-operation.loader';

export const LBC_JOB_NAME = 'lbc_operations';

// Profondeur d'historique chargée au premier run (watermark par défaut en
// 2000) : sans borne, le premier chargement remonterait toute la vie
// d'ORASS. Surchargeable par LBC_HISTORIQUE_DEPUIS (AAAA-MM-JJ).
const depuis = () => new Date(process.env.LBC_HISTORIQUE_DEPUIS || '2022-01-01');

// Quotidien : transactions (encaissements + règlements) toutes branches
// alimentant la détection anti-blanchiment.
export async function runLbcJob(): Promise<{ extraites: number; chargees: number }> {
  const logger = new EtlLogger();
  await logger.start(LBC_JOB_NAME);

  try {
    const since = await getWatermark(LBC_JOB_NAME);
    const operations = await extractLbcOperations(since, depuis());
    const chargees = await loadLbcOperations(operations);
    await logger.success(operations.length, chargees);
    return { extraites: operations.length, chargees };
  } catch (err) {
    await logger.failure(err);
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runLbcJob)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
