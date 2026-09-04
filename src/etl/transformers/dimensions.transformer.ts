import { TypeCanal } from '../../entities/canal.entity';
import { StatutSouscripteur, StatutPolice } from '../../entities/police.entity';
import { TypeAssure } from '../../entities/assure.entity';
import { CategoriePrestataire } from '../../entities/prestataire.entity';
import { CanalSource } from '../extractors/canal.extractor';
import { PoliceSource } from '../extractors/police.extractor';

// Calcule la tranche de prime — logique reprise du cahier §3.4.
export function calculerTranchePrime(primeAnnuelle: number): string {
  if (primeAnnuelle < 5_000_000) return '< 5 M';
  if (primeAnnuelle < 10_000_000) return '5 - 10 M';
  if (primeAnnuelle < 20_000_000) return '10 - 20 M';
  if (primeAnnuelle < 50_000_000) return '20 - 50 M';
  if (primeAnnuelle < 100_000_000) return '50 - 100 M';
  if (primeAnnuelle < 200_000_000) return '100 - 200 M';
  return '> 200 M';
}

// Mapping depuis TYPE_INTERMEDIAIRE.libtypin (ORASSADM). "Courtier" n'est pas
// subdivisé en gestionnaire/non gestionnaire côté source (cf. ambiguïtés) —
// par défaut non gestionnaire, à corriger dès que le critère réel est connu
// (piste : présence d'une commission de gestion sur APPORTEUR_CONTRAT).
const MAPPING_TYPE_CANAL: Record<string, TypeCanal> = {
  'Bureau Direct': TypeCanal.BUREAU_DIRECT,
  Courtier: TypeCanal.COURTIER_NON_GESTIONNAIRE,
  'Bancassurance - MicroFinance': TypeCanal.BANCASSURANCE,
  'Agent Général': TypeCanal.COORDINATION_AGENCES,
};

export function transformCanal(source: CanalSource) {
  return {
    nom: source.libelle,
    typeCanal: MAPPING_TYPE_CANAL[source.type_intermediaire] ?? TypeCanal.BUREAU_DIRECT,
    codeSource: source.code,
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
    primeAnnuelle: Number(source.prime_annuelle),
    dateEffet: source.date_effet,
    dateEcheance: source.date_echeance,
    tranchePrime: calculerTranchePrime(Number(source.prime_annuelle)),
    codeApporteur: source.code_apporteur,
  };
}

export function transformTypeAssure(source: string): TypeAssure {
  return source === 'ENFANT' ? TypeAssure.ENFANT : TypeAssure.ADULTE;
}

// Source = BENEFICIAIRE.codtypbe (codes ORASS bruts : Q, P, C, H, O, J, L,
// M, T, X, W, K, 0). Aucune table de décodage trouvée dans le schéma — le
// mapping ci-dessous est VIDE tant que la signification de ces codes n'est
// pas confirmée ; tout code retombe sur CABINET_MEDICAL par défaut.
// Cf. liste des ambiguïtés transmise.
export function transformCategoriePrestataire(source: string): CategoriePrestataire {
  const mapping: Record<string, CategoriePrestataire> = {};
  return mapping[source?.trim().toUpperCase()] ?? CategoriePrestataire.CABINET_MEDICAL;
}
