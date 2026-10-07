import { querySource } from '../config/source-pool';

export interface EncaissementSource {
  cle_source: string;
  numero_quittance: string;
  date_encaissement: Date;
  montant: number;
  mode_paiement: string | null;
  libelle_mode_paiement: string | null;
  reference: string | null;
  emetteur: string | null;
  annule: number;
  date_annulation: Date | null;
  motif_annulation: string | null;
  annule_par: string | null;
  saisi_par: string | null;
  maj_source: Date | null;
}

// Détail des encaissements des quittances Santé (codebran = 10), annulés
// compris. Clé source = PK ORASS (numequit, dateenca, modepaie, natuenca).
// Jointure à QUITTANCE sur numequit SEUL (sa PK) : codinteq est
// l'intermédiaire qui a encaissé, pas forcément celui de la quittance (cf.
// prime.extractor.ts). numero_quittance = codeinte-numequit, même clé que
// fait_prime. Motif d'annulation : MOTIFS_ANNULATION de nature 'AQ'
// (annulation d'encaissement — la table mélange d'autres natures, ex. 'RP'
// pour les rejets de prestations, avec des codes qui se recouvrent).
export async function extractEncaissements(since: Date): Promise<EncaissementSource[]> {
  const { rows } = await querySource<EncaissementSource>(
    `SELECT
       TO_CHAR(e.numequit) || '|' || TO_CHAR(e.dateenca, 'YYYYMMDDHH24MISS') || '|' || e.modepaie || '|' || e.natuenca AS "cle_source",
       TO_CHAR(q.codeinte) || '-' || TO_CHAR(q.numequit) AS "numero_quittance",
       e.dateenca AS "date_encaissement",
       e.montenca AS "montant",
       e.modepaie AS "mode_paiement",
       mp.libemode AS "libelle_mode_paiement",
       TRIM(NVL(e.refeenca, e.numecheq)) AS "reference",
       TRIM(e.emetcheq) AS "emetteur",
       CASE WHEN e.dateannu IS NOT NULL THEN 1 ELSE 0 END AS "annule",
       e.dateannu AS "date_annulation",
       ma.desmotan AS "motif_annulation",
       e.annu_par AS "annule_par",
       e.cree_par AS "saisi_par",
       COALESCE(e.modi__le, e.cree__le, e.dateenca) AS "maj_source"
     FROM encaissement_quittance e
     JOIN quittance q ON q.numequit = e.numequit
     JOIN categorie c ON c.codecate = q.codecate AND c.codebran = 10
     LEFT JOIN mode_paiement mp ON mp.modepaie = e.modepaie
     LEFT JOIN motifs_annulation ma ON ma.codmotan = e.codmotan AND ma.natmotan = 'AQ'
     WHERE COALESCE(e.modi__le, e.cree__le, e.dateenca) >= :1`,
    [since],
  );
  return rows;
}
