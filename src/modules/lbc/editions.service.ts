import { AppDataSource } from '../../data-source';
import { detecter } from './detection.service';
import { listerDeclarations } from './declarations.service';

// Édition 1 — État des déclarations de soupçon par période
// (transmises / non transmises), avec totaux par statut.
export async function etatDeclarations(du: string, au: string, transmission?: string) {
  const declarations = await listerDeclarations({ du, au, transmission });
  const synthese = {
    total: declarations.length,
    montant_total: declarations.reduce((s: number, d: any) => s + Number(d.montant || 0), 0),
    par_transmission: {} as Record<string, number>,
    par_dossier: {} as Record<string, number>,
  };
  for (const d of declarations) {
    synthese.par_transmission[d.statut_transmission] = (synthese.par_transmission[d.statut_transmission] ?? 0) + 1;
    synthese.par_dossier[d.statut_dossier] = (synthese.par_dossier[d.statut_dossier] ?? 0) + 1;
  }
  return { synthese, declarations };
}

// Édition 2 — État des opérations cibles avec les indices : la détection
// complète de la période, opérations écartées et déclarées comprises.
export async function etatOperationsCibles(du: string, au: string, branche?: number | null) {
  const { parametres, operations } = await detecter({ du, au, branche, inclureEcartees: true, inclureDeclarees: true });
  const parCritere: Record<string, number> = {};
  for (const o of operations) for (const c of o.criteres) parCritere[c] = (parCritere[c] ?? 0) + 1;
  return {
    parametres,
    synthese: {
      nb_operations: operations.length,
      nb_personnes: new Set(operations.map((o: any) => o.personne_cle)).size,
      montant_total: operations.reduce((s: number, o: any) => s + Math.abs(o.montant), 0),
      par_critere: parCritere,
    },
    operations,
  };
}

// Édition 3 — Liste des personnes ayant fait l'objet de soupçons : une
// ligne par personne identifiée dans les déclarations de la période.
export async function etatPersonnesSoupconnees(du: string, au: string) {
  return AppDataSource.query(
    `SELECT
       COALESCE(NULLIF(TRIM(COALESCE(p->>'nom', '') || ' ' || COALESCE(p->>'prenoms', '')), ''), p->>'raison_sociale') AS nom,
       p->>'type' AS type_personne,
       NULLIF(p->>'code_client', '') AS code_client,
       COALESCE(p->>'nationalite', '') AS nationalite,
       COALESCE(NULLIF(p->>'piece_numero', ''), NULLIF(p->>'ifu', ''), NULLIF(p->>'rccm', '')) AS identifiant,
       COUNT(DISTINCT d.id)::int AS nb_declarations,
       SUM(d.montant) AS montant_total,
       MIN(d.date_declaration) AS premiere_declaration,
       MAX(d.date_declaration) AS derniere_declaration,
       string_agg(DISTINCT d.reference, ', ') AS references,
       COUNT(*) FILTER (WHERE d.statut_transmission = 'TRANSMISE')::int AS nb_transmises,
       string_agg(DISTINCT d.statut_dossier, ', ') AS statuts_dossier
     FROM lbc_declaration d
     CROSS JOIN LATERAL jsonb_array_elements(d.personnes) p
     WHERE d.date_declaration BETWEEN $1::date AND $2::date
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY nb_declarations DESC, montant_total DESC NULLS LAST`,
    [du, au],
  );
}
