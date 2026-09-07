import { querySource } from '../config/source-pool';

export interface FactureSource {
  nom_prestataire: string;
  code_categorie_prestataire: string;
  date_depot: Date;
  date_reglement: Date | null;
  montant: number;
}

// FACTURE_PRESTATAIRE (correspondance quasi directe avec notre modèle :
// datedepo/datereglement/montfact) jointe à BENEFICIAIRE, filtrée sur
// codnatbe = 'P' (confirmé via NATURE_BENEFICIAIRE : "Prestataire Maladie").
// Catégorie = BENEFICIAIRE.codnatpr — cf. mapping et ambiguïtés résiduelles
// (SB, LR, RE) dans transformCategoriePrestataire.
//
// Le statut (attente/retard/réglée) n'est volontairement pas repris de
// FACTURE_PRESTATAIRE.sortfact (code numérique non décodé) : il est
// recalculé côté ETL à partir des dates, cf. calculerStatutFacture.
export async function extractFacturesPrestataires(since: Date): Promise<FactureSource[]> {
  const { rows } = await querySource<FactureSource>(
    `SELECT
       b.nombenef AS "nom_prestataire",
       b.codnatpr AS "code_categorie_prestataire",
       f.datedepo AS "date_depot",
       f.dateregl AS "date_reglement",
       f.montfact AS "montant"
     FROM facture_prestataire f
     JOIN beneficiaire b ON b.codebene = f.codebene AND b.codnatbe = 'P'
     WHERE f.modi__le >= :1`,
    [since],
  );
  return rows;
}
