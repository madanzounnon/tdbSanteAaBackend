import { querySource } from '../config/source-pool';

export interface AssureSource {
  numero_police: string;
  matricule: string;
  nom: string | null;
  date_naissance: Date | null;
  sexe: string | null;
  est_assure_principal: number;
  lien_parente: string | null;
  date_entree: Date | null;
}

// Roster complet des bénéficiaires (cahier §3.4 "Nombre Total d'Assurés"),
// indépendant de SINISTRE : jusqu'ici dim_assure n'était peuplée qu'en
// sous-produit de loadSinistres (findOrCreateAssure), donc un salarié ou un
// ayant droit qui n'a jamais consommé de soins n'apparaissait JAMAIS —
// faussant à la fois l'effectif total et le taux de recours (qui doit
// rapporter les "avec soins" à la VRAIE population, pas à ceux qui ont déjà
// eu un sinistre).
//
// RISQUE = l'assuré principal (un enregistrement par salarié, confirmé —
// vérifié : 99 260 lignes RISQUE santé = 99 260 personnes distinctes
// (codeinte, numepoli, coderisq), donc PAS de doublon par avenant malgré la
// colonne avenmodi ; contrairement à apporteur_contrat dans
// police.extractor.ts, il ne faut PAS filtrer sur p.avenmodi = r.avenmodi —
// vérifié empiriquement : ce filtre ne matcherait que 25 709 lignes sur
// 99 260 (74% perdues), donc avenmodi enregistre juste le dernier avenant
// ayant touché la ligne, pas une clé de versionnement à rejoindre).
//
// RISQUE_FAMILLE = ses ayants droit (conjoint/enfants). N'a PAS de colonne
// modi__le/cree__le (vérifié) : aucune extraction incrémentale fiable n'est
// possible sur cette table, contrairement à toutes les autres extractions du
// projet — cette fonction fait donc TOUJOURS un refresh complet (pas de
// paramètre `since`), acceptable vu le volume modeste (≈320k lignes santé
// au total sur RISQUE + RISQUE_FAMILLE).
//
// matricule = même clé naturelle que sinistre.extractor.ts (coderisq-0 pour
// le principal, coderisq-codememb pour un ayant droit), pour que
// findOrCreateAssure upserte la même ligne quelle que soit la source
// (roster ou sinistre).
//
// date_entree (RISQUE_FAMILLE.dateentr, 96,6% renseigné sur 219 477 lignes,
// vérifié) : permet d'identifier un "nouvel ayant droit" par exercice, sur
// le modèle de NA/REN au niveau police (cf. chiffre-affaires.service.ts).
// N'existe QUE côté ayants droit — RISQUE (principal) n'a pas de champ
// équivalent en source (table générique multi-branches, seulement date de
// naissance / permis de conduire), donc NULL par construction pour un
// principal, pas un oubli.
export async function extractAssures(): Promise<AssureSource[]> {
  const { rows } = await querySource<AssureSource>(
    `SELECT
       TO_CHAR(p.codeinte) || '-' || TO_CHAR(p.numepoli) AS "numero_police",
       TO_CHAR(r.coderisq) || '-0' AS "matricule",
       r.liberisq AS "nom",
       r.datenais AS "date_naissance",
       r.sexerisq AS "sexe",
       1 AS "est_assure_principal",
       NULL AS "lien_parente",
       NULL AS "date_entree"
     FROM risque r
     JOIN police p ON p.codeinte = r.codeinte AND p.numepoli = r.numepoli
     JOIN categorie c ON c.codecate = p.codecate AND c.codebran = 10

     UNION ALL

     SELECT
       TO_CHAR(p.codeinte) || '-' || TO_CHAR(p.numepoli) AS "numero_police",
       TO_CHAR(rf.coderisq) || '-' || TO_CHAR(rf.codememb) AS "matricule",
       rf.nom_memb AS "nom",
       rf.datenais AS "date_naissance",
       rf.sexememb AS "sexe",
       0 AS "est_assure_principal",
       rf.lienpare AS "lien_parente",
       rf.dateentr AS "date_entree"
     FROM risque_famille rf
     JOIN police p ON p.codeinte = rf.codeinte AND p.numepoli = rf.numepoli
     JOIN categorie c ON c.codecate = p.codecate AND c.codebran = 10`,
  );
  return rows;
}
