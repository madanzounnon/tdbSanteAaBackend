import { AppDataSource } from '../../data-source';
import { getParametresDetection, ErreurValidation } from './referentiels.service';

export interface FiltreDetection {
  du: string;
  au: string;
  branche?: number | null;
  sens?: 'ENTREE' | 'SORTIE' | null;
  inclureEcartees?: boolean;
  inclureDeclarees?: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validerPeriode(du: unknown, au: unknown): { du: string; au: string } {
  if (typeof du !== 'string' || typeof au !== 'string' || !DATE_RE.test(du) || !DATE_RE.test(au)) {
    throw new ErreurValidation('Période requise : du=AAAA-MM-JJ&au=AAAA-MM-JJ');
  }
  if (du > au) throw new ErreurValidation('La date de début doit précéder la date de fin');
  return { du, au };
}

// Filtre de sélection (point 1 du cahier) + contrôles sur les listes
// (points 3 et 4), calculés à la demande sur la période choisie.
//
// Périmètre : opérations non annulées (hors écritures sans mouvement de
// fonds), toutes branches, SAUF les clients de
// qualité exemptée (structures étatiques, institutions internationales —
// paramètre qualites_exclues) et les structures de confiance actives
// (white-list, par code client ORASS ou par nom normalisé).
//
// Une opération est retenue si au moins un critère est vrai :
//  - SEUIL_UNITAIRE      montant ≥ seuil unitaire ;
//  - CUMUL_PERSONNE      cumul (en valeur absolue, entrées + sorties) de
//                        l'individu sur la période ≥ seuil de cumul ;
//  - CUMUL_POLICE        cumul de la police en cours (non résiliée,
//                        échéance ≥ fin de période) depuis le début de son
//                        terme actuel ≥ seuil de cumul. Le terme actuel
//                        démarre à max(date d'effet, échéance − 1 an) :
//                        ORASS conserve la date d'effet d'origine sur les
//                        polices renouvelées par avenant ;
//  - FRACTIONNEMENT      l'individu a, sur la période, au moins N opérations
//                        entre X % du seuil unitaire et le seuil (exclu), et
//                        celle-ci en fait partie ;
//  - PAYS_RISQUE         nationalité ou pays de résidence sur liste active ;
//  - PERSONNE_SURVEILLEE nom de l'individu contenant tous les mots du nom
//                        complet d'une personne surveillée active.
export async function detecter(filtre: FiltreDetection) {
  const p = await getParametresDetection();
  const bandeMin = (p.seuilUnitaire * p.fractionnementPct) / 100;

  const rows = await AppDataSource.query(
    `WITH ops AS (
       SELECT o.*
       FROM lbc_operation o
       WHERE NOT o.annulee
         AND o.date_operation >= $1::date AND o.date_operation < $2::date + 1
         AND ($3::int IS NULL OR o.code_branche = $3)
         AND ($4::text IS NULL OR o.sens = $4)
         -- Écritures sans mouvement de fonds : abandon de quittance, perte
         -- et profit, compensation prime décès.
         AND COALESCE(o.mode_paiement, '') NOT IN ('CQ', 'PP', 'CD')
         AND NOT (COALESCE(o.code_qualite, -1) = ANY($5::int[]))
         AND NOT EXISTS (
           SELECT 1 FROM lbc_structure_confiance s
           WHERE s.actif
             AND ((s.code_client IS NOT NULL AND s.code_client = o.code_client)
                  OR s.nom_normalise = o.personne_nom_normalise)
         )
     ),
     cumul_personne AS (
       SELECT personne_cle, SUM(ABS(montant)) AS total, COUNT(*)::int AS nb
       FROM ops GROUP BY personne_cle
     ),
     fractionnement AS (
       SELECT personne_cle, COUNT(*)::int AS nb
       FROM ops WHERE ABS(montant) >= $7 AND ABS(montant) < $6
       GROUP BY personne_cle HAVING COUNT(*) >= $9
     ),
     polices_en_cours AS (
       SELECT DISTINCT numero_police,
              GREATEST(date_effet_police, (date_echeance_police - INTERVAL '1 year')::date) AS debut_terme
       FROM ops
       WHERE numero_police IS NOT NULL AND NOT police_resiliee AND date_echeance_police >= $2::date
     ),
     cumul_police AS (
       SELECT pc.numero_police, SUM(ABS(o.montant)) AS total, COUNT(*)::int AS nb
       FROM polices_en_cours pc
       JOIN lbc_operation o ON o.numero_police = pc.numero_police
       WHERE NOT o.annulee AND o.date_operation >= pc.debut_terme AND o.date_operation < $2::date + 1
       GROUP BY pc.numero_police
     ),
     pays AS (
       SELECT o.personne_cle,
              jsonb_agg(DISTINCT jsonb_build_object('code', pr.code_pays, 'libelle', pr.libelle, 'liste', pr.liste)) AS pays
       FROM ops o
       JOIN lbc_pays_risque pr ON pr.actif AND pr.code_pays IN (o.nationalite, o.pays_residence)
       GROUP BY o.personne_cle
     ),
     noms AS (
       SELECT DISTINCT personne_cle, personne_nom_normalise FROM ops WHERE personne_nom_normalise IS NOT NULL
     ),
     surveillees AS (
       SELECT n.personne_cle,
              jsonb_agg(DISTINCT jsonb_build_object(
                'id', ps.id, 'nom', TRIM(ps.nom || ' ' || COALESCE(ps.prenoms, '')),
                'categorie', ps.categorie, 'fonction', ps.fonction)) AS personnes
       FROM noms n
       CROSS JOIN LATERAL unnest(string_to_array(n.personne_nom_normalise, ' ')) AS t(token)
       JOIN lbc_personne_surveillee ps ON ps.actif AND ps.token_principal = t.token
       WHERE (' ' || n.personne_nom_normalise || ' ') LIKE ALL (ps.motifs_recherche)
       GROUP BY n.personne_cle
     ),
     evaluees AS (
       SELECT o.*,
              cp.total AS cumul_personne, cp.nb AS nb_operations_personne,
              cpo.total AS cumul_police, cpo.nb AS nb_operations_police,
              fr.nb AS nb_fractionnees,
              pa.pays AS pays_risque, su.personnes AS personnes_surveillees,
              ABS(o.montant) >= $6 AS c_seuil_unitaire,
              cp.total >= $8 AS c_cumul_personne,
              COALESCE(cpo.total >= $8, false) AS c_cumul_police,
              (fr.nb IS NOT NULL AND ABS(o.montant) >= $7 AND ABS(o.montant) < $6) AS c_fractionnement,
              pa.pays IS NOT NULL AS c_pays_risque,
              su.personnes IS NOT NULL AS c_personne_surveillee
       FROM ops o
       JOIN cumul_personne cp ON cp.personne_cle = o.personne_cle
       LEFT JOIN cumul_police cpo ON cpo.numero_police = o.numero_police
       LEFT JOIN fractionnement fr ON fr.personne_cle = o.personne_cle
       LEFT JOIN pays pa ON pa.personne_cle = o.personne_cle
       LEFT JOIN surveillees su ON su.personne_cle = o.personne_cle
     )
     SELECT e.id, e.ref_source, e.source, e.sens, e.date_operation, e.montant, e.devise,
            e.mode_paiement, e.libelle_mode_paiement, e.espece, e.reference, e.tireur,
            e.code_branche, e.libelle_branche, e.numero_police, e.date_effet_police,
            e.date_echeance_police, e.police_resiliee, e.numero_sinistre,
            e.code_client, e.nom_client, e.personne_cle, e.personne_nom, e.type_personne,
            e.nature_beneficiaire, e.libelle_nature_beneficiaire, e.code_qualite, e.libelle_qualite,
            e.nationalite, e.pays_residence,
            e.cumul_personne, e.nb_operations_personne, e.cumul_police, e.nb_operations_police,
            e.nb_fractionnees, e.pays_risque, e.personnes_surveillees,
            e.c_seuil_unitaire, e.c_cumul_personne, e.c_cumul_police, e.c_fractionnement,
            e.c_pays_risque, e.c_personne_surveillee,
            rv.commentaire AS commentaire_revue, rv.par AS revue_par, rv.le AS revue_le,
            dc.declarations
     FROM evaluees e
     LEFT JOIN lbc_operation_revue rv ON rv.operation_id = e.id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object('id', d.id, 'reference', d.reference)) AS declarations
       FROM lbc_declaration_operation dop JOIN lbc_declaration d ON d.id = dop.declaration_id
       WHERE dop.operation_id = e.id
     ) dc ON true
     WHERE (e.c_seuil_unitaire OR e.c_cumul_personne OR e.c_cumul_police OR e.c_fractionnement
            OR e.c_pays_risque OR e.c_personne_surveillee)
       AND ($10::boolean OR rv.operation_id IS NULL)
       AND ($11::boolean OR dc.declarations IS NULL)
     ORDER BY e.cumul_personne DESC, e.personne_cle, e.date_operation`,
    [
      filtre.du, filtre.au, filtre.branche ?? null, filtre.sens ?? null, p.qualitesExclues,
      p.seuilUnitaire, bandeMin, p.seuilCumul, p.fractionnementNbMin,
      !!filtre.inclureEcartees, filtre.inclureDeclarees !== false,
    ],
  );

  const operations = rows.map((r: any) => {
    const criteres: string[] = [];
    if (r.c_seuil_unitaire) criteres.push('SEUIL_UNITAIRE');
    if (r.c_cumul_personne) criteres.push('CUMUL_PERSONNE');
    if (r.c_cumul_police) criteres.push('CUMUL_POLICE');
    if (r.c_fractionnement) criteres.push('FRACTIONNEMENT');
    if (r.c_pays_risque) criteres.push('PAYS_RISQUE');
    if (r.c_personne_surveillee) criteres.push('PERSONNE_SURVEILLEE');
    const signaux: string[] = [];
    if (r.espece) signaux.push('ESPECES');
    if (r.police_resiliee) signaux.push('RESILIATION');
    const statut = r.declarations ? 'DECLAREE' : r.revue_le ? 'ECARTEE' : 'A_ANALYSER';
    const {
      c_seuil_unitaire, c_cumul_personne, c_cumul_police, c_fractionnement, c_pays_risque, c_personne_surveillee,
      ...reste
    } = r;
    return {
      ...reste,
      id: Number(r.id),
      montant: Number(r.montant),
      cumul_personne: Number(r.cumul_personne),
      cumul_police: r.cumul_police === null ? null : Number(r.cumul_police),
      nb_operations_personne: Number(r.nb_operations_personne),
      criteres,
      signaux,
      statut,
    };
  });

  return { parametres: p, operations };
}

export async function ecarter(operationIds: number[], commentaire: string | null, par: string | null) {
  if (!operationIds.length) throw new ErreurValidation('Aucune opération sélectionnée');
  await AppDataSource.query(
    `INSERT INTO lbc_operation_revue (operation_id, commentaire, par)
     SELECT unnest($1::bigint[]), $2, $3
     ON CONFLICT (operation_id) DO UPDATE SET commentaire = EXCLUDED.commentaire, par = EXCLUDED.par, le = now()`,
    [operationIds, commentaire, par],
  );
  return { ecartees: operationIds.length };
}

export async function retablir(operationIds: number[]) {
  const [, n] = await AppDataSource.query(
    `DELETE FROM lbc_operation_revue WHERE operation_id = ANY($1::bigint[])`,
    [operationIds],
  );
  return { retablies: n };
}

export async function etatChargement() {
  const [[stats], [dernier]] = await Promise.all([
    AppDataSource.query(
      `SELECT COUNT(*)::int AS nb_operations, MIN(date_operation) AS premiere, MAX(date_operation) AS derniere,
              COUNT(DISTINCT code_branche)::int AS nb_branches
       FROM lbc_operation`,
    ),
    AppDataSource.query(
      `SELECT status, started_at, finished_at, rows_extracted, rows_loaded, error_message
       FROM etl_log WHERE job_name = 'lbc_operations' ORDER BY started_at DESC LIMIT 1`,
    ),
  ]);
  return { ...stats, dernier_chargement: dernier ?? null };
}
