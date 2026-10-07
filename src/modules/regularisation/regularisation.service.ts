import { AppDataSource } from '../../data-source';

export class RegularisationService {
  // Liste paginée (tri S/P décroissant) : { donnees, total, page, taille, pages }.
  async getPolicesCritiques(exercice: number, page = 1, taille = 15) {
    const rows: any[] = await AppDataSource.query(
      `SELECT
         COUNT(*) OVER()::int AS total_lignes,
         mv.numero_police,
         p.souscripteur,
         -- prime_annuelle = prime DE L'EXERCICE (part des quittances couvrant
         -- l'exercice, au prorata des jours) : base du S/P global.
         -- primes_emises = quittances dont la date d'effet tombe dans
         -- l'exercice (base du chiffre d'affaires), pour comparaison.
         mv.prime_emise AS prime_annuelle,
         COALESCE(pe.primes_emises, 0) AS primes_emises,
         mv.sinistres_payes AS consommation,
         mv.sp_emis_pct AS sp_global,
         mv.statut_risque,
         mv.statut_police
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       LEFT JOIN (
         SELECT police_id, SUM(montant_emis) AS primes_emises
         FROM fait_prime WHERE exercice = $1 GROUP BY police_id
       ) pe ON pe.police_id = mv.police_id
       WHERE mv.exercice = $1 AND mv.statut_risque IN ('critique', 'perte_seche')
       ORDER BY mv.sp_emis_pct DESC, mv.numero_police
       LIMIT $2 OFFSET $3`,
      [exercice, taille, (page - 1) * taille],
    );
    let total = rows[0]?.total_lignes ?? 0;
    if (!rows.length && page > 1) {
      const [{ n }] = await AppDataSource.query(
        `SELECT COUNT(*)::int AS n FROM mv_sp_portefeuille
         WHERE exercice = $1 AND statut_risque IN ('critique', 'perte_seche')`,
        [exercice],
      );
      total = n;
    }
    return {
      donnees: rows.map(({ total_lignes, ...r }) => r),
      total,
      page,
      taille,
      pages: Math.max(1, Math.ceil(total / taille)),
    };
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
               AND r.montant_a_regulariser > 0
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

  // Les avenants d'ajustement de prime (nature J) vont dans les deux sens :
  //  - SUPPLÉMENT (montant > 0) : complément de prime dû par le client —
  //    seul cas "à encaisser" ;
  //  - RISTOURNE (montant < 0) : trop-perçu à rembourser au client ; le
  //    "montant encaissé" ORASS de ces quittances est le règlement de la
  //    ristourne, PAS une rentrée d'argent.
  // Les additionner donnait un "à encaisser" négatif (2026 : 17,7 M de
  // suppléments − 86,8 M de ristournes = −69,1 M) et comptait les
  // ristournes réglées comme de l'encaissé. Suivis séparés désormais.
  async getMontantsARegulariser(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COALESCE(SUM(montant_a_regulariser) FILTER (WHERE montant_a_regulariser > 0), 0) AS montant_total_a_regulariser,
         COALESCE(SUM(montant_encaisse) FILTER (WHERE montant_a_regulariser > 0), 0) AS deja_encaisse,
         COALESCE(SUM(montant_a_regulariser - montant_encaisse) FILTER (WHERE montant_a_regulariser > 0), 0) AS reste_a_recouvrer,
         ROUND(SUM(montant_encaisse) FILTER (WHERE montant_a_regulariser > 0)
               / NULLIF(SUM(montant_a_regulariser) FILTER (WHERE montant_a_regulariser > 0), 0) * 100, 1) AS taux_encaissement_pct,
         COUNT(*) FILTER (WHERE montant_a_regulariser > 0) AS nb_supplements,
         COUNT(*) FILTER (WHERE montant_a_regulariser < 0) AS nb_ristournes,
         COALESCE(-SUM(montant_a_regulariser) FILTER (WHERE montant_a_regulariser < 0), 0) AS ristournes_total,
         COALESCE(SUM(LEAST(ABS(montant_encaisse), -montant_a_regulariser)) FILTER (WHERE montant_a_regulariser < 0), 0) AS ristournes_reglees
       FROM v_regularisation WHERE exercice = $1`,
      [exercice],
    );
    return {
      ...result,
      ristournes_restantes: Number(result.ristournes_total) - Number(result.ristournes_reglees),
    };
  }

  async getSuiviParCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         COUNT(*) FILTER (WHERE r.montant_a_regulariser > 0) AS nb,
         COALESCE(SUM(r.montant_a_regulariser) FILTER (WHERE r.montant_a_regulariser > 0), 0) AS a_encaisser,
         COALESCE(SUM(r.montant_encaisse) FILTER (WHERE r.montant_a_regulariser > 0), 0) AS encaisse,
         COALESCE(SUM(r.montant_a_regulariser - r.montant_encaisse) FILTER (WHERE r.montant_a_regulariser > 0), 0) AS reste,
         ROUND(SUM(r.montant_encaisse) FILTER (WHERE r.montant_a_regulariser > 0)
               / NULLIF(SUM(r.montant_a_regulariser) FILTER (WHERE r.montant_a_regulariser > 0), 0) * 100, 1) AS taux_pct,
         COUNT(*) FILTER (WHERE r.montant_a_regulariser < 0) AS nb_ristournes,
         COALESCE(-SUM(r.montant_a_regulariser) FILTER (WHERE r.montant_a_regulariser < 0), 0) AS ristournes
       FROM v_regularisation r
       JOIN dim_canal c ON c.id = r.canal_id
       WHERE r.exercice = $1
       GROUP BY c.nom
       ORDER BY reste DESC, ristournes DESC`,
      [exercice],
    );
  }
}
