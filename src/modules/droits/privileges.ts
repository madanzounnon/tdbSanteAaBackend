// Catalogue des privilèges du tableau de bord. Source de vérité : ce fichier.
// Il est recopié en base (table privilege) au démarrage de l'API, ce qui
// permet d'ajouter un privilège sans migration. Les rôles (table role) en
// regroupent plusieurs ; un utilisateur peut avoir plusieurs rôles.
//
// Un privilège correspond à un écran (consultation) ou à une action sensible
// (modification). Les menus du frontend et les routes de l'API utilisent les
// mêmes codes.

export interface Privilege {
  code: string;
  libelle: string;
  groupe: string;
  description: string;
}

export const PRIVILEGES = [
  // ------------------------------------------------------------ Branche Santé
  { code: 'SANTE_VUE_EXECUTIVE', groupe: 'Branche Santé', libelle: 'Vue exécutive', description: 'Synthèse et alertes de la Direction générale.' },
  { code: 'SANTE_CHIFFRE_AFFAIRES', groupe: 'Branche Santé', libelle: "Chiffre d'affaires", description: 'Production, canaux, tranches de prime, historique.' },
  { code: 'SANTE_ENCAISSEMENTS', groupe: 'Branche Santé', libelle: 'Encaissements', description: 'Encaissements de primes et recouvrement.' },
  { code: 'SANTE_SINISTRALITE', groupe: 'Branche Santé', libelle: 'Sinistralité', description: 'S/P, actes médicaux, portefeuille par niveau de risque.' },
  { code: 'SANTE_TOP_CONTRATS', groupe: 'Branche Santé', libelle: 'Top contrats', description: 'Classement des polices par prime et par sinistralité.' },
  { code: 'SANTE_PRESTATAIRES', groupe: 'Branche Santé', libelle: 'Prestataires', description: 'Factures, délais de règlement, réseau de soins.' },
  { code: 'SANTE_REGULARISATION', groupe: 'Branche Santé', libelle: 'Régularisation', description: 'Polices critiques et montants à régulariser.' },
  { code: 'SANTE_OBJECTIFS_CONSULTER', groupe: 'Branche Santé', libelle: 'Objectifs annuels (consulter)', description: "Voir les objectifs de chiffre d'affaires." },
  { code: 'SANTE_OBJECTIFS_GERER', groupe: 'Branche Santé', libelle: 'Objectifs annuels (modifier)', description: 'Créer, modifier et supprimer les objectifs annuels.' },

  // --------------------------------------------------------- Anti-blanchiment
  { code: 'LBC_OPERATIONS_CONSULTER', groupe: 'Anti-blanchiment', libelle: 'Opérations suspectes (consulter)', description: 'Voir les opérations retenues par le filtre de sélection.' },
  { code: 'LBC_OPERATIONS_TRAITER', groupe: 'Anti-blanchiment', libelle: 'Opérations suspectes (traiter)', description: "Écarter, rétablir des opérations et lancer le chargement depuis ORASS." },
  { code: 'LBC_DECLARATIONS_CONSULTER', groupe: 'Anti-blanchiment', libelle: 'Déclarations CENTIF (consulter)', description: 'Voir les déclarations de soupçon, leurs fiches PDF et pièces.' },
  { code: 'LBC_DECLARATIONS_GERER', groupe: 'Anti-blanchiment', libelle: 'Déclarations CENTIF (gérer)', description: 'Créer, modifier, changer le statut et supprimer des déclarations ; joindre des pièces.' },
  { code: 'LBC_EDITIONS', groupe: 'Anti-blanchiment', libelle: 'Éditions', description: 'États périodiques, export Excel et impression.' },
  { code: 'LBC_REFERENTIELS_CONSULTER', groupe: 'Anti-blanchiment', libelle: 'Répertoires (consulter)', description: 'Structures de confiance, pays à risque, personnes sous contrôle.' },
  { code: 'LBC_REFERENTIELS_GERER', groupe: 'Anti-blanchiment', libelle: 'Répertoires (modifier)', description: 'Ajouter, modifier, supprimer et mettre à jour les répertoires.' },
  { code: 'LBC_PARAMETRES', groupe: 'Anti-blanchiment', libelle: 'Paramètres anti-blanchiment', description: 'Seuils du filtre, exemptions, organisme déclarant, API de mise à jour.' },

  // ------------------------------------------------------------------ Alertes
  { code: 'ALERTES_LBC', groupe: 'Alertes', libelle: 'Alertes anti-blanchiment', description: "Voir les alertes sur les nouveaux cas anti-blanchiment (cloche et page Alertes)." },
  { code: 'ALERTES_SINISTRES', groupe: 'Alertes', libelle: 'Alertes règlements de sinistres', description: 'Voir les alertes sur les règlements de sinistres importants.' },
  { code: 'ALERTES_REGLER', groupe: 'Alertes', libelle: 'Réglage des alertes', description: 'Règles, seuil, destinataires email/SMS, lancement manuel, historique des envois.' },

  // ----------------------------------------------------------- Administration
  { code: 'UTILISATEURS_GERER', groupe: 'Administration', libelle: 'Gestion des utilisateurs', description: 'Créer, modifier, désactiver des comptes ; attribuer les rôles.' },
  { code: 'ROLES_GERER', groupe: 'Administration', libelle: 'Rôles et privilèges', description: 'Créer et modifier les rôles et leurs privilèges.' },
  { code: 'JOURNAL_CONNEXIONS', groupe: 'Administration', libelle: 'Journal de connexion', description: 'Consulter les connexions, échecs et actions sur les comptes de tous les utilisateurs.' },
] as const satisfies readonly Privilege[];

