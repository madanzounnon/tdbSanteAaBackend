import { Regle } from './droits.service';

// Privilèges exigés par route (chemins relatifs au point de montage).
// La première règle qui correspond s'applique ; une route absente est refusée.

const OPS = ['LBC_OPERATIONS_CONSULTER', 'LBC_OPERATIONS_TRAITER'];
const DECL = ['LBC_DECLARATIONS_CONSULTER', 'LBC_DECLARATIONS_GERER'];
const REF = ['LBC_REFERENTIELS_CONSULTER', 'LBC_REFERENTIELS_GERER'];
const GET = ['GET'];

// /api/lbc
export const REGLES_LBC: Regle[] = [
  // Libellés (branches, critères, qualités) : utiles à plusieurs écrans.
  { methodes: GET, chemin: /^\/catalogue\/?$/, privileges: [] },
  { chemin: /^\/parametres\/?$/, privileges: ['LBC_PARAMETRES'] },

  // Répertoires
  { methodes: GET, chemin: /^\/structures-confiance\/clients\/?$/, privileges: ['LBC_REFERENTIELS_GERER'] },
  { methodes: GET, chemin: /^\/(structures-confiance|pays-risque|personnes-surveillees)\/?$/, privileges: REF },
  { chemin: /^\/(structures-confiance|pays-risque|personnes-surveillees)(\/.*)?$/, privileges: ['LBC_REFERENTIELS_GERER'] },

  // Opérations
  { methodes: GET, chemin: /^\/operations\/etat\/?$/, privileges: OPS },
  { methodes: ['POST'], chemin: /^\/operations\/synchroniser\/?$/, privileges: ['LBC_OPERATIONS_TRAITER'] },
  { methodes: GET, chemin: /^\/operations-suspectes\/?$/, privileges: OPS },
  { methodes: ['POST'], chemin: /^\/operations-suspectes\/(ecarter|retablir)\/?$/, privileges: ['LBC_OPERATIONS_TRAITER'] },

  // Déclarations (lecture : liste, fiche, PDF, pièces)
  { methodes: GET, chemin: /^\/declarations(\/.*)?$/, privileges: DECL },
  { chemin: /^\/declarations(\/.*)?$/, privileges: ['LBC_DECLARATIONS_GERER'] },

  // Éditions
  { methodes: GET, chemin: /^\/editions\/.+$/, privileges: ['LBC_EDITIONS'] },
];

// /api/notifications
export const REGLES_NOTIFICATIONS: Regle[] = [
  // Centre d'alertes : tout utilisateur connecté, contenu filtré par type
  // (ALERTES_LBC / ALERTES_SINISTRES) dans le service.
  { chemin: /^\/alertes(\/.*)?$/, privileges: [] },
  // Réglage : règles, destinataires, lancement, historique des envois.
  { chemin: /.*/, privileges: ['ALERTES_REGLER'] },
];
