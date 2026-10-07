import 'dotenv/config';
import { AppDataSource } from '../data-source';
import { querySource } from '../etl/config/source-pool';

// Reprise de fait_prime.montant_encaisse après correction de
// prime.extractor.ts (jointure ENCAISSEMENT_QUITTANCE sur numequit seul,
// hors encaissements annulés) : l'ancienne jointure sur codinteq = codeinte
// ignorait les encaissements faits par un autre intermédiaire que celui de
// la quittance (guichet 1130...), soit 75 à 85 % des encaissements Santé.
// Idempotent : peut être relancé sans risque.
const TAILLE_LOT = 1000;

async function main() {
  await AppDataSource.initialize();

  const { rows } = await querySource<{ numero_quittance: string; montant_encaisse: number }>(
    `SELECT TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
            -- Quittance négative (ristourne / annulation) : le règlement est un
            -- REMBOURSEMENT, stocké en négatif pour se déduire de l'encaissé.
            CASE WHEN q.primtota < 0 THEN -ABS(NVL(enc.montant_encaisse, 0)) ELSE NVL(enc.montant_encaisse, 0) END AS "montant_encaisse"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN (
       SELECT numequit, SUM(montenca) AS montant_encaisse
       FROM encaissement_quittance
       WHERE dateannu IS NULL
       GROUP BY numequit
     ) enc ON enc.numequit = q.numequit`,
  );
  console.log(`${rows.length} quittances Santé lues dans ORASS`);

  let misesAJour = 0;
  for (let i = 0; i < rows.length; i += TAILLE_LOT) {
    const lot = rows.slice(i, i + TAILLE_LOT);
    const valeurs: unknown[] = [];
    const tuples = lot.map((r, j) => {
      valeurs.push(r.numero_quittance, r.montant_encaisse);
      return `($${2 * j + 1}::varchar, $${2 * j + 2}::numeric)`;
    });
    const [, n] = await AppDataSource.query(
      `UPDATE fait_prime fp SET montant_encaisse = v.montant_encaisse
       FROM (VALUES ${tuples.join(', ')}) AS v(numero_quittance, montant_encaisse)
       WHERE fp.numero_quittance = v.numero_quittance
         AND fp.montant_encaisse IS DISTINCT FROM v.montant_encaisse`,
      valeurs,
    );
    misesAJour += n;
  }
  console.log(`${misesAJour} quittances mises à jour`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Échec de la reprise des montants encaissés', err);
  process.exit(1);
});
