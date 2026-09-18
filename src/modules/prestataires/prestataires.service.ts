import { AppDataSource } from '../../data-source';
import { FaitFacturePrestataire } from '../../entities/fait-facture-prestataire.entity';

export class PrestatairesService {
  async getFacturesImpayees() {
    const repo = AppDataSource.getRepository(FaitFacturePrestataire);
    return repo
      .createQueryBuilder('facture')
      .leftJoinAndSelect('facture.prestataire', 'prestataire')
      .select([
        'prestataire.nom',
        'facture.dateDepot',
        'facture.montant',
        'facture.statut',
      ])
      .addSelect(`CURRENT_DATE - facture."date_depot"`, 'jours_ecoules')
      .where('facture.statut != :reglee', { reglee: 'reglee' })
      .orderBy('facture.dateDepot', 'ASC')
      .getRawMany();
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

  async getPerformanceParExercice() {
    return AppDataSource.query(`
      SELECT
        p.nom AS prestataire,
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
      GROUP BY p.nom, EXTRACT(YEAR FROM f.date_depot)
      ORDER BY montant_total DESC
    `);
  }
}