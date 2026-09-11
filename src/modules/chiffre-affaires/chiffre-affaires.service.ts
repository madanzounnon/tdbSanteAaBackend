import { AppDataSource } from '../../data-source';

export class ChiffreAffairesService {
  async getKpis(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         SUM(montant_emis) AS ca_ytd,
         SUM(montant_encaisse) AS ca_encaisse_ytd,
         ROUND(SUM(montant_encaisse) / NULLIF(SUM(montant_emis), 0) * 100, 1) AS taux_recouvrement,
         COUNT(DISTINCT police_id) AS nombre_polices
       FROM fait_prime WHERE exercice = $1`,
      [exercice],
    );
    return result;
  }

  async getParCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         c.type_canal,
         SUM(fp.montant_emis) AS ca_canal,
         ROUND(SUM(fp.montant_emis) * 100.0 / SUM(SUM(fp.montant_emis)) OVER (), 1) AS part_marche_pct
       FROM fait_prime fp
       JOIN dim_police p ON p.id = fp.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE fp.exercice = $1
       GROUP BY c.nom, c.type_canal
       ORDER BY ca_canal DESC`,
      [exercice],
    );
  }

  // §3.1 : Nombre de Nouvelles Affaires (NA) vs Renouvellements (REN).
  // NA = police dont la 1ère quittance de l'exercice n'a aucun avenant
  // (type_avenant_id IS NULL, càd numeaven était NULL en source).
  // REN = police avec une quittance liée à dim_type_avenant.code = '1'
  // ("Avenant de renouvellement", confirmé côté métier) — les autres
  // avenants (incorporation, modification, retrait, ajustement...) ne
  // comptent ni comme NA ni comme REN.
  async getProduction(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(DISTINCT CASE WHEN ta.code IS NULL THEN fp.police_id END) AS nouvelles_affaires,
         COUNT(DISTINCT CASE WHEN ta.code = '1' THEN fp.police_id END) AS renouvellements
       FROM fait_prime fp
       LEFT JOIN dim_type_avenant ta ON ta.id = fp.type_avenant_id
       WHERE fp.exercice = $1`,
      [exercice],
    );
    return result;
  }

  // Tranche calculée sur la prime de l'exercice (SUM(fait_prime.montant_emis)),
  // jamais une valeur figée sur dim_police — une police change de tranche
  // d'un exercice à l'autre selon sa prime réelle sur la période. Seuils
  // repris du cahier §3.4.
  async getRepartitionParTranche(exercice: number) {
    return AppDataSource.query(
      `SELECT tranche, COUNT(*) AS nombre_polices, SUM(prime_exercice) AS primes_cumulees
       FROM (
         SELECT
           fp.police_id,
           SUM(fp.montant_emis) AS prime_exercice,
           CASE
             WHEN SUM(fp.montant_emis) < 5000000 THEN '< 5 M'
             WHEN SUM(fp.montant_emis) < 10000000 THEN '5 - 10 M'
             WHEN SUM(fp.montant_emis) < 20000000 THEN '10 - 20 M'
             WHEN SUM(fp.montant_emis) < 50000000 THEN '20 - 50 M'
             WHEN SUM(fp.montant_emis) < 100000000 THEN '50 - 100 M'
             WHEN SUM(fp.montant_emis) < 200000000 THEN '100 - 200 M'
             ELSE '> 200 M'
           END AS tranche
         FROM fait_prime fp
         WHERE fp.exercice = $1
         GROUP BY fp.police_id
       ) par_police
       GROUP BY tranche`,
      [exercice],
    );
  }
}
