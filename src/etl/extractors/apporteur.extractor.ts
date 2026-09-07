import { querySource } from '../config/source-pool';

export interface ApporteurSource {
  code: string;
  nom: string;
  type_apporteur: string; // APPORTEUR.codtypap : A / D / L
}

// Commercial individuel (vendeur), table APPORTEUR — distinct de
// INTERMEDIAIRE (le canal/la structure, cf. canal.extractor.ts). Typé via
// TYPE_APPORTEUR : A = Apporteur agréé, D = Affaire directe, L = Apporteur
// libre (confirmé, 3 valeurs seulement dans TYPE_APPORTEUR).
export async function extractApporteurs(): Promise<ApporteurSource[]> {
  const { rows } = await querySource<ApporteurSource>(`
    SELECT
      TO_CHAR(a.codeappo) AS "code",
      a.raissoci AS "nom",
      a.codtypap AS "type_apporteur"
    FROM apporteur a
  `);
  return rows;
}
