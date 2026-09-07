import { querySource } from '../config/source-pool';

export interface PrimeSource {
  numero_quittance: string;
  numero_police: string;
  date_emission: Date;
  montant_emis: number;
  montant_encaisse: number;
  type_souscription: string;
  commission_versee: number;
}

// QUITTANCE = table mouvement (émission, ristourne, annulation — cf.
// TYPE_QUITTANCE) reliée à AVENANT/TYPE_AVENANT. Les montants sont DÉJÀ
// signés en source (une ristourne 'R' porte un primtota négatif, vérifié
// sur des cas réels) : on prend donc TOUTES les quittances (C+A+R) sans
// filtrer sur codtypqu, pour que la somme par police/période donne la
// vraie prime nette — une police ayant eu des retraits/ristournes dans
// l'année serait sinon surestimée en ne gardant que les émissions.
//
// Granularité = une ligne par quittance (numero_quittance = clé naturelle
// codeinte-numequit, même convention que numero_police), PAS agrégée par
// mois : plusieurs quittances peuvent tomber le même mois pour une même
// police (incorporation + modification par ex.), et les agréger au
// chargement écraserait les mouvements précédents au lieu de les cumuler.
// ENCAISSEMENT_QUITTANCE agrégée par quittance pour le montant encaissé.
// commission_versee = commission apporteur + gestion (commappo + commgest).
//
// numero_police = codeinte-numepoli (clé composite, cf. police.extractor.ts
// — numepoli seul n'est pas unique globalement).
//
// type_souscription : numeaven IS NULL -> nouvelle affaire (police
// d'origine, avant tout avenant), sinon renouvellement — règle confirmée
// par le métier (une police peut être "nouvelle" un mois et avoir déjà
// numeaven=1 le mois suivant : le compteur d'avenant n'est volontairement
// pas mis en correspondance avec TYPE_AVENANT/natuaven ici).
export async function extractPrimes(since: Date): Promise<PrimeSource[]> {
  const { rows } = await querySource<PrimeSource>(
    `SELECT
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numepoli) AS "numero_police",
       q.dateeffe AS "date_emission",
       q.primtota AS "montant_emis",
       NVL(enc.montant_encaisse, 0) AS "montant_encaisse",
       CASE WHEN q.numeaven IS NULL THEN 'NOUVELLE_AFFAIRE' ELSE 'RENOUVELLEMENT' END AS "type_souscription",
       NVL(q.commappo, 0) + NVL(q.commgest, 0) AS "commission_versee"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN (
       SELECT codinteq, numequit, SUM(montenca) AS montant_encaisse
       FROM encaissement_quittance
       GROUP BY codinteq, numequit
     ) enc ON enc.codinteq = q.codeinte AND enc.numequit = q.numequit
     WHERE q.modi__le >= :1`,
    [since],
  );
  return rows;
}
