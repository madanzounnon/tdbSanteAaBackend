import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { extractAssures } from '../etl/extractors/assure.extractor';
import { loadAssures } from '../etl/loaders/dimensions.loader';

// Premier chargement du roster complet (RISQUE + RISQUE_FAMILLE), en dehors
// du cycle mensuel normal (déjà branché dans monthly.job.ts pour les
// prochaines exécutions). ~320k lignes attendues (99 260 RISQUE + 219 477
// RISQUE_FAMILLE sur la branche Santé, vérifié).
AppDataSource.initialize()
  .then(async () => {
    console.log('Extraction du roster (RISQUE + RISQUE_FAMILLE)...');
    const t0 = Date.now();
    const sources = await extractAssures();
    console.log(`${sources.length} lignes extraites en ${Math.round((Date.now() - t0) / 1000)}s.`);

    const t1 = Date.now();
    const loaded = await loadAssures(sources);
    console.log(`${loaded} lignes chargées en ${Math.round((Date.now() - t1) / 1000)}s.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Échec du backfill roster assurés', err);
    process.exit(1);
  });
