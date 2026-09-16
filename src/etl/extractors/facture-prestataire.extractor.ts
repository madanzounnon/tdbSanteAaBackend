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
//
// COALESCE(f.modi__le, f.cree__le) >= :1 : 460 lignes sur 62 165 ont
// modi__le à NULL — sans ce fallback, une comparaison NULL >= date étant
// toujours fausse en SQL, elles ne seraient jamais extraites (même bug que
// sur police/sinistre/quittance, cf. police.extractor.ts). On retombe sur
// cree__le (date de création, jamais NULL sur FACTURE_PRESTATAIRE) plutôt
// qu'un simple `OR modi__le IS NULL`, qui aurait fait revenir ces lignes à
// chaque extraction incrémentale indéfiniment.
//
// NVL(f.datedepo, SYSDATE) : date_depot est NOT NULL côté cible (pivot de
// calculerStatutFacture) alors qu'environ 15% des lignes source l'ont à
// NULL (qualité de donnée connue, environnement de test). Plutôt que
// d'exclure ces lignes, on retombe sur la date du jour pour ne perdre
// aucune facture — à revoir si un jour une vraie date de dépôt est
// disponible en environnement de production.
export async function extractFacturesPrestataires(since: Date): Promise<FactureSource[]> {
  const { rows } = await querySource<FactureSource>(
    `SELECT
       b.nombenef AS "nom_prestataire",
       b.codnatpr AS "code_categorie_prestataire",
       NVL(f.datedepo, SYSDATE) AS "date_depot",
       f.dateregl AS "date_reglement",
       f.montfact AS "montant"
     FROM facture_prestataire f
     JOIN beneficiaire b ON b.codebene = f.codebene AND b.codnatbe = 'P'
     WHERE COALESCE(f.modi__le, f.cree__le) >= :1`,
    [since],
  );
  return rows;
}
