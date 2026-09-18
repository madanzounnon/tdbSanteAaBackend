import 'dotenv/config';
import { AppDataSource } from '../data-source';

// Rafraîchit mv_sp_portefeuille à la demande, en dehors du cycle ETL
// mensuel (voir src/etl/jobs/monthly.job.ts, qui l'appelle déjà après
// chaque chargement). Utile après une correction manuelle de données ou
// pour forcer une mise à jour immédiate en dev/test.
AppDataSource.initialize()
  .then(async () => {
    await AppDataSource.query('REFRESH MATERIALIZED VIEW mv_sp_portefeuille');
    const [{ count }] = await AppDataSource.query('SELECT COUNT(*) FROM mv_sp_portefeuille');
    console.log(`mv_sp_portefeuille rafraîchie — ${count} lignes.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Échec du rafraîchissement de mv_sp_portefeuille', err);
    process.exit(1);
  });
