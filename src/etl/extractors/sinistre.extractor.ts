import { querySource } from '../config/source-pool';

export interface SinistreSource {
  numero_police: string;
  code_assure: string;
  famille_prestation: string;
  date_reglement: Date;
  montant_paye: number;
  nom_prestataire: string | null;
  code_categorie_prestataire: string | null;
}

// Granularité acte = DETAIL_SINISTRE_REGLE (montant réglé par prestation),
// jointe à SINISTRE pour remonter à la police, et à PRESTATION ->
// FAMILLE_PRESTATION pour la nature d'acte. Le prestataire (BENEFICIAIRE)
// se rattache via SINISTRE.codebene et NON detail_sinistre_regle.codebene :
// vérifié sur 50k lignes, ce dernier est NULL à 99,9% alors que
// sinistre.codebene ne l'est jamais. Filtré sur codnatbe = 'P' (confirmé :
// "Prestataire Maladie" via NATURE_BENEFICIAIRE) ; catégorie = codnatpr,
// cf. mapping dans transformCategoriePrestataire.
//
// AMBIGUÏTÉS (cf. liste transmise) :
// - famille_prestation renvoie les 18 codes ORASS (AM, AMI, AS, B, C, D,
//   DF, EV, EVSN, HO, MA, OP, PH, PO, RE, TR, V, Z), pas les 8 catégories du
//   cahier. Le mapping vers NatureActe (dimensions.transformer.ts) ne
//   couvre que les correspondances évidentes (C/V->Consultation, PH->
//   Pharmacie, HO->Hospitalisation, MA->Maternité, OP->Optique, D->
//   Dentaire, B->Biologie, Z->Imagerie) ; le reste tombe dans Consultation
//   par défaut — à valider avec le métier.
// - code_assure = SINISTRE.codeassu, pas confirmé comme "matricule assuré"
//   ni comme identifiant de la personne physique bénéficiaire (vs
//   souscripteur) — cf. ambiguïtés dim_assure. type_assure (adulte/enfant)
//   n'a aucune source identifiée : non extrait, la distinction adulte/enfant
//   reste à câbler une fois la bonne table de personnes physiques trouvée.
//
// numero_police = codeinte-numepoli (clé composite, cf. police.extractor.ts
// — numepoli seul n'est pas unique globalement).
export async function extractSinistres(since: Date): Promise<SinistreSource[]> {
  const { rows } = await querySource<SinistreSource>(
    `SELECT
       TO_CHAR(s.codeinte) || '-' || TO_CHAR(s.numepoli) AS "numero_police",
       TO_CHAR(s.codeassu) AS "code_assure",
       fp.codfampr AS "famille_prestation",
       d.datepres AS "date_reglement",
       d.montregl AS "montant_paye",
       b.nombenef AS "nom_prestataire",
       b.codnatpr AS "code_categorie_prestataire"
     FROM detail_sinistre_regle d
     JOIN sinistre s
       ON s.codeinte = d.codeinte AND s.exersini = d.exersini AND s.numesini = d.numesini
     JOIN categorie c ON c.codecate = s.codecate AND c.codebran = 10
     JOIN prestation p ON p.codepres = d.codepres
     JOIN famille_prestation fp ON fp.codfampr = p.codfampr
     LEFT JOIN beneficiaire b ON b.codebene = s.codebene AND b.codnatbe = 'P'
     WHERE d.modi__le >= :1`,
    [since],
  );
  return rows;
}
