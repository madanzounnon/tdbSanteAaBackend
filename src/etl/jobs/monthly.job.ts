import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractCanaux } from '../extractors/canal.extractor';
import { extractApporteurs } from '../extractors/apporteur.extractor';
import { extractPolices } from '../extractors/police.extractor';
import { extractPrimes } from '../extractors/prime.extractor';
import { extractSinistres } from '../extractors/sinistre.extractor';
import { loadCanaux, loadApporteurs, loadPolices } from '../loaders/dimensions.loader';
import { loadPrimes, loadSinistres } from '../loaders/facts.loader';

const JOB_NAME = 'monthly_ca_sinistralite';

// Mensuel : CA émis, S/P mensuel, actes médicaux, nouvelles polices,
// renouvellements (§8.1). Les dimensions (canaux, polices) sont
// rechargées en premier pour garantir les rattachements des faits.
export async function runMonthlyJob(): Promise<void> {
  const logger = new EtlLogger();
  await logger.start(JOB_NAME);

  try {
    const since = await getWatermark(JOB_NAME);

    const canaux = await extractCanaux();
    await loadCanaux(canaux);

    const apporteurs = await extractApporteurs();
    await loadApporteurs(apporteurs);

    const polices = await extractPolices(since);
    const policesLoaded = await loadPolices(polices);

    const primes = await extractPrimes(since);
    const primesLoaded = await loadPrimes(primes);

    const sinistres = await extractSinistres(since);
    const sinistresLoaded = await loadSinistres(sinistres);

    // Rafraîchit la vue matérialisée S/P consommée par tous les modules
    // du cahier — un seul point de calcul, toujours à jour après charge.
    await AppDataSource.query('REFRESH MATERIALIZED VIEW mv_sp_portefeuille');

    const totalExtracted = polices.length + primes.length + sinistres.length;
    const totalLoaded = policesLoaded + primesLoaded + sinistresLoaded;
    await logger.success(totalExtracted, totalLoaded);
  } catch (err) {
    await logger.failure(err);
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runMonthlyJob)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
