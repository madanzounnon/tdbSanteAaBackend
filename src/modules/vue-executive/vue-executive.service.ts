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

    // Retard calculé dynamiquement (CURRENT_DATE - date_depot > 45), jamais
    // via la colonne statut : celle-ci est figée à l'extraction ETL
    // (calculerStatutFacture utilise Date.now() au moment du chargement) et
    // ne se met à jour que si la ligne est retouchée par un futur run —
    // une facture qui franchit 45 jours après son chargement reste donc
    // 'en_attente' indéfiniment en base. Même calcul dynamique que la page
    // Prestataires (getFacturesImpayees + filtre frontend), pour rester
    // cohérent entre les deux vues.
    //
    // Cahier §2.1 "Factures Prestataires Impayées" : le KPI doit porter le
    // TOTAL des factures non réglées (attente + retard), avec distinction
    // des deux — pas seulement le retard (bug corrigé : le KPI n'affichait
    // que factures_en_retard jusqu'ici).
    const [factures] = await raw.query(
      `SELECT
         COUNT(*) FILTER (WHERE statut != 'reglee' AND CURRENT_DATE - date_depot > 45) AS factures_en_retard,
         COALESCE(SUM(montant) FILTER (WHERE statut != 'reglee' AND CURRENT_DATE - date_depot > 45), 0) AS montant_en_retard,
         COUNT(*) FILTER (WHERE statut != 'reglee' AND CURRENT_DATE - date_depot <= 45) AS factures_en_attente,
         COALESCE(SUM(montant) FILTER (WHERE statut != 'reglee' AND CURRENT_DATE - date_depot <= 45), 0) AS montant_en_attente,
         COUNT(*) FILTER (WHERE statut != 'reglee') AS factures_impayees_total,
         COALESCE(SUM(montant) FILTER (WHERE statut != 'reglee'), 0) AS montant_impayees_total
       FROM fait_facture_prestataire`,
    );

    // Cahier §2.1 "Polices à Risque (S/P > 65%)" : le KPI doit porter sur le
    // seuil 65% (vigilance + critique + perte sèche), ventilé par souscatégorie — pas seulement les critiques (>75%), qui restent par ailleurs
    // le chiffre pertinent pour la carte/recommandation Régularisation
    // (§6.1, seuil différent, jamais mélanger les deux).
    const [policesCritiques] = await raw.query(
      `SELECT
         COUNT(*) FILTER (WHERE statut_risque IN ('vigilance', 'critique', 'perte_seche')) AS polices_a_risque,
         COUNT(*) FILTER (WHERE statut_risque = 'vigilance') AS polices_vigilance,
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

  // Cahier §2.2 "Indicateurs Flash" : "projection de fin d'année avec
  // probabilité d'atteinte de l'objectif". Projection au prorata de la
  // SAISONNALITÉ N-1 (pas un simple linéaire CA YTD / mois écoulé × 12,
  // qui surestimerait grossièrement une branche où les primes s'émettent
  // par gros paquets de renouvellement en début d'exercice, cf.
  // getSpMensuel) : Projection = CA YTD actuel × (CA total N-1 / CA YTD
  // N-1 sur les mêmes mois écoulés). Repli sur le linéaire seulement si
  // N-1 n'a aucune donnée sur la période (évite une division par zéro).
  async getProjectionAnnuelle(exercice: number) {
    const [{ mois_ecoule: moisEcoule }] = await AppDataSource.query(
      `SELECT COALESCE(MAX(mois), 0) AS mois_ecoule FROM fait_prime WHERE exercice = $1`,
      [exercice],
    );

    const [{ ca: caYtdActuel }] = await AppDataSource.query(
      `SELECT COALESCE(SUM(montant_emis), 0) AS ca FROM fait_prime WHERE exercice = $1 AND mois <= $2`,
      [exercice, moisEcoule],
    );
    const [{ ca: caYtdN1MemePeriode }] = await AppDataSource.query(
      `SELECT COALESCE(SUM(montant_emis), 0) AS ca FROM fait_prime WHERE exercice = $1 AND mois <= $2`,
      [exercice - 1, moisEcoule],
    );
    const [{ ca: caTotalN1 }] = await AppDataSource.query(
      `SELECT COALESCE(SUM(montant_emis), 0) AS ca FROM fait_prime WHERE exercice = $1`,
      [exercice - 1],
    );
    const [{ montant_ca_objectif: objectifCa }] = await AppDataSource.query(
      `SELECT montant_ca_objectif FROM objectif_annuel WHERE exercice = $1`,
      [exercice],
    ).then((rows: any[]) => (rows.length ? rows : [{ montant_ca_objectif: null }]));

    const actuel = Number(caYtdActuel);
    const n1MemePeriode = Number(caYtdN1MemePeriode);
    const totalN1 = Number(caTotalN1);
    const objectif = objectifCa !== null ? Number(objectifCa) : null;

    const projection = n1MemePeriode > 0
      ? Math.round(actuel * (totalN1 / n1MemePeriode))
      : moisEcoule > 0 ? Math.round(actuel * (12 / moisEcoule)) : null;

    const ratioObjectif = projection !== null && objectif && objectif > 0 ? projection / objectif : null;
    // Pas de modèle statistique de probabilité en source : niveau qualitatif
    // basé sur l'écart projection/objectif, mêmes paliers que les seuils de
    // recouvrement du cahier (§2.1 : 85%/70%) pour rester cohérent.
    const probabiliteAtteinte = ratioObjectif === null ? null
      : ratioObjectif >= 1 ? 'Élevée'
      : ratioObjectif >= 0.85 ? 'Modérée'
      : 'Faible';

    return {
      moisEcoule,
      projectionCa: projection,
      objectifCa: objectif,
      ratioObjectifPct: ratioObjectif !== null ? Math.round(ratioObjectif * 1000) / 10 : null,
      probabiliteAtteinte,
      methode: n1MemePeriode > 0 ? 'saisonnalite_n1' : 'lineaire',
    };
  }

  // Cahier §2.2 "Recommandations Stratégiques" thématique (1) "Optimisation
  // du mix d'apporteurs" : comparer le S/P par catégorie de canal pour
  // repérer celle qui pèse lourd dans le CA mais dégrade la rentabilité.
  //
  // AMBIGUÏTÉ connue (cf. canal.extractor.ts) : la source (INTERMEDIAIRE/
  // TYPE_INTERMEDIAIRE) ne distingue PAS "Courtier Gestionnaire" de
  // "Courtier Non Gestionnaire" comme le fait l'exemple du cahier — ce
  // flag n'existe nulle part en base. On compare donc les 4 vraies
  // catégories disponibles (bureau_direct, courtier, coordination_agences,
  // bancassurance), même logique mais pas le même détail que l'exemple.
  async getSpParTypeCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.type_canal,
         SUM(mv.prime_emise) AS prime_emise,
         SUM(mv.sinistres_payes) AS sinistres_payes,
         ROUND(SUM(mv.sinistres_payes) / NULLIF(SUM(mv.prime_emise), 0) * 100, 1) AS sp_pct,
         ROUND(SUM(mv.prime_emise) * 100.0 / SUM(SUM(mv.prime_emise)) OVER (), 1) AS part_ca_pct
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE mv.exercice = $1
       GROUP BY c.type_canal
       ORDER BY sp_pct DESC NULLS LAST`,
      [exercice],
    );
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
