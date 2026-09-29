import { AppDataSource } from '../../data-source';
import { EtlLogger } from '../utils/logger';
import { getWatermark } from '../utils/watermark';
import { extractCanaux } from '../extractors/canal.extractor';
import { extractApporteurs } from '../extractors/apporteur.extractor';
import { extractTypesAvenant } from '../extractors/type-avenant.extractor';
import { extractPolices } from '../extractors/police.extractor';
import { extractPrimes } from '../extractors/prime.extractor';
import { extractSinistres } from '../extractors/sinistre.extractor';
import { extractAssures } from '../extractors/assure.extractor';
import { loadCanaux, loadApporteurs, loadTypesAvenant, loadPolices, loadAssures } from '../loaders/dimensions.loader';
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

    const typesAvenant = await extractTypesAvenant();
    await loadTypesAvenant(typesAvenant);

    const polices = await extractPolices(since);
    const policesLoaded = await loadPolices(polices);

    // Roster complet des bénéficiaires (RISQUE + RISQUE_FAMILLE), toujours en
    // refresh complet — aucune colonne de suivi de modification fiable sur
    // RISQUE_FAMILLE (cf. assure.extractor.ts). Chargé avant les sinistres
    // pour que findOrCreateAssure (loadSinistres) retrouve déjà l'identité
    // réelle au lieu de créer une ligne minimale.
    const assures = await extractAssures();
    const assuresLoaded = await loadAssures(assures);

    const primes = await extractPrimes(since);
    const primesLoaded = await loadPrimes(primes);

    const sinistres = await extractSinistres(since);
    const sinistresLoaded = await loadSinistres(sinistres);

    // Rafraîchit la vue matérialisée S/P consommée par tous les modules
    // du cahier — un seul point de calcul, toujours à jour après charge.
    await AppDataSource.query('REFRESH MATERIALIZED VIEW mv_sp_portefeuille');

    const totalExtracted = polices.length + assures.length + primes.length + sinistres.length;
    const totalLoaded = policesLoaded + assuresLoaded + primesLoaded + sinistresLoaded;
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
