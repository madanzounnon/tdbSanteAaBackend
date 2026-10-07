// Polices présentes dans ORASS mais à tenir hors du tableau de bord
// (polices de test / de formation). Elles ne sont jamais chargées dans
// dim_police : leurs primes, sinistres et assurés sont donc ignorés par les
// loaders (police introuvable), sans filtre à répéter dans chaque requête.
//
// Recherche faite le 2026-10-05 sur la branche Santé (noms TEST/ESSAI/
// FORMATION ORASS/DEMO..., quittances toutes < 5 000 FCFA) :
//  - 1130-10100090 : souscripteur "FORMATION ORASS", 22 FCFA par an ;
//  - 2052--101608  : souscripteur "ESSAI", même créateur ORASS.
// Non exclues car vrais assurés à prime symbolique : LERGC (laboratoire
// d'essais), "STAGIAIRES ET INTERIMAIRES AA", L'AFRICAINE VIE BENIN.
//
// Surchargeable par TDB_POLICES_EXCLUES (numéros séparés par des virgules).
export const POLICES_EXCLUES = new Set(
  (process.env.TDB_POLICES_EXCLUES ?? '1130-10100090,2052--101608')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean),
);

export const estPoliceExclue = (numeroPolice: string): boolean => POLICES_EXCLUES.has(numeroPolice);
