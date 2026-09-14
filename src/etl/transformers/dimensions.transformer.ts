import { TypeCanal } from '../../entities/canal.entity';
import { TypeApporteur } from '../../entities/apporteur.entity';
import { StatutSouscripteur, StatutPolice } from '../../entities/police.entity';
import { CategoriePrestataire } from '../../entities/prestataire.entity';
import { CanalSource } from '../extractors/canal.extractor';
import { ApporteurSource } from '../extractors/apporteur.extractor';
import { PoliceSource } from '../extractors/police.extractor';
import { TypeAvenantSource } from '../extractors/type-avenant.extractor';

// Mapping depuis TYPE_INTERMEDIAIRE.libtypin (ORASSADM). Pas de distinction
// gestionnaire/non gestionnaire pour les courtiers (décision produit — la
// source ne la portait de toute façon pas).
const MAPPING_TYPE_CANAL: Record<string, TypeCanal> = {
  'Bureau Direct': TypeCanal.BUREAU_DIRECT,
  Courtier: TypeCanal.COURTIER,
  'Bancassurance - MicroFinance': TypeCanal.BANCASSURANCE,
  'Agent Général': TypeCanal.COORDINATION_AGENCES,
  // Polices gérées directement par la compagnie, sans intermédiaire tiers
  // (7 polices sur le portefeuille Santé) — pas d'équivalent dans le
  // cahier, rattachées à Bureau Direct par défaut.
  Compagnie: TypeCanal.BUREAU_DIRECT,
};

export function transformCanal(source: CanalSource) {
  return {
    nom: source.libelle,
    typeCanal: MAPPING_TYPE_CANAL[source.type_intermediaire] ?? TypeCanal.BUREAU_DIRECT,
    codeSource: source.code,
  };
}

// APPORTEUR.codtypap (confirmé via TYPE_APPORTEUR, 3 valeurs) : A = agréé,
// D = affaire directe, L = libre.
const MAPPING_TYPE_APPORTEUR: Record<string, TypeApporteur> = {
  A: TypeApporteur.AGREE,
  D: TypeApporteur.AFFAIRE_DIRECTE,
  L: TypeApporteur.LIBRE,
};

export function transformApporteur(source: ApporteurSource) {
  return {
    nom: source.nom,
    typeApporteur: MAPPING_TYPE_APPORTEUR[source.type_apporteur] ?? TypeApporteur.AGREE,
    codeSource: source.code,
  };
}

// Référentiel ORASS TYPE_AVENANT repris tel quel (code/libellé/nature) —
// pas d'enum applicatif, la valeur fait foi telle que définie en source.
export function transformTypeAvenant(source: TypeAvenantSource) {
  return {
    code: source.code,
    libelle: source.libelle,
    nature: source.nature,
  };
}

export function transformPolice(source: PoliceSource) {
  return {
    numeroPolice: source.numero_police,
    souscripteur: source.souscripteur,
    statutSouscripteur:
      source.statut_souscripteur === 'ETATIQUE'
        ? StatutSouscripteur.ETATIQUE
        : StatutSouscripteur.NON_ETATIQUE,
    statutPolice:
      StatutPolice[source.statut_police as keyof typeof StatutPolice] ?? StatutPolice.ACTIVE,
    dateEffet: source.date_effet,
    dateEcheance: source.date_echeance,
    codeApporteur: source.code_apporteur,
    codeApporteurCommercial: source.code_apporteur_commercial,
  };
}

// Source = BENEFICIAIRE.codnatpr (prestataires filtrés sur codnatbe = 'P',
// confirmé = "Prestataire Maladie" via NATURE_BENEFICIAIRE). Aucune table de
// décodage pour codnatpr, mais les codes sont explicites au vu des libellés
// réels :
// - PH = Pharmacie, OP = Optique, DE = Dentaire, LB = Laboratoire (fiables)
// - LR = Imagerie/Radiologie (vérifié : "Centre de Radiologie", "Centre
//   d'Imagerie Médicale", "Centre de Radiographie/Échographie")
// - SB = Centre de santé (soins), confirmé par le métier — bucket qui
//   mélange hôpitaux/cliniques/cabinets sans distinction public/privé
//   possible en l'état (pas de flag en source) : catégorie dédiée
//   CENTRE_DE_SANTE plutôt qu'un rattachement arbitraire à Hôpital ou
//   Clinique.
// - RE = Cabinets de kinésithérapie/rééducation (vérifié : "CABINET DE
//   KINESITHERAPIE ...") — catégorie dédiée CABINET_KINESITHERAPIE (pas
//   listée telle quelle dans le cahier, mais distincte du cabinet médical
//   générique).
export function transformCategoriePrestataire(source: string): CategoriePrestataire {
  const mapping: Record<string, CategoriePrestataire> = {
    PH: CategoriePrestataire.PHARMACIE,
    OP: CategoriePrestataire.CENTRE_OPTIQUE,
    DE: CategoriePrestataire.CABINET_DENTAIRE,
    LB: CategoriePrestataire.LABORATOIRE,
    LR: CategoriePrestataire.CENTRE_IMAGERIE,
    SB: CategoriePrestataire.CENTRE_DE_SANTE,
    RE: CategoriePrestataire.CABINET_KINESITHERAPIE,
  };
  return mapping[source?.trim().toUpperCase()] ?? CategoriePrestataire.CABINET_MEDICAL;
}
