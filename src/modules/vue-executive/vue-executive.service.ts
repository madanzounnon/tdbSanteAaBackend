import { AppDataSource } from '../../data-source';
import { ChiffreAffairesService } from '../chiffre-affaires/chiffre-affaires.service';
import { dateArrete, debutExercice, finExercice, memeDateAnneePrecedente, moisEcoule as moisEcouleExercice } from '../commun/periode';

const caService = new ChiffreAffairesService();

// Prime acquise (fonction SQL prime_acquise) entre deux dates — base de la
// rentabilité technique (le CA affiché, lui, = primes émises).
async function caAcquis(debut: string, fin: string): Promise<number> {
  const [{ ca }] = await AppDataSource.query(
    `SELECT ROUND(COALESCE(SUM(montant), 0), 2) AS ca FROM prime_acquise($1::date, $2::date)`,
    [debut, fin],
  );
  return Number(ca);
}

// Agrège les 6 cartes KPI de la Vue Exécutive en une seule requête,
// pour un affichage rapide de la page de synthèse DG.
export class VueExecutiveService {
  async getSynthese(exercice: number) {
    const raw = AppDataSource;

    // CA = primes émises de l'exercice, mêmes chiffres que la page Chiffre d'affaires.
    const ca = await caService.getKpis(exercice);

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
  // vs. la même période de l'exercice précédent". "Même période" = du 01/01
  // à la même date calendaire (ex. 01/01–05/10/2026 vs 01/01–05/10/2025),
  // jamais l'exercice N-1 complet — sinon la comparaison favorise N-1.
  //
  // CA = primes émises de la période (date d'effet), même base que
  // l'encaissé et le taux de recouvrement. Rentabilité technique = prime
  // ACQUISE de la période − sinistres (le surplus porte sur le risque
  // couru, pas sur ce qui a été facturé d'avance).
  private async getPeriode(exercice: number, dateFin: string) {
    const primeAcquise = await caAcquis(debutExercice(exercice), dateFin);
    const [emis] = await AppDataSource.query(
      `SELECT
         COALESCE(SUM(montant_emis), 0) AS emis,
         COALESCE(SUM(montant_encaisse), 0) AS encaisse
       FROM fait_prime WHERE exercice = $1 AND date <= $2::date`,
      [exercice, dateFin],
    );
    const [sinistre] = await AppDataSource.query(
      `SELECT COALESCE(SUM(montant_paye), 0) AS sinistres
       FROM fait_sinistre WHERE exercice = $1 AND date <= $2::date`,
      [exercice, dateFin],
    );

    const primesEmises = Number(emis.emis);
    const encaisse = Number(emis.encaisse);
    const sinistres = Number(sinistre.sinistres);
    const surplus = primeAcquise - sinistres;

    return {
      exercice,
      date_fin: dateFin,
      ca_ytd: primesEmises,
      ca_encaisse_ytd: encaisse,
      taux_recouvrement: primesEmises > 0 ? Math.round((encaisse / primesEmises) * 1000) / 10 : 0,
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
    const moisEcoule = moisEcouleExercice(exercice);
    const arrete = dateArrete(exercice);

    // Primes émises (date d'effet) : à date sur N, même période et
    // exercice complet sur N-1.
    const emises = async (ex: number, jusquA: string) => {
      const [{ ca }] = await AppDataSource.query(
        `SELECT COALESCE(SUM(montant_emis), 0) AS ca FROM fait_prime WHERE exercice = $1 AND date <= $2::date`,
        [ex, jusquA],
      );
      return Number(ca);
    };
    const [caYtdActuel, caYtdN1MemePeriode, caTotalN1] = await Promise.all([
      emises(exercice, arrete),
      emises(exercice - 1, memeDateAnneePrecedente(arrete)),
      emises(exercice - 1, finExercice(exercice - 1)),
    ]);
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
      dateArrete: arrete,
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
    const moisEcoule = moisEcouleExercice(exercice);
    const arrete = dateArrete(exercice);

    const [actuel, precedent] = await Promise.all([
      this.getPeriode(exercice, arrete),
      this.getPeriode(exercice - 1, memeDateAnneePrecedente(arrete)),
    ]);

    const evolutionPct = (valeurActuelle: number, valeurPrecedente: number) => (
      valeurPrecedente !== 0 ? Math.round(((valeurActuelle - valeurPrecedente) / valeurPrecedente) * 1000) / 10 : null
    );

    return {
      moisEcoule,
      dateArrete: arrete,
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
