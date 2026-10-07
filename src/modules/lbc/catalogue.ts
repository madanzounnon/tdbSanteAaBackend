// Libellés repris à l'identique du modèle de fiche CENTIF-Bénin, section
// "Indices de soupçons de blanchiment de capitaux et de financement du
// terrorisme". L'ordre est celui de la fiche (ordre d'impression du PDF).
export const INDICES_CENTIF: { code: string; libelle: string }[] = [
  { code: 'SOMMES_INHABITUELLES', libelle: 'Suspicion portant sur des sommes ou opérations inhabituelles' },
  { code: 'TRANSFERT_RETRAITS', libelle: "Transfert important de fonds sur des comptes bancaires ne présentant pas d'opérations d'autre nature, suivi immédiatement de retraits en espèces, de chèques et de transferts nationaux et internationaux" },
  { code: 'DISPROPORTION_CA', libelle: "Disproportion excessive entre le chiffre d'affaires déclaré et l'importance des opérations financières effectuées" },
  { code: 'FAUX_DOCUMENTS', libelle: 'Autorisations de change justifiées par de faux documents commerciaux (transferts frauduleux)' },
  { code: 'FRACTIONNEMENT', libelle: "Fractionnement des opérations en montant juste inférieur au seuil d'identification prévu" },
  { code: 'DOUTE_IDENTITE', libelle: "Doute sur l'identité du donneur d'ordre ou du bénéficiaire effectif ou de l'ayant droit économique" },
  { code: 'FAUX_BILLETS', libelle: "Détection d'une quantité plus ou moins importante de faux billets ou de billets maculés dans les fonds servant à une opération (dépôts d'espèces, change manuel)" },
  { code: 'OBJET_SOCIAL', libelle: "Absence totale de correspondance entre l'objet social de la société ou de l'entité et l'activité générant les fonds" },
  { code: 'ARRET_BRUSQUE', libelle: "Arrêt brusque des opérations par le client lorsque l'institution financière demande des pièces justificatives pertinentes relatives au fondement des flux financiers" },
  { code: 'SANS_REVENUS', libelle: 'Clients ayant des moyens de subsistance confortables sans revenus connus' },
  { code: 'DEPOTS_OBNL', libelle: "Multiplications inexpliquées de dépôts en espèces de la part des membres d'organisations à but non lucratif et d'œuvres caritatives" },
  { code: 'GAIN_JEUX', libelle: 'Remise de chèques importants déclarés représentant un « gain de jeux »' },
  { code: 'GEL_FONDS', libelle: 'Opérations impliquant une personne ou entité concernée par une procédure de gel de fonds ou des ressources financières' },
  { code: 'PAYS_RISQUE', libelle: 'Cas d\'opérations ayant un lien avec les pays à haut risque ou pays non coopératifs' },
  { code: 'PORTEFEUILLE_TITRES', libelle: "Portefeuille des titres sans rapport avec les revenus connus ou avec l'activité du client" },
  { code: 'PRIME_UNIQUE', libelle: "Achat d'une police à prime unique réalisé en espèces ou au moyen d'un chèque pour un montant hors de proportion avec les revenus du souscripteur" },
  { code: 'RESILIATION_BRUSQUE', libelle: "Résiliation brusque d'un contrat sans que le client ne soit inquiet du montant important des pénalités ou impôts à payer" },
  { code: 'IMMOBILIER', libelle: 'Achats successifs de biens immobiliers de valeurs importantes réglés en espèces ou par chèques' },
  { code: 'MONTAGES_JURIDIQUES', libelle: 'Montages juridiques successifs de sociétés de valeurs importantes' },
  { code: 'SOCIETES_FAILLITE', libelle: 'Prise de participation ou acquisition de sociétés en faillite' },
];

// Critères de sélection automatique (filtre du point 1 + listes de contrôle
// des points 3 et 4 du cahier) et indice CENTIF pré-coché correspondant
// lorsqu'une déclaration est créée à partir de ces opérations.
export const CRITERES: Record<string, { libelle: string; indice: string | null }> = {
  SEUIL_UNITAIRE: { libelle: 'Transaction unique ≥ seuil', indice: 'SOMMES_INHABITUELLES' },
  CUMUL_PERSONNE: { libelle: 'Cumul de l\'individu sur la période ≥ seuil', indice: 'SOMMES_INHABITUELLES' },
  CUMUL_POLICE: { libelle: 'Cumul sur la police en cours ≥ seuil', indice: 'SOMMES_INHABITUELLES' },
  FRACTIONNEMENT: { libelle: 'Fractionnement juste sous le seuil', indice: 'FRACTIONNEMENT' },
  PAYS_RISQUE: { libelle: 'Lien avec un pays à risque (GAFI)', indice: 'PAYS_RISQUE' },
  PERSONNE_SURVEILLEE: { libelle: 'Personne sous contrôle (PPE, PEE, sanctions...)', indice: null },
};

// Signaux complémentaires affichés à côté des critères (ne suffisent pas
// seuls à sélectionner une opération).
export const SIGNAUX: Record<string, { libelle: string; indice: string | null }> = {
  ESPECES: { libelle: 'Paiement en espèces', indice: null },
  RESILIATION: { libelle: 'Police résiliée', indice: 'RESILIATION_BRUSQUE' },
};

export const STATUTS_OPERATION: Record<string, string> = {
  EXECUTEE: 'Exécutée(s)',
  A_EXECUTER: 'A exécuter',
  ANNULEE_CLIENT: 'Annulée(s) par le client',
  REFUSEE: "Refusée(s) par l'organisme déclarant",
};

export const STATUTS_TRANSMISSION: Record<string, string> = {
  NON_TRANSMISE: 'Non transmise',
  TRANSMISE: 'Transmise à la CENTIF',
};

export const STATUTS_DOSSIER: Record<string, string> = {
  EN_COURS: 'En cours',
  ABANDON: 'Abandon',
  SANS_SUITE: 'Sans suite',
  AVERE: 'Avéré',
  NON_AVERE: 'Non avéré',
};

export const TYPES_CLIENT: Record<string, string> = {
  OCCASIONNEL: 'Occasionnel',
  HABITUEL: 'Habituel',
  CONNU: 'Connu du déclarant',
  TERMINEE: 'Relation client terminée',
};
