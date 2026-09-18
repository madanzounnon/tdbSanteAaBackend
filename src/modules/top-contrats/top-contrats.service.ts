import { AppDataSource } from '../../data-source';

// Cahier §7 : l'action recommandée découle du statut S/P et du statut de
// la police (échue = S/P figé, ne peut plus s'améliorer avant clôture ;
// active = encore le temps d'agir avant échéance).
function actionRecommandee(statutRisque: string, statutPolice: string): string {
  if (statutRisque === 'perte_seche') {
    return statutPolice === 'echue' ? 'Résiliation ou régularisation immédiate' : 'Résiliation à envisager ou régularisation substantielle';
  }
  if (statutRisque === 'critique') {
    return statutPolice === 'echue' ? 'Régularisation à la clôture' : 'Régularisation en cours de contrat';
  }
  if (statutRisque === 'vigilance') return 'Maintien avec suivi renforcé';
  return 'Maintien';
}

export class TopContratsService {
  async getTopParPrime(exercice: number, limite = 10) {
    // prime_emise = SUM(fait_prime.montant_emis) pour la police sur
    // l'exercice (déjà agrégée dans mv_sp_portefeuille) — jamais
    // dim_police.prime_annuelle, qui est une valeur figée au chargement et
    // ne reflète pas les multiples mouvements de prime d'une police
    // (nouvelle affaire, renouvellement, avenants, ristournes...).
    return AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         p.statut_souscripteur,
         p.statut_police,
         c.nom AS canal,
         mv.prime_emise,
         mv.sp_emis_pct AS sp_global,
         mv.sp_acquis_pct AS sp_lineaire,
         mv.statut_risque
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE mv.exercice = $1
       ORDER BY mv.prime_emise DESC
       LIMIT $2`,
      [exercice, limite],
    );
  }

  // Cahier §7 "Top Sin" : liste triée par S/P LINÉAIRE décroissant (pas le
  // S/P émis brut, qui sous-estime les polices récentes/en cours d'année).
  async getTopParSinistralite(exercice: number, limite = 10) {
    return AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         p.statut_police,
         c.nom AS canal,
         mv.sp_emis_pct AS sp_global,
         mv.sp_acquis_pct AS sp_lineaire,
         mv.statut_risque
       FROM mv_sp_portefeuille mv
       JOIN dim_police p ON p.id = mv.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE mv.exercice = $1
       ORDER BY mv.sp_acquis_pct DESC NULLS LAST
       LIMIT $2`,
      [exercice, limite],
    );
  }

  // Cahier §7 "Profil de Risque Individuel par Police" — fiche complète
  // affichée au clic sur une ligne du classement.
  async getProfilPolice(numeroPolice: string, exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         p.numero_police,
         p.souscripteur,
         p.statut_souscripteur,
         p.statut_police,
         p.date_effet,
         p.date_echeance,
         c.nom AS canal,
         a.nom AS apporteur,
         mv.prime_emise,
         mv.sinistres_payes,
         mv.sp_emis_pct AS sp_global,
         mv.sp_acquis_pct AS sp_lineaire,
         mv.statut_risque
       FROM dim_police p
       JOIN dim_canal c ON c.id = p.canal_id
       LEFT JOIN dim_apporteur a ON a.id = p.apporteur_id
       LEFT JOIN mv_sp_portefeuille mv ON mv.police_id = p.id AND mv.exercice = $2
       WHERE p.numero_police = $1`,
      [numeroPolice, exercice],
    );

    if (!result) return null;

    return {
      ...result,
      action_recommandee: result.statut_risque
        ? actionRecommandee(result.statut_risque, result.statut_police)
        : 'Données de sinistralité indisponibles pour cet exercice',
    };
  }
}
