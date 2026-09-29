import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { extractSinistres } from '../etl/extractors/sinistre.extractor';
import { loadSinistres } from '../etl/loaders/facts.loader';

// Backfill ponctuel suite au passage de dim_assure à une ligne par individu
// réel (migration 1700000000009). Rejoue extractSinistres/loadSinistres sur
// tout l'historique, exercice par exercice (résilience VPN sur ~2,2M lignes
// au total) : chaque sinistre est upserté sur numero_reglement_ligne et son
// assure_id est réaffecté au bon individu (matricule), créant au passage les
// nouvelles lignes dim_assure avec nom/date de naissance/sexe. N'écrit pas
// dans etl_log, n'affecte pas le watermark incrémental normal.
const EXERCICE_MIN = 2000;
const EXERCICE_MAX = 2027;

AppDataSource.initialize()
  .then(async () => {
    let totalExtrait = 0;
    let totalCharge = 0;
    for (let exercice = EXERCICE_MIN; exercice <= EXERCICE_MAX; exercice++) {
      const sinistres = await extractSinistres(new Date('2000-01-01'), exercice);
      if (sinistres.length === 0) continue;
      const charge = await loadSinistres(sinistres);
      totalExtrait += sinistres.length;
      totalCharge += charge;
      console.log(`Exercice ${exercice} : ${sinistres.length} lignes extraites, ${charge} chargées.`);
    }
    console.log(`Total : ${totalExtrait} lignes extraites, ${totalCharge} chargées.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Échec du backfill identité assurés', err);
    process.exit(1);
  });
