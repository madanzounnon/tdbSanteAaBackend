import { AppDataSource } from '../../data-source';

export class TopContratsService {
  async getTopParPrime(exercice: number, limite = 10) {
    // prime_emise = SUM(fait_prime.montant_emis) pour la police sur
    // l'exercice (déjà agrégée dans mv_sp_portefeuille) — jamais
    // dim_police.prime_annuelle, qui est une valeur figée au chargement et
    // ne reflète pas les multiples mouvements de prime d'une police
    // (nouvelle affaire, renouvellement, avenants, ristournes...).
    return AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         p.statut_souscripteur,
         c.nom AS canal,
         mv.prime_emise,
         mv.sp_emis_pct AS sp_global
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE mv.exercice = $1
       ORDER BY mv.prime_emise DESC
       LIMIT $2`,
      [exercice, limite],
    );
  }

  async getTopParSinistralite(exercice: number, limite = 10) {
    return AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         c.nom AS canal,
         mv.sp_emis_pct AS sp_global,
         mv.statut_risque
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE mv.exercice = $1
       ORDER BY mv.sp_emis_pct DESC
       LIMIT $2`,
      [exercice, limite],
    );
  }
}
