import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { extractTypesAvenant } from '../etl/extractors/type-avenant.extractor';
import { extractPrimes } from '../etl/extractors/prime.extractor';
import { loadTypesAvenant, getTypeAvenantByCode } from '../etl/loaders/dimensions.loader';
import { loadPrimes } from '../etl/loaders/facts.loader';

// Correctif : les 30 512 lignes fait_prime existantes ont toutes
// type_avenant_id = NULL, alors que 28 185/30 512 quittances matchent
// réellement un AVENANT en source (vérifié). Cause : typesAvenantCache
// (dimensions.loader.ts) est un Map en mémoire — la charge initiale a dû
// appeler loadPrimes() sans avoir d'abord peuplé ce cache via
// loadTypesAvenant() dans le MÊME processus, donc getTypeAvenantByCode()
// retombait systématiquement sur null. Ce script recharge le référentiel
// puis rejoue extractPrimes/loadPrimes sur tout l'historique (upsert sur
// numero_quittance, sans risque) pour corriger type_avenant_id partout.
AppDataSource.initialize()
  .then(async () => {
    const typesAvenant = await extractTypesAvenant();
    const typesLoaded = await loadTypesAvenant(typesAvenant);
    console.log(`${typesLoaded} types d'avenant chargés (référentiel).`);
    // Vérification rapide que le cache est bien peuplé avant de continuer.
    console.log('Contrôle cache code=1 ->', getTypeAvenantByCode('1'));

    const t0 = Date.now();
    const primes = await extractPrimes(new Date('2000-01-01'));
    console.log(`${primes.length} quittances extraites en ${Math.round((Date.now() - t0) / 1000)}s.`);

    const t1 = Date.now();
    const loaded = await loadPrimes(primes);
    console.log(`${loaded} lignes fait_prime mises à jour en ${Math.round((Date.now() - t1) / 1000)}s.`);

    await AppDataSource.query('REFRESH MATERIALIZED VIEW mv_sp_portefeuille');
    console.log('TERMINE');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Échec du backfill type_avenant_id', err);
    process.exit(1);
  });
