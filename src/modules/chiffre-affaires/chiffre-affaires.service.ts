import { AppDataSource } from '../../data-source';
import { dateArrete, debutExercice, finExercice, moisEcoule } from '../commun/periode';

// CHIFFRE D'AFFAIRES = PRIMES ÉMISES de l'exercice (quittances rattachées à
// l'année de leur DATE D'EFFET) — même base que le CA encaissé et le taux de
// recouvrement (encaissé / émis), choix métier du 2026-10-05.
//
// Le CA ACQUIS (primes acquises, au prorata des jours couverts) n'est
// affiché que dans la carte "Chiffre d'Affaires acquis" (getKpis) :
//   CA acquis N = Primes émises N + PPNA au 01/01/N − PPNA au 31/12/N
// via les fonctions SQL prime_acquise / ppna (migration 1700000000017). Il
// reste la base de la sinistralité (mv_sp_portefeuille) et de la
// rentabilité technique.
export class ChiffreAffairesService {
  async getKpis(exercice: number) {
    const [result] = await AppDataSource.query(
      `WITH emis AS (
         SELECT
           COALESCE(SUM(montant_emis), 0) AS primes_emises,
           COALESCE(SUM(montant_encaisse), 0) AS encaisse,
           COALESCE(SUM(commission_versee), 0) AS commissions,
           COUNT(DISTINCT police_id) AS nombre_polices
         FROM fait_prime WHERE exercice = $1
       )
       SELECT
         emis.primes_emises AS ca_ytd,
         emis.encaisse AS ca_encaisse_ytd,
         ROUND(emis.encaisse / NULLIF(emis.primes_emises, 0) * 100, 1) AS taux_recouvrement,
         emis.nombre_polices,
         emis.commissions AS commissions_versees,
         ROUND(emis.commissions / NULLIF(emis.primes_emises, 0) * 100, 1) AS taux_commission_pct,
         (SELECT montant_ca_objectif FROM objectif_annuel WHERE exercice = $1) AS objectif_ca,
         -- Carte "CA acquis" : décomposition de la formule sur l'exercice
         -- complet (provisoire pour l'exercice en cours) + CA acquis à date.
         emis.primes_emises,
         ROUND(ppna(($2::date - 1)), 2) AS ppna_ouverture,
         ROUND(ppna($4::date), 2) AS ppna_cloture,
         (SELECT ROUND(COALESCE(SUM(montant), 0), 2) FROM prime_acquise($2::date, $4::date)) AS ca_acquis_exercice,
         (SELECT ROUND(COALESCE(SUM(montant), 0), 2) FROM prime_acquise($2::date, $3::date)) AS ca_acquis_ytd,
         $3::text AS date_arrete
       FROM emis`,
      [exercice, debutExercice(exercice), dateArrete(exercice), finExercice(exercice)],
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
         COUNT(DISTINCT CASE WHEN ta.code IS NULL THEN fp.police_id END) AS nouvelles_affaires,
         COUNT(DISTINCT CASE WHEN ta.code = '1' THEN fp.police_id END) AS renouvellements,
         sp.sp_pct,
         oa.montant_ca_objectif AS objectif_ca
       FROM fait_prime fp
       LEFT JOIN dim_type_avenant ta ON ta.id = fp.type_avenant_id
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
         ROUND(SUM(fp.montant_emis) * 100.0 / NULLIF(SUM(SUM(fp.montant_emis)) OVER (), 0), 1) AS part_marche_pct
       FROM fait_prime fp
       JOIN dim_police p ON p.id = fp.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE fp.exercice = $1
       GROUP BY c.nom, c.type_canal
       ORDER BY ca_canal DESC`,
      [exercice],
    );
  }

  // Cahier §3.2 "Structure du Portefeuille — Canal → Polices" : donut à 2
  // anneaux (interne = canaux, externe = polices). Renvoie le détail
  // police par police pour que le frontend construise l'anneau externe —
  // l'anneau interne (canaux) se déduit en sommant par canal côté client,
  // déjà cohérent avec getParCanal.
  async getStructurePortefeuille(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         p.numero_police,
         p.souscripteur,
         SUM(fp.montant_emis) AS ca_police
       FROM fait_prime fp
       JOIN dim_police p ON p.id = fp.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE fp.exercice = $1
       GROUP BY c.nom, p.numero_police, p.souscripteur
       ORDER BY c.nom, ca_police DESC`,
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
  // évolution_na_pct / évolution_ren_pct : comparaison du NOMBRE de polices
  // NA/REN vs l'exercice précédent (cahier mockup Figure 2.1) — distincte de
  // la "Croissance Nette du Portefeuille" (variation du nombre TOTAL de
  // polices d'un exercice à l'autre, cf. §3.1), qui répond à une question
  // différente (le portefeuille grossit-il ?) de celle-ci (la conquête et la
  // fidélisation progressent-elles en volume ?).
  private async getNaRen(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         COUNT(DISTINCT CASE WHEN ta.code IS NULL THEN fp.police_id END) AS nouvelles_affaires,
         COUNT(DISTINCT CASE WHEN ta.code = '1' THEN fp.police_id END) AS renouvellements
       FROM fait_prime fp
       LEFT JOIN dim_type_avenant ta ON ta.id = fp.type_avenant_id
       WHERE fp.exercice = $1`,
      [exercice],
    );
    return { nouvellesAffaires: Number(result.nouvelles_affaires), renouvellements: Number(result.renouvellements) };
  }

  async getProduction(exercice: number) {
    const [actuel, precedent] = await Promise.all([
      this.getNaRen(exercice),
      this.getNaRen(exercice - 1),
    ]);

    const [{ polices_echeance: policesEcheance }] = await AppDataSource.query(
      `SELECT COUNT(*) AS polices_echeance FROM dim_police WHERE EXTRACT(YEAR FROM date_echeance) = $1`,
      [exercice],
    );

    const evolutionPct = (actuelle: number, precedente: number) => (
      precedente > 0 ? Math.round(((actuelle - precedente) / precedente) * 1000) / 10 : null
    );

    return {
      nouvelles_affaires: actuel.nouvellesAffaires,
      renouvellements: actuel.renouvellements,
      evolution_na_pct: evolutionPct(actuel.nouvellesAffaires, precedent.nouvellesAffaires),
      evolution_ren_pct: evolutionPct(actuel.renouvellements, precedent.renouvellements),
      polices_echeance: policesEcheance,
      taux_renouvellement_pct: Number(policesEcheance) > 0
        ? Math.round((actuel.renouvellements / Number(policesEcheance)) * 1000) / 10
        : null,
    };
  }

  // Équivalent individuel de NA/REN (ci-dessus), mais au niveau personne
  // plutôt que police : combien d'ayants droit (conjoints/enfants) sont
  // réellement entrés dans la couverture sur l'exercice, via une vraie date
  // source (dim_assure.date_entree <- RISQUE_FAMILLE.dateentr, 96,6%
  // renseigné). Volontairement restreint aux ayants droit : l'assuré
  // principal (RISQUE) n'a aucun champ "date d'entrée" équivalent en
  // source — l'assimiler à la date d'effet de sa police sous-estimerait un
  // salarié entré en cours de contrat existant (avenant d'incorporation,
  // non attribuable à une personne précise en source) et fabriquerait une
  // date. Pas de métrique "nouveaux principaux" tant que ce champ n'existe
  // pas côté RISQUE.
  async getNouveauxAyantsDroit(exercice: number) {
    const compte = async (ex: number) => {
      const [{ nb }] = await AppDataSource.query(
        `SELECT COUNT(*) AS nb FROM dim_assure
         WHERE est_assure_principal = false AND EXTRACT(YEAR FROM date_entree) = $1`,
        [ex],
      );
      return Number(nb);
    };
    const [actuel, precedent] = await Promise.all([compte(exercice), compte(exercice - 1)]);
    return {
      nouveaux_ayants_droit: actuel,
      evolution_pct: precedent > 0 ? Math.round(((actuel - precedent) / precedent) * 1000) / 10 : null,
    };
  }

  // Tranche calculée sur la prime émise de l'exercice (SUM(fait_prime.montant_emis)),
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

  // §3.1 : CA mensuel de l'exercice (Jan.-Déc.) = primes émises par mois
  // d'effet.
  async getCaMensuel(exercice: number) {
    return AppDataSource.query(
      `SELECT mois, SUM(montant_emis) AS ca
       FROM fait_prime WHERE exercice = $1
       GROUP BY mois ORDER BY mois`,
      [exercice],
    );
  }

  // §3.4 "Suffisance du Tarif" : Nombre d'assurés, taux de recours aux soins,
  // coût moyen des soins et prime annuelle par personne, par type (adulte/enfant).
  //
  // dim_assure.prime_annuelle vaut 0 pour toutes les lignes (bug ETL —
  // facts.loader.ts:64, faute de source dédiée à l'extraction sinistre) : la
  // source ne facture jamais la prime par individu, seulement par police. La
  // prime par tête est donc imputée en répartissant la prime nette de chaque
  // police (fait_prime.prime_nette — l'assiette technique, hors accessoires/
  // taxes qui ne couvrent pas le risque, cf. §3.1) à parts égales entre ses
  // assurés, puis moyennée par type. C'est une approximation actuarielle
  // standard en l'absence de tarification individuelle en source, pas une
  // valeur fabriquée : chaque FCFA imputé provient d'une vraie quittance.
  async getPrimeConsommationParAssure(exercice: number) {
    // sinistres_assure PRÉ-agrégé par assuré (1 ligne/assuré) avant jointure :
    // un LEFT JOIN direct sur fait_sinistre dupliquerait la ligne de chaque
    // assuré par son nombre de sinistres, et donc la prime imputée à chaque
    // duplication (même bug de fan-out que mv_sp_portefeuille, cf. migration
    // 1700000000005).
    // Prime annuelle par tête = prime nette ACQUISE sur l'exercice complet
    // (répartie au prorata des jours couverts, comme le CA).
    const rows = await AppDataSource.query(
      `SELECT
         a.type_assure,
         COUNT(*) AS effectif,
         COUNT(sa.assure_id) AS assures_avec_soins,
         COALESCE(SUM(sa.sinistres_payes), 0) AS sinistres_payes,
         COALESCE(SUM(pp.prime_nette_police / ep.total_assures), 0) AS prime_nette_imputee
       FROM dim_assure a
       JOIN dim_police p ON p.id = a.police_id
       JOIN (
         SELECT police_id, COUNT(*) AS total_assures FROM dim_assure GROUP BY police_id
       ) ep ON ep.police_id = a.police_id
       LEFT JOIN (
         SELECT police_id, SUM(prime_nette) AS prime_nette_police
         FROM prime_acquise(make_date($1::int, 1, 1), make_date($1::int, 12, 31)) GROUP BY police_id
       ) pp ON pp.police_id = a.police_id
       LEFT JOIN (
         SELECT assure_id, SUM(montant_paye) AS sinistres_payes
         FROM fait_sinistre WHERE exercice = $1 GROUP BY assure_id
       ) sa ON sa.assure_id = a.id
       WHERE EXISTS (SELECT 1 FROM mv_sp_portefeuille mv WHERE mv.police_id = p.id AND mv.exercice = $1 AND mv.prime_emise <> 0)
       GROUP BY a.type_assure`,
      [exercice],
    );

    // Ligne "Ensemble" recalculée depuis les totaux bruts (pas une moyenne
    // des deux moyennes adulte/enfant, qui serait fausse si les effectifs
    // diffèrent) — même logique que les lignes par type.
    const totaux = rows.reduce(
      (acc: any, r: any) => ({
        effectif: acc.effectif + Number(r.effectif),
        assures_avec_soins: acc.assures_avec_soins + Number(r.assures_avec_soins),
        sinistres_payes: acc.sinistres_payes + Number(r.sinistres_payes),
        prime_nette_imputee: acc.prime_nette_imputee + Number(r.prime_nette_imputee),
      }),
      { effectif: 0, assures_avec_soins: 0, sinistres_payes: 0, prime_nette_imputee: 0 },
    );

    const segments = [...rows, { type_assure: 'ensemble', ...totaux }].map((r: any) => {
      const effectif = Number(r.effectif);
      const sinistresPayes = Number(r.sinistres_payes);
      const primeNetteImputee = Number(r.prime_nette_imputee);
      const primeAnnuelleMoyenne = effectif > 0 ? primeNetteImputee / effectif : 0;
      const consommeParTete = effectif > 0 ? sinistresPayes / effectif : 0;

      return {
        typeAssure: r.type_assure,
        effectif,
        assuresAvecSoins: Number(r.assures_avec_soins),
        tauxRecoursPct: effectif > 0
          ? Math.round((Number(r.assures_avec_soins) / effectif) * 1000) / 10 : 0,
        sinistresPayes,
        coutMoyenParPersonneSoignee: Number(r.assures_avec_soins) > 0
          ? Math.round(sinistresPayes / Number(r.assures_avec_soins)) : 0,
        primeNetteImputeeTotale: primeNetteImputee,
        primeAnnuelleMoyenne: Math.round(primeAnnuelleMoyenne),
        tauxConsommationBudgetPct: primeAnnuelleMoyenne > 0
          ? Math.round((consommeParTete / primeAnnuelleMoyenne) * 1000) / 10 : null,
        budgetRestantParPersonne: primeAnnuelleMoyenne > 0
          ? Math.round(primeAnnuelleMoyenne - consommeParTete) : null,
      };
    });

    return { moisEcoule: moisEcoule(exercice), segments };
  }
}
