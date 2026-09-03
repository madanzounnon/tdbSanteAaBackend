import { NatureActe } from '../../entities/acte-medical.entity';
import { StatutFacture } from '../../entities/fait-facture-prestataire.entity';
import { TypeSouscription } from '../../entities/fait-prime.entity';

export function transformTypeSouscription(source: string): TypeSouscription {
  return source === 'RENOUVELLEMENT' ? TypeSouscription.RENOUVELLEMENT : TypeSouscription.NOUVELLE_AFFAIRE;
}

// Depuis FAMILLE_PRESTATION.codfampr (18 familles ORASS) vers les 8
// catégories du cahier d'indicateurs. Correspondances évidentes seulement ;
// AM/AMI/AS/DF/EV/EVSN/PO/RE/TR n'ont pas d'équivalent clair et tombent en
// Consultation par défaut — cf. liste des ambiguïtés transmise.
export function transformNatureActe(source: string): NatureActe {
  const mapping: Record<string, NatureActe> = {
    HO: NatureActe.HOSPITALISATION,
    C: NatureActe.CONSULTATION,
    V: NatureActe.CONSULTATION,
    PH: NatureActe.PHARMACIE,
    OP: NatureActe.OPTIQUE,
    D: NatureActe.DENTAIRE,
    MA: NatureActe.MATERNITE,
    B: NatureActe.BIOLOGIE,
    Z: NatureActe.IMAGERIE,
  };
  return mapping[source.trim().toUpperCase()] ?? NatureActe.CONSULTATION;
}

// Le statut de facture (attente/retard/réglée) est recalculé côté ETL
// plutôt que repris tel quel de la source, pour appliquer uniformément
// le seuil de 45 jours du cahier (§5.1), indépendamment de la façon
// dont chaque prestataire ou agence l'a saisi côté opérationnel.
export function calculerStatutFacture(dateDepot: Date, dateReglement: Date | null): StatutFacture {
  if (dateReglement) return StatutFacture.REGLEE;
  const joursEcoules = Math.floor((Date.now() - new Date(dateDepot).getTime()) / (1000 * 60 * 60 * 24));
  return joursEcoules > 45 ? StatutFacture.EN_RETARD : StatutFacture.EN_ATTENTE;
}

export function extraireExercice(date: Date): number {
  return new Date(date).getFullYear();
}

export function extraireMois(date: Date): number {
  return new Date(date).getMonth() + 1;
}
