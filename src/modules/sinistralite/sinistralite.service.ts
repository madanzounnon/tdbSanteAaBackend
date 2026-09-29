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
  //
  // Prime du dénominateur = prime ANNUELLE / 12 (lissée), jamais la prime
  // émise CE mois-là : les primes s'émettent par gros paquets (renouvellements
  // groupés en début d'exercice), donc un mois donné peut porter des mois de
  // prime ou presque aucune — un S/P "du mois" calculé sur la prime émise ce
  // mois-là est incohérent (vérifié : valeurs de 0,2% à 3,5% au lieu de
  // dizaines de %). Même principe que prime_acquise dans mv_sp_portefeuille,
  // mais au pas mensuel plutôt que YTD.
  //
  // sinistre_mensuel pré-agrégé par (exercice, mois) AVANT toute jointure :
  // un LEFT JOIN direct fait_sinistre-fait_prime sur (police_id, mois)
  // multiplierait les sinistres par le nombre de quittances du mois pour
  // cette police (fan-out, même classe de bug que mv_sp_portefeuille).
  //
  // sp_actuel_pct reste NULL au-delà du dernier mois avec une quittance
  // (mois_ecoule) : sinon un mois futur sans sinistre afficherait 0% au lieu
  // de "pas encore atteint", cassant le marqueur "arrêté" côté frontend.
  async getSpMensuel(exercice: number) {
    return AppDataSource.query(
      `WITH mois_ecoule AS (
         SELECT COALESCE(MAX(mois), 0) AS m FROM fait_prime WHERE exercice = $1
       ),
       prime_mensuelle AS (
         SELECT exercice, SUM(montant_emis) / 12.0 AS prime
         FROM fait_prime WHERE exercice IN ($1, $1 - 1)
         GROUP BY exercice
       ),
       sinistre_mensuel AS (
         SELECT exercice, mois, SUM(montant_paye) AS sinistre
         FROM fait_sinistre WHERE exercice IN ($1, $1 - 1)
         GROUP BY exercice, mois
       )
       SELECT
         m.mois,
         CASE WHEN m.mois <= me.m
           THEN ROUND(COALESCE(sa.sinistre, 0) / NULLIF(pa.prime, 0) * 100, 1)
         END AS sp_actuel_pct,
         ROUND(COALESCE(sp.sinistre, 0) / NULLIF(pp.prime, 0) * 100, 1) AS sp_precedent_pct
       FROM generate_series(1, 12) AS m(mois)
       CROSS JOIN mois_ecoule me
       LEFT JOIN prime_mensuelle pa ON pa.exercice = $1
       LEFT JOIN prime_mensuelle pp ON pp.exercice = $1 - 1
       LEFT JOIN sinistre_mensuel sa ON sa.exercice = $1 AND sa.mois = m.mois
       LEFT JOIN sinistre_mensuel sp ON sp.exercice = $1 - 1 AND sp.mois = m.mois
       ORDER BY m.mois`,
      [exercice],
    );
  }
}
