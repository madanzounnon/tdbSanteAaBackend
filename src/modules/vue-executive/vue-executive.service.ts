import { AppDataSource } from '../../data-source';

// Agrège les 6 cartes KPI de la Vue Exécutive en une seule requête,
// pour un affichage rapide de la page de synthèse DG.
export class VueExecutiveService {
  async getSynthese(exercice: number) {
    const raw = AppDataSource;

    const [ca] = await raw.query(
      `SELECT
         SUM(montant_emis) AS ca_ytd,
         SUM(montant_encaisse) AS ca_encaisse_ytd,
         ROUND(SUM(montant_encaisse) / NULLIF(SUM(montant_emis), 0) * 100, 1) AS taux_recouvrement
       FROM fait_prime WHERE exercice = $1`,
      [exercice],
    );

    const [sp] = await raw.query(
      `SELECT
         ROUND(AVG(sp_acquis_pct), 1) AS sp_portefeuille_pct,
         SUM(prime_acquise) - SUM(sinistres_payes) AS surplus_technique
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
}
