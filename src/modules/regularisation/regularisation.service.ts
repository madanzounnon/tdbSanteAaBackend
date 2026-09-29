import { AppDataSource } from '../../data-source';

export class RegularisationService {
  async getPolicesCritiques(exercice: number) {
    return AppDataSource.query(
      `SELECT
         numero_police,
         prime_emise AS prime_annuelle,
         sinistres_payes AS consommation,
         sp_emis_pct AS sp_global,
         statut_risque,
         statut_police
       FROM mv_sp_portefeuille
       WHERE exercice = $1 AND statut_risque IN ('critique', 'perte_seche')
       ORDER BY sp_emis_pct DESC`,
      [exercice],
    );
  }

  // Distingue les polices déjà échues (S/P figé, régularisation à engager
  // sans attendre — cahier §6.1 "Nombre de Polices à Régulariser") des
  // polices encore actives mais déjà en zone critique ("Polices Critiques
  // Actives", action possible en cours de contrat). Inclut aussi le total
  // de polices échues et les polices saines pour les 4 tuiles de synthèse
  // "Polices Régularisables — par Exercice Clos".
  async getPolicesParStatut(exercice: number) {
    const [[{ total, echues, saines, actives }], [{ cloturees }]] = await Promise.all([
      AppDataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE statut_police = 'echue') AS total,
           COUNT(*) FILTER (WHERE statut_police = 'echue' AND statut_risque IN ('critique', 'perte_seche')) AS echues,
           COUNT(*) FILTER (WHERE statut_police = 'echue' AND statut_risque NOT IN ('critique', 'perte_seche')) AS saines,
           COUNT(*) FILTER (WHERE statut_police = 'active' AND statut_risque IN ('critique', 'perte_seche')) AS actives
         FROM mv_sp_portefeuille WHERE exercice = $1`,
        [exercice],
      ),
      // Cahier §6.1 "Nombre total de police clôturé sur un exercice" : la
      // clôture (3 mois après l'échéance, cf. dim_police.date_cloture) est
      // un événement distinct de l'échéance elle-même — ne PAS assimiler
      // "clôturé" à "échue" (statut_police), qui bascule dès la date
      // d'échéance, sans attendre le délai d'enregistrement des factures
      // en retard.
      AppDataSource.query(
        `SELECT COUNT(*) AS cloturees FROM dim_police WHERE EXTRACT(YEAR FROM date_cloture) = $1`,
        [exercice],
      ),
    ]);
    return {
      totalPolices: Number(total),
      policesARegulariser: Number(echues),
      policesSaines: Number(saines),
      policesCritiquesActives: Number(actives),
      policesCloturees: Number(cloturees),
      tauxRegularisationPct: Number(total) > 0 ? Math.round((Number(echues) / Number(total)) * 1000) / 10 : 0,
    };
  }

  // Cahier §6.1 "Taux de Régularisation Complété (%)" = Polices Régularisées
  // / Polices Identifiées à Régulariser × 100 — un taux D'ABOUTISSEMENT
  // (combien de dossiers identifiés ont réellement reçu un avenant de
  // régularisation), PAS le taux de détection déjà exposé sous
  // `tauxRegularisationPct` dans getPolicesParStatut (régularisables/total
  // échues, qui répond à une question différente : combien de polices
  // échues sont EN BESOIN de régularisation, pas combien ont été traitées).
  // "Polices Régularisées" = polices identifiées à régulariser (échues,
  // S/P > 75%) qui ont aussi au moins un avenant réel dans v_regularisation
  // pour ce même exercice (nature='J', cf. migration 1700000000012).
  async getTauxRegularisationComplete(exercice: number) {
    const [{ identifiees, regularisees }] = await AppDataSource.query(
      `SELECT
         COUNT(*) AS identifiees,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM v_regularisation r
             WHERE r.police_id = mv.police_id AND r.exercice = mv.exercice
           )
         ) AS regularisees
       FROM mv_sp_portefeuille mv
       WHERE mv.exercice = $1 AND mv.statut_police = 'echue' AND mv.statut_risque IN ('critique', 'perte_seche')`,
      [exercice],
    );
    return {
      policesIdentifiees: Number(identifiees),
      policesRegularisees: Number(regularisees),
      tauxRegularisationCompletePct: Number(identifiees) > 0
        ? Math.round((Number(regularisees) / Number(identifiees)) * 1000) / 10
        : null,
    };
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
         COUNT(*) AS nb,
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
