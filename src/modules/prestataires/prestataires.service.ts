import { AppDataSource } from '../../data-source';

// Statut recalculé dynamiquement (jamais fait_facture_prestataire.statut) :
// ce champ est figé à l'extraction ETL (Date.now() au moment du chargement,
// cf. calculerStatutFacture) et ne se met jamais à jour ensuite — une
// facture qui franchit 45 jours après son chargement resterait "en_attente"
// indéfiniment en base si on s'y fiait (bug déjà corrigé côté Vue Exécutive
// pour la même raison).
const STATUT_CALCULE = `
  CASE
    WHEN f.statut = 'reglee' THEN 'reglee'
    WHEN CURRENT_DATE - f.date_depot > 45 THEN 'en_retard'
    ELSE 'en_attente'
  END
`;

export class PrestatairesService {
  // Agrégats KPI (retard/attente) — lecture indépendante de la liste
  // paginée ci-dessous, pour ne jamais avoir à charger les 9000+ lignes
  // juste pour un total ou une moyenne.
  async getFacturesStats() {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${STATUT_CALCULE} = 'en_retard') AS nb_retard,
         COALESCE(SUM(montant) FILTER (WHERE ${STATUT_CALCULE} = 'en_retard'), 0) AS montant_retard,
         COALESCE(ROUND(AVG(CURRENT_DATE - date_depot) FILTER (WHERE ${STATUT_CALCULE} = 'en_retard')), 0) AS delai_moyen_retard,
         COUNT(*) FILTER (WHERE ${STATUT_CALCULE} = 'en_attente') AS nb_attente,
         COALESCE(SUM(montant) FILTER (WHERE ${STATUT_CALCULE} = 'en_attente'), 0) AS montant_attente
       FROM fait_facture_prestataire f
       WHERE f.statut != 'reglee'`,
    );
    return result;
  }

  // Liste paginée des factures pour l'onglet Tout/Retard/Attente/Réglé —
  // impayées toutes dates confondues + réglées de l'exercice demandé
  // (cohérent avec "Factures Réglées {exercice}" affiché par ailleurs).
  // Filtres construits séparément pour chaque requête (au lieu de calculer
  // des indices de paramètres partagés entre les deux) : plus verbeux, mais
  // chaque `$n` est visible en clair dans sa propre requête.
  async getFactures(exercice: number, statut: string | null, recherche: string | null, page: number, limite: number) {
    const conditions: string[] = [`(f.statut != 'reglee' OR EXTRACT(YEAR FROM f.date_reglement) = $1)`];
    const filtres: unknown[] = [exercice];
    if (statut && statut !== 'tout') {
      filtres.push(statut);
      conditions.push(`${STATUT_CALCULE} = $${filtres.length}`);
    }
    if (recherche) {
      filtres.push(`%${recherche}%`);
      conditions.push(`p.nom ILIKE $${filtres.length}`);
    }
    const whereClause = conditions.join(' AND ');

    const rows = await AppDataSource.query(
      `SELECT
         p.nom AS prestataire_nom,
         f.date_depot,
         f.date_reglement,
         f.montant AS facture_montant,
         ${STATUT_CALCULE} AS facture_statut,
         CURRENT_DATE - f.date_depot AS jours_ecoules
       FROM fait_facture_prestataire f
       JOIN dim_prestataire p ON p.id = f.prestataire_id
       WHERE ${whereClause}
       ORDER BY jours_ecoules DESC
       LIMIT $${filtres.length + 1} OFFSET $${filtres.length + 2}`,
      [...filtres, limite, (page - 1) * limite],
    );

    const [{ total }] = await AppDataSource.query(
      `SELECT COUNT(*) AS total
       FROM fait_facture_prestataire f
       JOIN dim_prestataire p ON p.id = f.prestataire_id
       WHERE ${whereClause}`,
      filtres,
    );

    return { data: rows, total: Number(total) };
  }

  // Cahier §5.1 "Nombre Total de Facture réglés de l'année en cours" —
  // décompte + montant des factures réglées dont le règlement (pas le
  // dépôt) tombe dans l'exercice demandé.
  async getFacturesReglees(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(*) AS nombre,
         COALESCE(SUM(montant), 0) AS montant_total
       FROM fait_facture_prestataire
       WHERE statut = 'reglee' AND EXTRACT(YEAR FROM date_reglement) = $1`,
      [exercice],
    );
    return result;
  }

  // Cahier §5.1 "Répartition du nombre de prestataires par catégorie" —
  // décompte du réseau conventionné par catégorie (Pharmacie, Clinique,
  // Laboratoire...), pour situer la diversité de l'offre de soins.
  async getParCategorie() {
    return AppDataSource.query(`
      SELECT
        categorie,
        COUNT(*) AS nombre,
        ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS part_pct
      FROM dim_prestataire
      WHERE conventionne = true
      GROUP BY categorie
      ORDER BY nombre DESC
    `);
  }

  // Cahier §5.1 "Délai Moyen de Règlement" / "Taux de Règlement dans les
  // Délais" — KPIs RÉSEAU (toutes factures réglées de l'exercice
  // confondues), pas une moyenne des moyennes par prestataire (biais :
  // un prestataire à 2 factures pèserait autant qu'un à 500 dans
  // getPerformanceParExercice, calculé côté client jusqu'ici). Calculé
  // directement sur fait_facture_prestataire, pondéré par facture.
  async getReseauStats(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(DISTINCT f.prestataire_id) AS nb_prestataires_actifs,
         ROUND(AVG(f.date_reglement - f.date_depot), 0) AS delai_moyen_reglement,
         ROUND(
           COUNT(*) FILTER (WHERE f.date_reglement - f.date_depot <= 45) * 100.0
           / NULLIF(COUNT(*), 0), 1
         ) AS taux_reglement_delai_pct
       FROM fait_facture_prestataire f
       WHERE f.statut = 'reglee' AND EXTRACT(YEAR FROM f.date_reglement) = $1`,
      [exercice],
    );
    return result;
  }

  async getPerformanceParExercice() {
    return AppDataSource.query(`
      SELECT
        p.nom AS prestataire,
        p.categorie,
        EXTRACT(YEAR FROM f.date_depot) AS exercice,
        COUNT(*) AS nombre_actes,
        SUM(f.montant) AS montant_total,
        ROUND(AVG(f.date_reglement - f.date_depot), 0) AS delai_moyen_jours,
        ROUND(
          COUNT(*) FILTER (WHERE f.date_reglement - f.date_depot <= 45) * 100.0
          / NULLIF(COUNT(*) FILTER (WHERE f.statut = 'reglee'), 0), 1
        ) AS taux_reglement_delai_pct
      FROM fait_facture_prestataire f
      JOIN dim_prestataire p ON p.id = f.prestataire_id
      GROUP BY p.nom, p.categorie, EXTRACT(YEAR FROM f.date_depot)
      ORDER BY montant_total DESC
    `);
  }
}