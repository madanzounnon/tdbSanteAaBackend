import { querySource } from '../config/source-pool';

export interface PrimeSource {
  numero_quittance: string;
  numero_police: string;
  date_emission: Date;
  montant_emis: number;
  montant_encaisse: number;
  code_type_avenant: string | null;
  date_avenant: Date | null;
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
// code_type_avenant : NULL = police d'origine, aucun avenant (nouvelle
// affaire). Sinon, code AVENANT.codtypav (ex: '1' = Avenant de
// renouvellement, confirmé par le métier) — résolu vers dim_type_avenant au
// chargement plutôt qu'un flag binaire nouvelle affaire/renouvellement, qui
// confondait à tort tous les autres avenants (incorporation, modification,
// retrait, ajustement...) avec des renouvellements.
export async function extractPrimes(since: Date): Promise<PrimeSource[]> {
  const { rows } = await querySource<PrimeSource>(
    `SELECT
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numepoli) AS "numero_police",
       q.dateeffe AS "date_emission",
       q.primtota AS "montant_emis",
       NVL(enc.montant_encaisse, 0) AS "montant_encaisse",
       TO_CHAR(a.codtypav) AS "code_type_avenant",
       a.datesous AS "date_avenant",
       NVL(q.commappo, 0) + NVL(q.commgest, 0) AS "commission_versee"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN avenant a ON a.codeinte = q.codeinte AND a.numepoli = q.numepoli AND a.numeaven = q.numeaven
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
