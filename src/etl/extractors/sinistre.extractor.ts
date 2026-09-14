import { querySource } from '../config/source-pool';

export interface SinistreSource {
  numero_reglement_ligne: string;
  numero_police: string;
  matricule_assure: string;
  lien_parente: string | null;
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
// matricule_assure = identifiant de la personne physique réellement soignée
// (coderisq-codememb), PAS sinistre.codeassu (qui identifie le souscripteur/
// employeur, cf. RISQUE.codeassu). RISQUE = l'assuré principal (un
// enregistrement par salarié, avec nom réel et date de naissance,
// confirmé) ; RISQUE_FAMILLE = ses ayants droit (conjoint/enfants). Quand
// codememb est NULL (40% des lignes), la personne soignée est l'assuré
// principal lui-même : coderisq seul identifie alors la personne (résolu
// à 78,7% vers RISQUE, vérifié).
//
// lien_parente (adulte/enfant, résolu) : RISQUE_FAMILLE.lienpare via
// (codeinte, numepoli, coderisq, codememb) — table des ayants droit d'un
// risque (E = Enfant confirmé par les dates de naissance, C = Conjoint,
// A/T résiduels). SINISTRE.codememb IS NULL (40% des lignes) = l'assuré
// principal lui-même, jamais dans RISQUE_FAMILLE (qui ne liste que les
// ayants droit) : traité comme adulte par construction. Sur les 60%
// restants (codememb renseigné), 80,7% se résolvent via RISQUE_FAMILLE ; le
// reliquat non résolu retombe sur ADULTE par défaut (cf.
// transformTypeAssure).
//
// AMBIGUÏTÉS (cf. liste transmise) :
// - famille_prestation renvoie les 18 codes ORASS (AM, AMI, AS, B, C, D,
//   DF, EV, EVSN, HO, MA, OP, PH, PO, RE, TR, V, Z), pas les 8 catégories du
//   cahier. Le mapping vers NatureActe (dimensions.transformer.ts) ne
//   couvre que les correspondances évidentes (C/V->Consultation, PH->
//   Pharmacie, HO->Hospitalisation, MA->Maternité, OP->Optique, D->
//   Dentaire, B->Biologie, Z->Imagerie) ; le reste tombe dans Consultation
//   par défaut — à valider avec le métier.
//
// numero_police = codeinte-numepoli (clé composite, cf. police.extractor.ts
// — numepoli seul n'est pas unique globalement).
//
// d.datepres IS NOT NULL : exclut 60 lignes sur 2 248 499 (0,003%) où la
// date de prestation est absente en source — fait_sinistre.date est NOT
// NULL, et une ligne sans date n'est de toute façon pas exploitable.
//
// numero_reglement_ligne = clé naturelle de la ligne de règlement
// (codeinte-exersini-numesini-numeregl-numelign), pour permettre l'upsert
// au chargement plutôt qu'une simple insertion : sans elle, rejouer une
// fenêtre d'extraction qui se chevauche dupliquerait le sinistre.
export async function extractSinistres(since: Date): Promise<SinistreSource[]> {
  const { rows } = await querySource<SinistreSource>(
    `SELECT
       TO_CHAR(d.codeinte) || '-' || TO_CHAR(d.exersini) || '-' || TO_CHAR(d.numesini)
         || '-' || TO_CHAR(d.numeregl) || '-' || TO_CHAR(d.numelign) AS "numero_reglement_ligne",
       TO_CHAR(s.codeinte) || '-' || TO_CHAR(s.numepoli) AS "numero_police",
       TO_CHAR(s.coderisq) || '-' || NVL(TO_CHAR(s.codememb), '0') AS "matricule_assure",
       rf.lienpare AS "lien_parente",
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
     LEFT JOIN risque_famille rf
       ON rf.codeinte = s.codeinte AND rf.numepoli = s.numepoli
      AND rf.coderisq = s.coderisq AND rf.codememb = s.codememb
     WHERE d.modi__le >= :1
       AND d.datepres IS NOT NULL`,
    [since],
  );
  return rows;
}
