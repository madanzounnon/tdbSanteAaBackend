// Normalisation des noms pour le rapprochement opérations ↔ listes de
// contrôle : ORASS saisit indifféremment "KOFFI Jean-Marc", "Koffi jean marc",
// "KOFFI  JEAN MARC." — on compare donc sur une forme sans accents,
// majuscules, ponctuation remplacée par des espaces.
export function normaliserNom(valeur: string | null | undefined): string {
  return (valeur ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

// Motifs LIKE '% TOKEN %' : une personne surveillée correspond à une
// opération si TOUS les mots de son nom complet figurent dans le nom de
// l'opération, quel que soit l'ordre (nom/prénoms souvent inversés en saisie).
// Les mots d'une lettre (initiales) sont ignorés, trop peu discriminants.
export function motifsRecherche(nomNormalise: string): { tokenPrincipal: string; motifs: string[] } {
  const tokens = Array.from(new Set(nomNormalise.split(' ').filter((t) => t.length > 1)));
  const tokenPrincipal = tokens.reduce((plusLong, t) => (t.length > plusLong.length ? t : plusLong), '');
  return { tokenPrincipal, motifs: tokens.map((t) => `% ${t} %`) };
}