export type CodePrivilege = (typeof PRIVILEGES)[number]['code'];

export const CODES_PRIVILEGES: string[] = PRIVILEGES.map((p) => p.code);

// Privilèges indispensables à l'administration : au moins un compte actif
// doit toujours les détenir (sinon plus personne ne peut gérer les accès).
export const PRIVILEGES_ADMIN: CodePrivilege[] = ['UTILISATEURS_GERER', 'ROLES_GERER'];

// Rôles créés à l'installation (modifiables ensuite, sauf l'administrateur
// qui détient toujours tous les privilèges, y compris ceux ajoutés plus tard).
export const ROLES_INITIAUX: { nom: string; description: string; tous: boolean; privileges: CodePrivilege[] }[] = [
  {
    nom: 'Administrateur',
    description: 'Accès complet, y compris la gestion des utilisateurs et des rôles.',
    tous: true,
    privileges: [],
  },
  {
    nom: 'Direction générale',
    description: 'Consultation de tout le tableau de bord Santé et des alertes de sinistres.',
    tous: false,
    privileges: [
      'SANTE_VUE_EXECUTIVE', 'SANTE_CHIFFRE_AFFAIRES', 'SANTE_ENCAISSEMENTS', 'SANTE_SINISTRALITE', 'SANTE_TOP_CONTRATS',
      'SANTE_PRESTATAIRES', 'SANTE_REGULARISATION', 'SANTE_OBJECTIFS_CONSULTER', 'ALERTES_SINISTRES',
    ],
  },
  {
    nom: 'Gestionnaire Santé',
    description: 'Tableau de bord Santé et saisie des objectifs annuels.',
    tous: false,
    privileges: [
      'SANTE_VUE_EXECUTIVE', 'SANTE_CHIFFRE_AFFAIRES', 'SANTE_ENCAISSEMENTS', 'SANTE_SINISTRALITE', 'SANTE_TOP_CONTRATS',
      'SANTE_PRESTATAIRES', 'SANTE_REGULARISATION', 'SANTE_OBJECTIFS_CONSULTER', 'SANTE_OBJECTIFS_GERER', 'ALERTES_SINISTRES',
    ],
  },
  {
    nom: 'Conformité anti-blanchiment',
    description: 'Module anti-blanchiment complet et alertes associées.',
    tous: false,
    privileges: [
      'LBC_OPERATIONS_CONSULTER', 'LBC_OPERATIONS_TRAITER', 'LBC_DECLARATIONS_CONSULTER', 'LBC_DECLARATIONS_GERER',
      'LBC_EDITIONS', 'LBC_REFERENTIELS_CONSULTER', 'LBC_REFERENTIELS_GERER', 'LBC_PARAMETRES',
      'ALERTES_LBC', 'ALERTES_SINISTRES', 'ALERTES_REGLER',
    ],
  },
];
