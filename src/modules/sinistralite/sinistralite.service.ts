import { AppDataSource } from '../../data-source';

export class SinistraliteService {
  // Lit la vue matérialisée plutôt que de recalculer le S/P à la volée :
  // un seul endroit calcule la formule (voir migration mv_sp_portefeuille).
  async getSpPortefeuille(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         ROUND(SUM(sinistres_payes) / NULLIF(SUM(prime_acquise), 0) * 100, 1) AS sp_moyen_pct,
         ROUND(SUM(sinistres_payes) / NULLIF(SUM(prime_emise), 0) * 100, 1) AS sp_emis_pct,
         ROUND((SUM(prime_acquise) - SUM(sinistres_payes)) / NULLIF(SUM(prime_acquise), 0) * 100, 1) AS taux_rentabilite_pct,
         SUM(prime_emise) AS primes_emises,
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

  // Cahier §4.1 "Évolution du S/P mensuel" : "Comparaison avec le même mois
  // de l'exercice précédent pour détecter les anomalies" — la courbe N-1
  // est donc une référence obligatoire, jamais une série isolée. Renvoie
  // les 12 mois (generate_series) pour un axe complet même quand l'exercice
  // en cours n'est pas terminé.
  async getSpMensuel(exercice: number) {
    return AppDataSource.query(
      `SELECT
         m.mois,
         ROUND(actuel.sinistre / NULLIF(actuel.prime, 0) * 100, 1) AS sp_actuel_pct,
         ROUND(precedent.sinistre / NULLIF(precedent.prime, 0) * 100, 1) AS sp_precedent_pct
       FROM generate_series(1, 12) AS m(mois)
       LEFT JOIN (
         SELECT fp.mois, SUM(fp.montant_emis) AS prime, COALESCE(SUM(fs.montant_paye), 0) AS sinistre
         FROM fait_prime fp
         LEFT JOIN fait_sinistre fs ON fs.police_id = fp.police_id AND fs.exercice = fp.exercice AND fs.mois = fp.mois
         WHERE fp.exercice = $1
         GROUP BY fp.mois
       ) actuel ON actuel.mois = m.mois
       LEFT JOIN (
         SELECT fp.mois, SUM(fp.montant_emis) AS prime, COALESCE(SUM(fs.montant_paye), 0) AS sinistre
         FROM fait_prime fp
         LEFT JOIN fait_sinistre fs ON fs.police_id = fp.police_id AND fs.exercice = fp.exercice AND fs.mois = fp.mois
         WHERE fp.exercice = $1 - 1
         GROUP BY fp.mois
       ) precedent ON precedent.mois = m.mois
       ORDER BY m.mois`,
      [exercice],
    );
  }
}
