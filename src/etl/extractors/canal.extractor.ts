import { querySource } from '../config/source-pool';

export interface CanalSource {
  code: string;
  libelle: string;
  // Libellé ORASS (TYPE_INTERMEDIAIRE.libtypin) — cf. mapping dans
  // dimensions.transformer.ts et liste des ambiguïtés.
  type_intermediaire: string;
}

// Réseau de distribution = INTERMEDIAIRE (code = POLICE/QUITTANCE/
// SINISTRE.codeinte, jamais NULL sur le portefeuille Santé — clé fiable,
// contrairement à APPORTEUR.codeappo qui l'est à 86%). Les libellés
// (INTERMEDIAIRE.raisocin) correspondent exactement aux canaux nommés du
// cahier : "BUREAU DIRECT COTONOU AKPAKPA/CENTRE/PORTO-NOVO", etc.
// Typé via TYPE_INTERMEDIAIRE (Bureau Direct, Courtier, Bancassurance -
// MicroFinance, Agent Général, Compagnie, Réassureur).
//
// AMBIGUÏTÉ restante : pas de distinction gestionnaire / non gestionnaire
// pour "Courtier" au niveau INTERMEDIAIRE — cf. liste transmise.
export async function extractCanaux(): Promise<CanalSource[]> {
  const { rows } = await querySource<CanalSource>(`
    SELECT
      TO_CHAR(i.codeinte) AS "code",
      i.raisocin AS "libelle",
      ti.libtypin AS "type_intermediaire"
    FROM intermediaire i
    JOIN type_intermediaire ti ON ti.codtypin = i.codtypin
    WHERE ti.codtypin <> 'R'
  `);
  return rows;
}
