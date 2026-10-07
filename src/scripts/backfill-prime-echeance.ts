import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { querySource } from '../etl/config/source-pool';

// Reprise de fait_prime.date_echeance (QUITTANCE.dateeche) pour les
// quittances chargées avant l'ajout de la colonne (migration
// 1700000000016), puis rafraîchissement de mv_sp_portefeuille, qui répartit
// désormais la prime entre exercices au prorata des jours couverts.
// Idempotent : peut être relancé sans risque.
const TAILLE_LOT = 1000;

async function main() {
  await AppDataSource.initialize();

  const { rows } = await querySource<{ numero_quittance: string; date_echeance: Date | null }>(
    `SELECT TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
            q.dateeche AS "date_echeance"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10`,
  );
  console.log(`${rows.length} quittances Santé lues dans ORASS`);

  let misesAJour = 0;
  for (let i = 0; i < rows.length; i += TAILLE_LOT) {
    const lot = rows.slice(i, i + TAILLE_LOT);
    const valeurs: unknown[] = [];
    const tuples = lot.map((r, j) => {
      valeurs.push(r.numero_quittance, r.date_echeance);
      return `($${2 * j + 1}::varchar, $${2 * j + 2}::date)`;
    });
    const [, n] = await AppDataSource.query(
      `UPDATE fait_prime fp SET date_echeance = v.date_echeance
       FROM (VALUES ${tuples.join(', ')}) AS v(numero_quittance, date_echeance)
       WHERE fp.numero_quittance = v.numero_quittance
         AND fp.date_echeance IS DISTINCT FROM v.date_echeance`,
      valeurs,
    );
    misesAJour += n;
  }

  const [{ restantes }] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS restantes FROM fait_prime WHERE date_echeance IS NULL`,
  );
  console.log(`${misesAJour} quittances mises à jour — ${restantes} sans échéance (repli année d'effet)`);

  await AppDataSource.query('REFRESH MATERIALIZED VIEW mv_sp_portefeuille');
  console.log('mv_sp_portefeuille rafraîchie');
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec de la reprise des échéances de quittances', err);
  process.exit(1);
});
