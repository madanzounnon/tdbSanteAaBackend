import { AppDataSource } from '../../data-source';

export class SinistraliteService {
  // Lit la vue matérialisée plutôt que de recalculer le S/P à la volée :
  // un seul endroit calcule la formule (voir migration mv_sp_portefeuille).
  async getSpPortefeuille(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         ROUND(AVG(sp_acquis_pct), 1) AS sp_moyen_pct,
         SUM(prime_acquise) AS primes_acquises,
         SUM(sinistres_payes) AS sinistres_payes,
         SUM(prime_acquise) - SUM(sinistres_payes) AS surplus_technique,
         COUNT(*) FILTER (WHERE statut_risque = 'saine') AS polices_saines,
         COUNT(*) FILTER (WHERE statut_risque = 'vigilance') AS polices_vigilance,
         COUNT(*) FILTER (WHERE statut_risque = 'critique') AS polices_critiques,
         COUNT(*) FILTER (WHERE statut_risque = 'perte_seche') AS polices_perte_seche
       FROM mv_sp_portefeuille WHERE exercice = $1`,
      [exercice],
    );
    return result;
  }

  async getParNatureActe(exercice: number) {
    return AppDataSource.query(
      `SELECT
         am.nature,
         COUNT(*) AS nombre_actes,
         SUM(fs.montant_paye) AS montant_total,
         ROUND(SUM(fs.montant_paye) * 100.0 / SUM(SUM(fs.montant_paye)) OVER (), 1) AS part_pct
       FROM fait_sinistre fs
       JOIN dim_acte_medical am ON am.id = fs.acte_medical_id
       WHERE fs.exercice = $1
       GROUP BY am.nature
       ORDER BY montant_total DESC`,
      [exercice],
    );
  }

  async getSpMensuel(exercice: number) {
    return AppDataSource.query(
      `SELECT
         fp.mois,
         ROUND(SUM(fs.montant_paye) / NULLIF(SUM(fp.montant_emis), 0) * 100, 1) AS sp_mensuel_pct
       FROM fait_prime fp
       LEFT JOIN fait_sinistre fs
         ON fs.police_id = fp.police_id AND fs.exercice = fp.exercice AND fs.mois = fp.mois
       WHERE fp.exercice = $1
       GROUP BY fp.mois
       ORDER BY fp.mois`,
      [exercice],
    );
  }
}
