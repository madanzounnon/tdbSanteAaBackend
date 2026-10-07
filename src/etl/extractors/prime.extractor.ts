import { querySource } from '../config/source-pool';

export interface PrimeSource {
  numero_quittance: string;
  numero_police: string;
  date_emission: Date;
  date_echeance: Date | null;
  montant_emis: number;
  prime_nette: number;
  accessoire: number;
  taxe_prime: number;
  taxe_commission: number;
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
// ENCAISSEMENT_QUITTANCE agrégée par quittance pour le montant encaissé,
// jointe sur numequit SEUL (PK de QUITTANCE) et hors encaissements annulés
// (dateannu). codinteq est l'intermédiaire qui a ENCAISSÉ (souvent le
// guichet 1130), pas forcément celui de la quittance : joindre aussi sur
// codinteq = codeinte perdait 75 à 85 % des encaissements Santé (vérifié
// 2026-10-05 : 2025 = 1,97 Md retenus sur 8,00 Md réellement encaissés,
// taux de recouvrement affiché 24,6 % au lieu de 100,1 %).
// Incrémental : une quittance est aussi réextraite quand un encaissement la
// concernant est créé/modifié depuis `since` — sinon un paiement reçu après
// le chargement de la quittance n'était jamais repris.
// commission_versee = commission apporteur + gestion (commappo + commgest).
//
// Décomposition de primtota (cahier §3.1 "Prime Nette d'Accessoires") :
// primnett (prime nette), accequit (accessoire), taxeprim (taxe prime).
// Vérifié sur données réelles : primtota = primnett + taxeprim + accequit +
// taxeacce sur les quittances standards. taxecomm (taxe sur commission,
// distincte de taxeprim) est également reprise : c'est la seule autre
// colonne de taxe/timbre réellement alimentée pour la branche Santé
// (codebran = 10) — taxeacce, timbdime, timbgrad, taxequi2-5, taxecopo,
// taxetidi, taxetigr valent systématiquement 0 ici et ne sont pas repris.
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
//
// COALESCE(q.modi__le, q.cree__le) >= :1 : 42 lignes sur 30 512 ont
// modi__le à NULL — sans ce fallback, une comparaison NULL >= date étant
// toujours fausse en SQL, elles ne seraient jamais extraites (même bug que
// sur police/sinistre, cf. police.extractor.ts). On retombe sur cree__le
// (date de création, jamais NULL sur QUITTANCE) plutôt qu'un simple
// `OR modi__le IS NULL`, qui aurait fait revenir ces lignes à chaque
// extraction incrémentale indéfiniment.
export async function extractPrimes(since: Date): Promise<PrimeSource[]> {
  const { rows } = await querySource<PrimeSource>(
    `SELECT
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numepoli) AS "numero_police",
       q.dateeffe AS "date_emission",
       q.dateeche AS "date_echeance",
       q.primtota AS "montant_emis",
       NVL(q.primnett, 0) AS "prime_nette",
       NVL(q.accequit, 0) AS "accessoire",
       NVL(q.taxeprim, 0) AS "taxe_prime",
       NVL(q.taxecomm, 0) AS "taxe_commission",
       -- Quittance négative (ristourne / annulation) : le règlement est un
       -- REMBOURSEMENT, stocké en négatif pour se déduire de l'encaissé.
       CASE WHEN q.primtota < 0 THEN -ABS(NVL(enc.montant_encaisse, 0)) ELSE NVL(enc.montant_encaisse, 0) END AS "montant_encaisse",
       TO_CHAR(a.codtypav) AS "code_type_avenant",
       a.datesous AS "date_avenant",
       NVL(q.commappo, 0) + NVL(q.commgest, 0) AS "commission_versee"
     FROM quittance q
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN avenant a ON a.codeinte = q.codeinte AND a.numepoli = q.numepoli AND a.numeaven = q.numeaven
     LEFT JOIN (
       SELECT numequit, SUM(montenca) AS montant_encaisse
       FROM encaissement_quittance
       WHERE dateannu IS NULL
       GROUP BY numequit
     ) enc ON enc.numequit = q.numequit
     WHERE COALESCE(q.modi__le, q.cree__le) >= :1
        OR EXISTS (
          SELECT 1 FROM encaissement_quittance e
          WHERE e.numequit = q.numequit AND COALESCE(e.modi__le, e.cree__le) >= :2
        )`,
    [since, since],
  );
  return rows;
}
