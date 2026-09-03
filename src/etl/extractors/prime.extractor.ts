import { querySource } from '../config/source-pool';

export interface PrimeSource {
  numero_police: string;
  date_emission: Date;
  montant_emis: number;
  montant_encaisse: number;
  type_souscription: string;
  commission_versee: number;
}

// QUITTANCE = émission de prime (confirmé par TYPE_QUITTANCE : C = Émission,
// A = Annulation et Abandon, R = Ristourne — on ne garde que 'C').
// ENCAISSEMENT_QUITTANCE agrégée par quittance pour le montant encaissé.
// commission_versee = commission apporteur + gestion (commappo + commgest).
//
// type_souscription (nouvelle affaire / renouvellement) : AMBIGU — dérivé
// ici de numeaven = 0 (aucun avenant = 1ère émission), mais un avenant peut
// aussi correspondre à une simple modification en cours d'exercice et pas
// à un renouvellement. À valider — cf. liste des ambiguïtés.
export async function extractPrimes(since: Date): Promise<PrimeSource[]> {
  const { rows } = await querySource<PrimeSource>(
    `SELECT
       TO_CHAR(q.numepoli) AS "numero_police",
       q.dateeffe AS "date_emission",
       q.primtota AS "montant_emis",
       NVL(enc.montant_encaisse, 0) AS "montant_encaisse",
       CASE WHEN q.numeaven = 0 THEN 'NOUVELLE_AFFAIRE' ELSE 'RENOUVELLEMENT' END AS "type_souscription",
       NVL(q.commappo, 0) + NVL(q.commgest, 0) AS "commission_versee"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN (
       SELECT numequit, SUM(montenca) AS montant_encaisse
       FROM encaissement_quittance
       GROUP BY numequit
     ) enc ON enc.numequit = q.numequit
     WHERE q.codtypqu = 'C'
       AND q.modi__le >= :1`,
    [since],
  );
  return rows;
}
