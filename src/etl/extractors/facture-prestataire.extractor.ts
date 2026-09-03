import { querySource } from '../config/source-pool';

export interface FactureSource {
  nom_prestataire: string;
  code_categorie_prestataire: string;
  date_depot: Date;
  date_reglement: Date | null;
  montant: number;
}

// FACTURE_PRESTATAIRE (correspondance quasi directe avec notre modèle :
// datedepo/datereglement/montfact) jointe à BENEFICIAIRE pour le nom.
//
// AMBIGU : BENEFICIAIRE.codtypbe (13 codes distincts : Q, P, C, H, O, J, L,
// M, T, X, W, K, 0, + valeurs nulles) n'a pas de table de décodage
// identifiée (aucune table TYPE_BENEFICIAIRE trouvée dans le schéma). Le
// code brut est transmis tel quel ; transformCategoriePrestataire
// (dimensions.transformer.ts) ne reconnaît aucun de ces codes et retombe
// sur CABINET_MEDICAL par défaut — cf. liste des ambiguïtés.
//
// Le statut (attente/retard/réglée) n'est volontairement pas repris de
// FACTURE_PRESTATAIRE.sortfact (code numérique non décodé) : il est
// recalculé côté ETL à partir des dates, cf. calculerStatutFacture.
export async function extractFacturesPrestataires(since: Date): Promise<FactureSource[]> {
  const { rows } = await querySource<FactureSource>(
    `SELECT
       b.nombenef AS "nom_prestataire",
       b.codtypbe AS "code_categorie_prestataire",
       f.datedepo AS "date_depot",
       f.dateregl AS "date_reglement",
       f.montfact AS "montant"
     FROM facture_prestataire f
     JOIN beneficiaire b ON b.codebene = f.codebene
     WHERE f.modi__le >= :1`,
    [since],
  );
  return rows;
}
