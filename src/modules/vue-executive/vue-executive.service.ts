import { AppDataSource } from '../../data-source';

// Agrège les 6 cartes KPI de la Vue Exécutive en une seule requête,
// pour un affichage rapide de la page de synthèse DG.
export class VueExecutiveService {
  async getSynthese(exercice: number) {
    const raw = AppDataSource;

    const [ca] = await raw.query(
      `SELECT
         SUM(fp.montant_emis) AS ca_ytd,
         SUM(fp.montant_encaisse) AS ca_encaisse_ytd,
         ROUND(SUM(fp.montant_encaisse) / NULLIF(SUM(fp.montant_emis), 0) * 100, 1) AS taux_recouvrement,
         oa.montant_ca_objectif AS objectif_ca
       FROM fait_prime fp
       LEFT JOIN objectif_annuel oa ON oa.exercice = fp.exercice
       WHERE fp.exercice = $1
       GROUP BY oa.montant_ca_objectif`,
      [exercice],
    );

    const [sp] = await raw.query(
      `SELECT
         ROUND(SUM(sinistres_payes) / NULLIF(SUM(prime_acquise), 0) * 100, 1) AS sp_portefeuille_pct,
         SUM(prime_acquise) - SUM(sinistres_payes) AS surplus_technique,
         ROUND((SUM(prime_acquise) - SUM(sinistres_payes)) / NULLIF(SUM(prime_acquise), 0) * 100, 1) AS taux_rentabilite_pct
       FROM mv_sp_portefeuille WHERE exercice = $1`,
      [exercice],
    );

    const [factures] = await raw.query(
      `SELECT
         COUNT(*) FILTER (WHERE statut = 'en_retard') AS factures_en_retard,
         COALESCE(SUM(montant) FILTER (WHERE statut = 'en_retard'), 0) AS montant_en_retard
       FROM fait_facture_prestataire`,
    );

    const [policesCritiques] = await raw.query(
      `SELECT
         COUNT(*) FILTER (WHERE statut_risque IN ('critique', 'perte_seche')) AS polices_critiques,
         COUNT(*) FILTER (WHERE statut_risque = 'perte_seche') AS polices_perte_seche
       FROM mv_sp_portefeuille WHERE exercice = $1`,
      [exercice],
    );

    return {
      chiffreAffaires: ca,
      sinistralite: sp,
      prestataires: factures,
      regularisation: policesCritiques,
    };
  }

  // Cahier §2.1 : les KPIs "Chiffre d'Affaires YTD", "CA Encaissé & Taux de
  // Recouvrement" et "Rentabilité Technique" affichent tous une "tendance
  // vs. la même période de l'exercice précédent". "Même période" = mêmes
  // mois écoulés (ex. YTD Q1 2026 vs YTD Q1 2025), jamais l'exercice N-1
  // complet — sinon la comparaison favorise artificiellement N-1.
  private async getPeriode(exercice: number, moisEcoule: number) {
    const [ca] = await AppDataSource.query(
      `SELECT
         COALESCE(SUM(montant_emis), 0) AS ca,
         COALESCE(SUM(montant_encaisse), 0) AS encaisse
       FROM fait_prime WHERE exercice = $1 AND mois <= $2`,
      [exercice, moisEcoule],
    );
    const [sinistre] = await AppDataSource.query(
      `SELECT COALESCE(SUM(montant_paye), 0) AS sinistres
       FROM fait_sinistre WHERE exercice = $1 AND mois <= $2`,
      [exercice, moisEcoule],
    );

    const caTotal = Number(ca.ca);
    const encaisse = Number(ca.encaisse);
    const sinistres = Number(sinistre.sinistres);
    // Même formule de prime acquise que mv_sp_portefeuille (§4.1) :
    // prime émise × (mois écoulés / 12).
    const primeAcquise = caTotal * (moisEcoule / 12);
    const surplus = primeAcquise - sinistres;

    return {
      exercice,
      ca_ytd: caTotal,
      ca_encaisse_ytd: encaisse,
      taux_recouvrement: caTotal > 0 ? Math.round((encaisse / caTotal) * 1000) / 10 : 0,
      surplus_technique: surplus,
      taux_rentabilite_pct: primeAcquise > 0 ? Math.round((surplus / primeAcquise) * 1000) / 10 : 0,
    };
  }

  async getTendanceN1(exercice: number) {
    const [{ mois_ecoule: moisEcoule }] = await AppDataSource.query(
      `SELECT COALESCE(MAX(mois), 0) AS mois_ecoule FROM fait_prime WHERE exercice = $1`,
      [exercice],
    );

    const [actuel, precedent] = await Promise.all([
      this.getPeriode(exercice, moisEcoule),
      this.getPeriode(exercice - 1, moisEcoule),
    ]);

    const evolutionPct = (valeurActuelle: number, valeurPrecedente: number) => (
      valeurPrecedente !== 0 ? Math.round(((valeurActuelle - valeurPrecedente) / valeurPrecedente) * 1000) / 10 : null
    );

    return {
      moisEcoule,
      actuel,
      precedent,
      evolution: {
        ca_pct: evolutionPct(actuel.ca_ytd, precedent.ca_ytd),
        recouvrement_pts: Math.round((actuel.taux_recouvrement - precedent.taux_recouvrement) * 10) / 10,
        rentabilite_pts: Math.round((actuel.taux_rentabilite_pct - precedent.taux_rentabilite_pct) * 10) / 10,
      },
    };
  }
}
