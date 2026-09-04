import { querySource } from '../config/source-pool';

export interface PoliceSource {
  numero_police: string;
  souscripteur: string;
  statut_souscripteur: string;
  statut_police: string;
  prime_annuelle: number;
  date_effet: Date;
  date_echeance: Date;
  code_apporteur: string;
  maj_le: Date;
}

// POLICE filtrée sur la branche Santé (CATEGORIE.codebran = 10, confirmé :
// BRANCHE 10 = "Assurance Santé"). ASSURE porte le souscripteur (raissoci +
// prenassu) ; prime_annuelle vient de la somme des garanties accordées
// (GARANTIE_ACCORDEE.montgara), l'alternative POLICE.mont__ca/monaccpo
// n'étant pas confirmée comme équivalente — cf. ambiguïtés.
//
// statut_police dérivé faute de colonne dédiée : flagannu = 'O' -> résiliée,
// échéance dépassée de plus de 90j -> clôturée (règle §6.1), échéance
// dépassée -> échue, sinon active. Hypothèse sur flagannu à confirmer.
//
// statut_souscripteur (Étatique / Non-Étatique) : ASSURE.codequal = 73 ->
// étatique, sinon non-étatique (confirmé sur le portefeuille Santé réel :
// 35 étatiques / 2342 non-étatiques).
export async function extractPolices(since: Date): Promise<PoliceSource[]> {
  const { rows } = await querySource<PoliceSource>(
    `SELECT
       TO_CHAR(p.numepoli) AS "numero_police",
       a.raissoci || CASE WHEN a.prenassu IS NOT NULL THEN ' ' || a.prenassu END AS "souscripteur",
       CASE WHEN a.codequal = 73 THEN 'ETATIQUE' ELSE 'NON_ETATIQUE' END AS "statut_souscripteur",
       CASE
         WHEN p.flagannu = 'O' THEN 'RESILIEE'
         WHEN SYSDATE > p.dateeche + 90 THEN 'CLOTUREE'
         WHEN SYSDATE > p.dateeche THEN 'ECHUE'
         ELSE 'ACTIVE'
       END AS "statut_police",
       NVL(g.prime_annuelle, 0) AS "prime_annuelle",
       p.dateeffe AS "date_effet",
       p.dateeche AS "date_echeance",
       TO_CHAR(p.codeappo) AS "code_apporteur",
       p.modi__le AS "maj_le"
     FROM police p
     JOIN categorie c ON c.codecate = p.codecate AND c.codebran = 10
     JOIN assure a ON a.codeassu = p.codeassu
     LEFT JOIN (
       SELECT numepoli, codeinte, SUM(montgara) AS prime_annuelle
       FROM garantie_accordee
       GROUP BY numepoli, codeinte
     ) g ON g.numepoli = p.numepoli AND g.codeinte = p.codeinte
     WHERE p.modi__le >= :1`,
    [since],
  );
  return rows;
}
