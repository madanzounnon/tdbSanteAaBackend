import { AppDataSource } from '../../data-source';

export class ChiffreAffairesService {
  async getKpis(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         SUM(fp.montant_emis) AS ca_ytd,
         SUM(fp.montant_encaisse) AS ca_encaisse_ytd,
         ROUND(SUM(fp.montant_encaisse) / NULLIF(SUM(fp.montant_emis), 0) * 100, 1) AS taux_recouvrement,
         COUNT(DISTINCT fp.police_id) AS nombre_polices,
         SUM(fp.commission_versee) AS commissions_versees,
         ROUND(SUM(fp.commission_versee) / NULLIF(SUM(fp.montant_emis), 0) * 100, 1) AS taux_commission_pct,
         oa.montant_ca_objectif AS objectif_ca
       FROM fait_prime fp
       LEFT JOIN objectif_annuel oa ON oa.exercice = fp.exercice
       WHERE fp.exercice = $1
       GROUP BY oa.montant_ca_objectif`,
      [exercice],
    );
    return result || null;
  }

  // Vue pluriannuelle (cahier §2 "Tendance Globale 2021-2026" et §3.1
  // "TCAM du Chiffre d'Affaires") : CA, encaissé, S/P et objectif par
  // exercice, sur la plage demandée.
  async getHistorique(debut: number, fin: number) {
    return AppDataSource.query(
      `SELECT
         fp.exercice,
         SUM(fp.montant_emis) AS ca_ytd,
         SUM(fp.montant_encaisse) AS ca_encaisse_ytd,
         COUNT(DISTINCT fp.police_id) AS nombre_polices,
         sp.sp_pct,
         oa.montant_ca_objectif AS objectif_ca
       FROM fait_prime fp
       LEFT JOIN (
         SELECT exercice, ROUND(SUM(sinistres_payes) / NULLIF(SUM(prime_acquise), 0) * 100, 1) AS sp_pct
         FROM mv_sp_portefeuille GROUP BY exercice
       ) sp ON sp.exercice = fp.exercice
       LEFT JOIN objectif_annuel oa ON oa.exercice = fp.exercice
       WHERE fp.exercice BETWEEN $1 AND $2
       GROUP BY fp.exercice, sp.sp_pct, oa.montant_ca_objectif
       ORDER BY fp.exercice`,
      [debut, fin],
    );
  }

  async getParCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         c.type_canal,
         SUM(fp.montant_emis) AS ca_canal,
         ROUND(SUM(fp.montant_emis) * 100.0 / SUM(SUM(fp.montant_emis)) OVER (), 1) AS part_marche_pct
       FROM fait_prime fp
       JOIN dim_police p ON p.id = fp.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE fp.exercice = $1
       GROUP BY c.nom, c.type_canal
       ORDER BY ca_canal DESC`,
      [exercice],
    );
  }

  // §3.1 : Nombre de Nouvelles Affaires (NA) vs Renouvellements (REN).
  // NA = police dont la 1ère quittance de l'exercice n'a aucun avenant
  // (type_avenant_id IS NULL, càd numeaven était NULL en source).
  // REN = police avec une quittance liée à dim_type_avenant.code = '1'
  // ("Avenant de renouvellement", confirmé côté métier) — les autres
  // avenants (incorporation, modification, retrait, ajustement...) ne
  // comptent ni comme NA ni comme REN.
  //
  // "Polices Arrivées à Échéance" = polices dont dim_police.date_echeance
  // tombe dans l'exercice demandé, indépendamment de leur date d'émission
  // (une police échue en 2026 peut avoir été émise n'importe quelle année).
  // Taux de Renouvellement = REN / Polices Arrivées à Échéance × 100.
  async getProduction(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(DISTINCT CASE WHEN ta.code IS NULL THEN fp.police_id END) AS nouvelles_affaires,
         COUNT(DISTINCT CASE WHEN ta.code = '1' THEN fp.police_id END) AS renouvellements
       FROM fait_prime fp
       LEFT JOIN dim_type_avenant ta ON ta.id = fp.type_avenant_id
       WHERE fp.exercice = $1`,
      [exercice],
    );

    const [{ polices_echeance: policesEcheance }] = await AppDataSource.query(
      `SELECT COUNT(*) AS polices_echeance FROM dim_police WHERE EXTRACT(YEAR FROM date_echeance) = $1`,
      [exercice],
    );

    return {
      ...result,
      polices_echeance: policesEcheance,
      taux_renouvellement_pct: Number(policesEcheance) > 0
        ? Math.round((Number(result.renouvellements) / Number(policesEcheance)) * 1000) / 10
        : null,
    };
  }

  // Tranche calculée sur la prime de l'exercice (SUM(fait_prime.montant_emis)),
  // jamais une valeur figée sur dim_police — une police change de tranche
  // d'un exercice à l'autre selon sa prime réelle sur la période. Seuils
  // repris du cahier §3.4. Le statut S/P (mv_sp_portefeuille) est joint pour
  // ventiler chaque tranche en Saines / Vigilance / Critiques (cahier §3.4
  // "Analyse du nombre de polices saines vs en régularisation par tranche").
  async getRepartitionParTranche(exercice: number) {
    return AppDataSource.query(
      `SELECT
         tranche,
         COUNT(*) AS nombre_polices,
         SUM(prime_exercice) AS primes_cumulees,
         COUNT(*) FILTER (WHERE statut_risque = 'saine') AS saines,
         COUNT(*) FILTER (WHERE statut_risque = 'vigilance') AS vigilance,
         COUNT(*) FILTER (WHERE statut_risque IN ('critique', 'perte_seche')) AS critiques
       FROM (
         SELECT
           fp.police_id,
           SUM(fp.montant_emis) AS prime_exercice,
           mv.statut_risque,
           CASE
             WHEN SUM(fp.montant_emis) < 5000000 THEN '< 5 M'
             WHEN SUM(fp.montant_emis) < 10000000 THEN '5 - 10 M'
             WHEN SUM(fp.montant_emis) < 20000000 THEN '10 - 20 M'
             WHEN SUM(fp.montant_emis) < 50000000 THEN '20 - 50 M'
             WHEN SUM(fp.montant_emis) < 100000000 THEN '50 - 100 M'
             WHEN SUM(fp.montant_emis) < 200000000 THEN '100 - 200 M'
             ELSE '> 200 M'
           END AS tranche
         FROM fait_prime fp
         LEFT JOIN mv_sp_portefeuille mv ON mv.police_id = fp.police_id AND mv.exercice = fp.exercice
         WHERE fp.exercice = $1
         GROUP BY fp.police_id, mv.statut_risque
       ) par_police
       GROUP BY tranche`,
      [exercice],
    );
  }

  // §3.1 : CA mensuel de l'exercice (Jan.-Déc.).
  async getCaMensuel(exercice: number) {
    return AppDataSource.query(
      `SELECT mois, SUM(montant_emis) AS ca
       FROM fait_prime WHERE exercice = $1
       GROUP BY mois ORDER BY mois`,
      [exercice],
    );
  }

  // §3.4 "Suffisance du Tarif" : Nombre d'assurés, taux de recours aux soins
  // et coût moyen des soins par personne soignée, par type (adulte/enfant).
  // NB : dim_assure.prime_annuelle vaut 0 pour toutes les lignes (bug ETL —
  // facts.loader.ts:64 passe la prime en dur à 0, faute de source dédiée à
  // l'extraction sinistre). Les indicateurs qui en dépendent (prime moyenne,
  // taux de consommation du budget, budget restant) restent donc à null
  // plutôt que d'être calculés sur une donnée fausse.
  async getPrimeConsommationParAssure(exercice: number) {
    const rows = await AppDataSource.query(
      `SELECT
         a.type_assure,
         COUNT(DISTINCT a.id) AS effectif,
         COUNT(DISTINCT fs.assure_id) AS assures_avec_soins,
         COALESCE(SUM(fs.montant_paye), 0) AS sinistres_payes,
         AVG(a.prime_annuelle) AS prime_annuelle_moyenne
       FROM dim_assure a
       JOIN dim_police p ON p.id = a.police_id
       LEFT JOIN fait_sinistre fs ON fs.assure_id = a.id AND fs.exercice = $1
       WHERE EXISTS (SELECT 1 FROM fait_prime fp WHERE fp.police_id = p.id AND fp.exercice = $1)
       GROUP BY a.type_assure`,
      [exercice],
    );

    const primeAnnuelleFiable = false; // cf. note ETL ci-dessus.
    return rows.map((r: any) => ({
      typeAssure: r.type_assure,
      effectif: Number(r.effectif),
      assuresAvecSoins: Number(r.assures_avec_soins),
      tauxRecoursPct: Number(r.effectif) > 0
        ? Math.round((Number(r.assures_avec_soins) / Number(r.effectif)) * 1000) / 10 : 0,
      sinistresPayes: Number(r.sinistres_payes),
      coutMoyenParPersonneSoignee: Number(r.assures_avec_soins) > 0
        ? Math.round(Number(r.sinistres_payes) / Number(r.assures_avec_soins)) : 0,
      primeAnnuelleMoyenne: primeAnnuelleFiable ? Number(r.prime_annuelle_moyenne) : null,
    }));
  }
}
