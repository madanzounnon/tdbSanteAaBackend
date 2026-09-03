import { querySource } from '../config/source-pool';

export interface CanalSource {
  code: string;
  libelle: string;
  // Libellé ORASS (TYPE_INTERMEDIAIRE.libtypin), pas encore notre enum —
  // cf. mapping dans dimensions.transformer.ts et liste des ambiguïtés.
  type_intermediaire: string;
}

// Réseau de distribution = APPORTEUR, typé via APPORTEUR_INTERMED ->
// TYPE_INTERMEDIAIRE (confirmé par requête : Bureau Direct, Courtier,
// Bancassurance - MicroFinance, Agent Général, Compagnie, Réassureur).
// Compagnie et Réassureur exclus : ce ne sont pas des canaux de vente.
// AMBIGUÏTÉS (cf. liste transmise) : pas de distinction gestionnaire / non
// gestionnaire au niveau apporteur (seulement "Courtier") ; "Agent Général"
// mappé par défaut sur COORDINATION_AGENCES, à confirmer ; le regroupement
// des apporteurs individuels sous les BD nommés du cahier ("BD Cotonou
// Centre", etc.) n'est pas résolu (piste : APPORTEUR.LIENAPPO, non vérifiée).
export async function extractCanaux(): Promise<CanalSource[]> {
  const { rows } = await querySource<CanalSource>(`
    SELECT
      TO_CHAR(a.codeappo) AS "code",
      a.raissoci AS "libelle",
      ti.libtypin AS "type_intermediaire"
    FROM apporteur a
    JOIN apporteur_intermed ai ON ai.codeappo = a.codeappo AND ai.dateeche IS NULL
    JOIN type_intermediaire ti ON ti.codtypin = ai.codtypin
    WHERE ti.codtypin NOT IN ('C', 'R')
  `);
  return rows;
}
