import { AppDataSource } from '../../data-source';

export class TopContratsService {
  async getTopParPrime(exercice: number, limite = 10) {
    return AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         p.statut_souscripteur,
         c.nom AS canal,
         p.prime_annuelle,
         mv.sp_emis_pct AS sp_global
       FROM dim_police p
       JOIN dim_canal c ON c.id = p.canal_id
       LEFT JOIN mv_sp_portefeuille mv ON mv.police_id = p.id AND mv.exercice = $1
       ORDER BY p.prime_annuelle DESC
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
