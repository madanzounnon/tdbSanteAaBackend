import { AppDataSource } from '../../data-source';

export const CATEGORIES_ENCAISSEMENT = ['ENCAISSEMENT', 'ANNULE', 'REMBOURSEMENT'] as const;
export type CategorieEncaissement = (typeof CATEGORIES_ENCAISSEMENT)[number];

// Catégorie d'un encaissement (fait_encaissement e, quittance fait_prime fp) :
//  - ANNULE        : encaissement annulé dans ORASS, sous deux formes :
//                      * annulation datée (dateannu renseignée, pratique
//                        actuelle) ;
//                      * contre-passation : ligne de montant NÉGATIF qui
//                        neutralise un encaissement antérieur (pratique
//                        ORASS jusqu'en 2022) ;
//  - REMBOURSEMENT : règlement d'une quittance négative (ristourne) = argent
//                    rendu au client ;
//  - ENCAISSEMENT  : encaissement valide d'une quittance positive.
const CATEGORIE_SQL = `CASE WHEN e.annule OR e.montant < 0 THEN 'ANNULE'
                            WHEN fp.montant_emis < 0 THEN 'REMBOURSEMENT'
                            ELSE 'ENCAISSEMENT' END`;

// Page "Encaissements" : exercice = année de la date d'effet de la
// quittance, comme le CA encaissé et le taux de recouvrement.
//   Encaissé net = encaissements − contre-passations (quittances positives)
//                  − remboursements nets (remboursements − contre-passations
//                    de remboursements)
// = CA encaissé affiché sur les pages Chiffre d'affaires et Vue exécutive
// (contrôle : ecart_ca_encaisse = 0).
export class EncaissementsService {
  async getSynthese(exercice: number) {
    const [[t], parMode, [primes]] = await Promise.all([
      AppDataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE NOT e.annule AND e.montant > 0 AND fp.montant_emis >= 0)::int AS n_enc,
           COALESCE(SUM(e.montant) FILTER (WHERE NOT e.annule AND e.montant > 0 AND fp.montant_emis >= 0), 0) AS m_enc,
           COUNT(*) FILTER (WHERE NOT e.annule AND e.montant > 0 AND fp.montant_emis < 0)::int AS n_remb,
           COALESCE(SUM(e.montant) FILTER (WHERE NOT e.annule AND e.montant > 0 AND fp.montant_emis < 0), 0) AS m_remb,
           COUNT(*) FILTER (WHERE e.annule)::int AS n_annul,
           COALESCE(SUM(ABS(e.montant)) FILTER (WHERE e.annule), 0) AS m_annul,
           COUNT(*) FILTER (WHERE NOT e.annule AND e.montant < 0)::int AS n_cp,
           COALESCE(-SUM(e.montant) FILTER (WHERE NOT e.annule AND e.montant < 0 AND fp.montant_emis >= 0), 0) AS m_cp_enc,
           COALESCE(-SUM(e.montant) FILTER (WHERE NOT e.annule AND e.montant < 0 AND fp.montant_emis < 0), 0) AS m_cp_remb
         FROM fait_encaissement e JOIN fait_prime fp ON fp.id = e.quittance_id
         WHERE e.exercice = $1`,
        [exercice],
      ),
      AppDataSource.query(
        `SELECT COALESCE(e.libelle_mode_paiement, e.mode_paiement, 'Non renseigné') AS mode,
                COUNT(*)::int AS nombre, SUM(e.montant) AS montant
         FROM fait_encaissement e JOIN fait_prime fp ON fp.id = e.quittance_id
         WHERE e.exercice = $1 AND NOT e.annule AND e.montant > 0 AND fp.montant_emis >= 0
         GROUP BY 1 ORDER BY montant DESC`,
        [exercice],
      ),
      AppDataSource.query(
        `SELECT COALESCE(SUM(montant_emis), 0) AS primes_emises, COALESCE(SUM(montant_encaisse), 0) AS ca_encaisse
         FROM fait_prime WHERE exercice = $1`,
        [exercice],
      ),
    ]);

    const n = (v: unknown) => Number(v) || 0;
    const encaissements = { nombre: n(t.n_enc), montant: n(t.m_enc) };
    const contrePassations = n(t.m_cp_enc);
    const remboursementsNets = n(t.m_remb) - n(t.m_cp_remb);
    const annules = {
      nombre: n(t.n_annul) + n(t.n_cp),
      montant: n(t.m_annul) + n(t.m_cp_enc) + n(t.m_cp_remb),
      annulations_datees: { nombre: n(t.n_annul), montant: n(t.m_annul) },
      contre_passations: { nombre: n(t.n_cp), montant: n(t.m_cp_enc) + n(t.m_cp_remb) },
    };
    const net = encaissements.montant - contrePassations - remboursementsNets;
    const primesEmises = n(primes.primes_emises);

    return {
      exercice,
      encaissements,
      annules,
      remboursements: { nombre: n(t.n_remb), montant: remboursementsNets },
      encaisse_net: net,
      primes_emises: primesEmises,
      taux_recouvrement: primesEmises > 0 ? Math.round((net / primesEmises) * 1000) / 10 : null,
      // Contrôle de cohérence avec le cumul par quittance (fait_prime) qui
      // alimente le CA encaissé : doit être nul.
      ecart_ca_encaisse: Math.round(net - n(primes.ca_encaisse)),
      par_mode: parMode.map((m: any) => ({ mode: m.mode, nombre: Number(m.nombre), montant: Number(m.montant) })),
    };
  }

  // Liste paginée d'une catégorie, la plus récente d'abord. Recherche sur
  // police, souscripteur, quittance, référence, émetteur.
  async getListe(exercice: number, categorie: CategorieEncaissement, page: number, taille: number, q?: string) {
    const params: unknown[] = [exercice, categorie];
    let recherche = '';
    if (q) {
      params.push(`%${q}%`);
      recherche = `AND (p.numero_police ILIKE $3 OR p.souscripteur ILIKE $3 OR e.numero_quittance ILIKE $3
                        OR e.reference ILIKE $3 OR e.emetteur ILIKE $3)`;
    }
    params.push(taille, (page - 1) * taille);
    const n = params.length;
    const rows: any[] = await AppDataSource.query(
      `SELECT
         COUNT(*) OVER()::int AS total_lignes,
         SUM(ABS(e.montant)) OVER() AS total_montant,
         e.id, e.numero_quittance, p.numero_police, TRIM(p.souscripteur) AS souscripteur,
         fp.date AS date_effet_quittance, fp.montant_emis AS montant_quittance,
         e.date_encaissement, ABS(e.montant) AS montant, e.mode_paiement, e.libelle_mode_paiement,
         e.reference, e.emetteur, e.saisi_par, e.date_annulation, e.motif_annulation, e.annule_par,
         CASE WHEN e.annule THEN 'ANNULATION' WHEN e.montant < 0 THEN 'CONTRE_PASSATION' END AS type_annulation
       FROM fait_encaissement e
       JOIN fait_prime fp ON fp.id = e.quittance_id
       JOIN dim_police p ON p.id = e.police_id
       WHERE e.exercice = $1 AND ${CATEGORIE_SQL} = $2 ${recherche}
       ORDER BY e.date_encaissement DESC, e.numero_quittance
       LIMIT $${n - 1} OFFSET $${n}`,
      params,
    );
    const total = rows[0]?.total_lignes ?? 0;
    return {
      donnees: rows.map(({ total_lignes, total_montant, ...r }) => r),
      total,
      total_montant: rows[0] ? Number(rows[0].total_montant) : 0,
      page,
      taille,
      pages: Math.max(1, Math.ceil(total / taille)),
    };
  }
}
