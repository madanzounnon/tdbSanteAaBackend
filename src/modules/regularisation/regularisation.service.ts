import { AppDataSource } from '../../data-source';

export class RegularisationService {
  async getPolicesCritiques(exercice: number) {
    return AppDataSource.query(
      `SELECT
         numero_police,
         prime_emise AS prime_annuelle,
         sinistres_payes AS consommation,
         sp_emis_pct AS sp_global,
         statut_risque
       FROM mv_sp_portefeuille
       WHERE exercice = $1 AND statut_risque IN ('critique', 'perte_seche')
       ORDER BY sp_emis_pct DESC`,
      [exercice],
    );
  }

  async getMontantsARegulariser(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         SUM(montant_a_regulariser) AS montant_total_a_regulariser,
         SUM(montant_encaisse) AS deja_encaisse,
         SUM(montant_a_regulariser) - SUM(montant_encaisse) AS reste_a_recouvrer,
         ROUND(SUM(montant_encaisse) / NULLIF(SUM(montant_a_regulariser), 0) * 100, 1) AS taux_encaissement_pct
       FROM v_regularisation WHERE exercice = $1`,
      [exercice],
    );
    return result;
  }

  async getSuiviParCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         SUM(r.montant_a_regulariser) AS a_encaisser,
         SUM(r.montant_encaisse) AS encaisse,
         SUM(r.montant_a_regulariser) - SUM(r.montant_encaisse) AS reste,
         ROUND(SUM(r.montant_encaisse) / NULLIF(SUM(r.montant_a_regulariser), 0) * 100, 1) AS taux_pct
       FROM v_regularisation r
       JOIN dim_canal c ON c.id = r.canal_id
       WHERE r.exercice = $1
       GROUP BY c.nom
       ORDER BY reste DESC`,
      [exercice],
    );
  }
}
