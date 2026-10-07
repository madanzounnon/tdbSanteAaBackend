import { querySource } from '../config/source-pool';

export interface LbcOperationSource {
  ref_source: string;
  source: 'ENCAISSEMENT' | 'REGLEMENT';
  sens: 'ENTREE' | 'SORTIE';
  date_operation: Date;
  montant: number;
  devise: string | null;
  mode_paiement: string | null;
  libelle_mode_paiement: string | null;
  reference: string | null;
  tireur: string | null;
  code_branche: number | null;
  libelle_branche: string | null;
  code_categorie: number | null;
  numero_police: string | null;
  date_effet_police: Date | null;
  date_echeance_police: Date | null;
  police_resiliee: number;
  numero_sinistre: string | null;
  code_client: string | null;
  nom_client: string | null;
  code_beneficiaire: string | null;
  nom_beneficiaire: string | null;
  type_personne: string | null;
  nature_beneficiaire: string | null;
  libelle_nature_beneficiaire: string | null;
  code_qualite: number | null;
  libelle_qualite: string | null;
  nationalite: string | null;
  pays_residence: string | null;
  annulee: number;
  maj_source: Date | null;
}

// Contrairement aux autres extracteurs du projet (Branche Santé, codebran =
// 10), le module LBC/FT porte sur TOUTES les branches ORASS : aucune
// restriction sur CATEGORIE.codebran.
//
// Deux flux de fonds :
//  - ENTRÉES : ENCAISSEMENT_QUITTANCE (primes encaissées). PK source =
//    (numequit, dateenca, modepaie, natuenca). Jointure à QUITTANCE sur
//    numequit SEUL (sa PK) : codinteq est l'intermédiaire qui a encaissé,
//    pas forcément celui de la quittance — joindre aussi sur codinteq =
//    codeinte perd ~23% des encaissements (vérifié : 45 985 / 203 273
//    depuis 2022, encaissés au guichet 1130 pour d'autres codes). Le payeur est
//    l'assuré de la quittance (QUITTANCE.codeassu, ~5% NULL -> repli sur
//    l'assuré de la police).
//  - SORTIES : REGLEMENT (règlements de sinistres, codtypre = 1 ; les
//    "recours aboutis" codtypre = 2 sont des récupérations, pas des
//    paiements). Les règlements aux prestataires maladie (codnatbe = 'P',
//    tiers-payant santé : ~880k lignes/an) sont exclus — flux commerciaux
//    avec des établissements de soins conventionnés, hors périmètre LBC et
//    qui noieraient le reste. Le bénéficiaire est REGLEMENT.nom_bene ;
//    quand c'est l'assuré lui-même (codnatbe = 'S'), on rattache le
//    règlement à son code assuré pour que le cumul par individu agrège ses
//    primes ET ses indemnités.
//
// Incrémental : COALESCE(modi__le, cree__le) >= since (même convention que
// prime.extractor.ts). `depuis` borne l'historique chargé au premier run.
export async function extractLbcOperations(since: Date, depuis: Date): Promise<LbcOperationSource[]> {
  const [encaissements, reglements] = await Promise.all([
    querySource<LbcOperationSource>(
      `SELECT
         'ENC-' || TO_CHAR(e.numequit) || '-' || TO_CHAR(e.dateenca, 'YYYYMMDDHH24MISS') || '-' || e.modepaie || '-' || e.natuenca AS "ref_source",
         'ENCAISSEMENT' AS "source",
         'ENTREE' AS "sens",
         e.dateenca AS "date_operation",
         e.montenca AS "montant",
         NVL(q.codedevi, 'FCFA') AS "devise",
         e.modepaie AS "mode_paiement",
         mp.libemode AS "libelle_mode_paiement",
         TRIM(NVL(e.refeenca, e.numecheq)) AS "reference",
         TRIM(e.emetcheq) AS "tireur",
         c.codebran AS "code_branche",
         b.libebran AS "libelle_branche",
         q.codecate AS "code_categorie",
         TO_CHAR(p.codeinte) || '-' || TO_CHAR(p.numepoli) AS "numero_police",
         p.dateeffe AS "date_effet_police",
         p.dateeche AS "date_echeance_police",
         CASE WHEN EXISTS (
           SELECT 1 FROM avenant ar
           WHERE ar.codeinte = p.codeinte AND ar.numepoli = p.numepoli AND ar.codtypav IN (12, 13, 14)
         ) THEN 1 ELSE 0 END AS "police_resiliee",
         NULL AS "numero_sinistre",
         TO_CHAR(a.codeassu) AS "code_client",
         TRIM(a.raissoci || CASE WHEN a.prenassu IS NOT NULL THEN ' ' || a.prenassu END) AS "nom_client",
         NULL AS "code_beneficiaire",
         NULL AS "nom_beneficiaire",
         NVL(a.genrassu, ql.genrassu) AS "type_personne",
         NULL AS "nature_beneficiaire",
         NULL AS "libelle_nature_beneficiaire",
         a.codequal AS "code_qualite",
         ql.libequal AS "libelle_qualite",
         a.codpayna AS "nationalite",
         NVL(a.codpayre, a.codepays) AS "pays_residence",
         CASE WHEN e.dateannu IS NOT NULL THEN 1 ELSE 0 END AS "annulee",
         COALESCE(e.modi__le, e.cree__le) AS "maj_source"
       FROM encaissement_quittance e
       JOIN quittance q ON q.numequit = e.numequit
       JOIN police p ON p.codeinte = q.codeinte AND p.numepoli = q.numepoli
       JOIN categorie c ON c.codecate = q.codecate
       LEFT JOIN branche b ON b.codebran = c.codebran
       LEFT JOIN assure a ON a.codeassu = NVL(q.codeassu, p.codeassu)
       LEFT JOIN qualite ql ON ql.codequal = a.codequal
       LEFT JOIN mode_paiement mp ON mp.modepaie = e.modepaie
       WHERE COALESCE(e.modi__le, e.cree__le, e.dateenca) >= :1
         AND e.dateenca >= :2`,
      [since, depuis],
    ),
    querySource<LbcOperationSource>(
      `SELECT
         'REG-' || TO_CHAR(r.codeinte) || '-' || TO_CHAR(r.numeregl) AS "ref_source",
         'REGLEMENT' AS "source",
         'SORTIE' AS "sens",
         r.dateregl AS "date_operation",
         r.montregl AS "montant",
         'FCFA' AS "devise",
         r.modepaie AS "mode_paiement",
         mp.libemode AS "libelle_mode_paiement",
         TRIM(NVL(r.numecheq, r.referegl)) AS "reference",
         NULL AS "tireur",
         c.codebran AS "code_branche",
         b.libebran AS "libelle_branche",
         r.codecate AS "code_categorie",
         CASE WHEN p.numepoli IS NOT NULL THEN TO_CHAR(p.codeinte) || '-' || TO_CHAR(p.numepoli) END AS "numero_police",
         p.dateeffe AS "date_effet_police",
         p.dateeche AS "date_echeance_police",
         CASE WHEN p.numepoli IS NOT NULL AND EXISTS (
           SELECT 1 FROM avenant ar
           WHERE ar.codeinte = p.codeinte AND ar.numepoli = p.numepoli AND ar.codtypav IN (12, 13, 14)
         ) THEN 1 ELSE 0 END AS "police_resiliee",
         TO_CHAR(r.intesini) || '-' || TO_CHAR(r.exersini) || '-' || TO_CHAR(r.numesini) AS "numero_sinistre",
         TO_CHAR(a.codeassu) AS "code_client",
         TRIM(a.raissoci || CASE WHEN a.prenassu IS NOT NULL THEN ' ' || a.prenassu END) AS "nom_client",
         TO_CHAR(r.codebene) AS "code_beneficiaire",
         TRIM(NVL(r.nom_bene, bn.nombenef)) AS "nom_beneficiaire",
         CASE WHEN r.codnatbe = 'S' THEN NVL(a.genrassu, ql.genrassu) END AS "type_personne",
         r.codnatbe AS "nature_beneficiaire",
         nb.libenatu AS "libelle_nature_beneficiaire",
         CASE WHEN r.codnatbe = 'S' THEN a.codequal END AS "code_qualite",
         CASE WHEN r.codnatbe = 'S' THEN ql.libequal END AS "libelle_qualite",
         CASE WHEN r.codnatbe = 'S' THEN a.codpayna END AS "nationalite",
         CASE WHEN r.codnatbe = 'S' THEN NVL(a.codpayre, a.codepays) END AS "pays_residence",
         CASE WHEN r.dateannu IS NOT NULL THEN 1 ELSE 0 END AS "annulee",
         COALESCE(r.modi__le, r.cree__le) AS "maj_source"
       FROM reglement r
       LEFT JOIN categorie c ON c.codecate = r.codecate
       LEFT JOIN branche b ON b.codebran = c.codebran
       LEFT JOIN sinistre s ON s.codeinte = r.intesini AND s.exersini = r.exersini AND s.numesini = r.numesini
       LEFT JOIN police p ON p.codeinte = s.codeinte AND p.numepoli = s.numepoli
       LEFT JOIN assure a ON a.codeassu = NVL(s.codeassu, p.codeassu)
       LEFT JOIN qualite ql ON ql.codequal = a.codequal
       LEFT JOIN beneficiaire bn ON bn.codebene = r.codebene
       LEFT JOIN nature_beneficiaire nb ON nb.codnatbe = r.codnatbe
       LEFT JOIN mode_paiement mp ON mp.modepaie = r.modepaie
       WHERE COALESCE(r.modi__le, r.cree__le, r.dateregl) >= :1
         AND r.dateregl >= :2
         AND NVL(r.codtypre, 1) = 1
         AND NVL(r.codnatbe, '-') <> 'P'`,
      [since, depuis],
    ),
  ]);
  return [...encaissements.rows, ...reglements.rows];
}
