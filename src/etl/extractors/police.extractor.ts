import { querySource } from '../config/source-pool';

export interface PoliceSource {
  numero_police: string;
  souscripteur: string;
  statut_souscripteur: string;
  statut_police: string;
  date_effet: Date;
  date_echeance: Date;
  code_apporteur: string;
  code_apporteur_commercial: string | null;
  maj_le: Date;
}

// POLICE filtrée sur la branche Santé (CATEGORIE.codebran = 10, confirmé :
// BRANCHE 10 = "Assurance Santé"). ASSURE porte le souscripteur (raissoci +
// prenassu). Pas de prime ici : la prime d'une police se calcule via
// SUM(fait_prime.montant_emis) sur la période voulue (cf. entité dim_police)
// — GARANTIE_ACCORDEE.montgara n'était qu'un instantané figé au chargement.
//
// numero_police = codeinte-numepoli (clé composite) : NUMEPOLI seul n'est
// PAS unique globalement, il est réutilisé par des dizaines d'intermédiaires
// différents (vérifié : la police "10000001" existe sous 10 codeinte
// distincts). code_apporteur = p.codeinte directement (fiable, 0% de NULL
// sur le portefeuille Santé) — remplace POLICE.codeappo qui l'est à 86%.
//
// statut_police : POLICE n'a pas de colonne de statut fiable — flagannu vaut
// TOUJOURS 'N' sur tout le portefeuille Santé (vérifié, 2377/2377), donc
// inutilisable. La résiliation se détecte via AVENANT/TYPE_AVENANT : 3 codes
// confirmés (12 "résiliation avec ristourne", 13 "sans ristourne", 14 "avec
// ristourne sans prorata" — 22 polices concernées sur le portefeuille
// Santé). Sinon : échéance dépassée de plus de 90j -> clôturée (règle
// §6.1), échéance dépassée -> échue, sinon active.
//
// statut_souscripteur (Étatique / Non-Étatique) : ASSURE.codequal = 73 ->
// étatique, sinon non-étatique (confirmé sur le portefeuille Santé réel :
// 35 étatiques / 2342 non-étatiques).
//
// code_apporteur_commercial (vendeur individuel, dim_apporteur) vient de
// APPORTEUR_CONTRAT.codappin — couverture partielle (~33% sur le
// portefeuille Santé, NULL sinon). Sous-requête MIN(...) pour éviter la
// multiplication de lignes : APPORTEUR_CONTRAT porte plusieurs lignes par
// contrat (une par garantie/CODEGARA), avec en général le même apporteur.
//
// p.modi__le >= :1 OR p.modi__le IS NULL : certaines polices (souvent les
// plus anciennes, jamais retouchées) ont modi__le à NULL — une comparaison
// NULL >= date est toujours fausse en SQL, donc ces polices n'étaient JAMAIS
// extraites, quel que soit `since` (bug vérifié : 4 polices confirmées avec
// modi__le NULL, invisibles à toute extraction incrémentale avant ce fix).
export async function extractPolices(since: Date): Promise<PoliceSource[]> {
  const { rows } = await querySource<PoliceSource>(
    `SELECT
       TO_CHAR(p.codeinte) || '-' || TO_CHAR(p.numepoli) AS "numero_police",
       a.raissoci || CASE WHEN a.prenassu IS NOT NULL THEN ' ' || a.prenassu END AS "souscripteur",
       CASE WHEN a.codequal = 73 THEN 'ETATIQUE' ELSE 'NON_ETATIQUE' END AS "statut_souscripteur",
       CASE
         WHEN EXISTS (
           SELECT 1 FROM avenant ar
           WHERE ar.codeinte = p.codeinte AND ar.numepoli = p.numepoli
             AND ar.codtypav IN (12, 13, 14)
         ) THEN 'RESILIEE'
         WHEN SYSDATE > p.dateeche + 90 THEN 'CLOTUREE'
         WHEN SYSDATE > p.dateeche THEN 'ECHUE'
         ELSE 'ACTIVE'
       END AS "statut_police",
       p.dateeffe AS "date_effet",
       p.dateeche AS "date_echeance",
       TO_CHAR(p.codeinte) AS "code_apporteur",
       TO_CHAR((
         SELECT MIN(ac.codappin)
         FROM apporteur_contrat ac
         WHERE ac.codeinte = p.codeinte AND ac.numepoli = p.numepoli AND ac.avenmodi = p.avenmodi
           AND ac.codappin IS NOT NULL
       )) AS "code_apporteur_commercial",
       p.modi__le AS "maj_le"
     FROM police p
     JOIN categorie c ON c.codecate = p.codecate AND c.codebran = 10
     JOIN assure a ON a.codeassu = p.codeassu
     WHERE (p.modi__le >= :1 OR p.modi__le IS NULL)`,
    [since],
  );
  return rows;
}
