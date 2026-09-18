import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Objectif de Chiffre d'Affaires fixé par la DG pour un exercice donné
// (cahier §2.1 : "Taux de réalisation = CA YTD / Objectif Annuel × 100").
// Table de saisie manuelle — la DG met à jour cette valeur, elle n'est
// jamais recalculée à partir des faits.
@Entity('objectif_annuel')
export class ObjectifAnnuel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  exercice: number;

  @Column({ name: 'montant_ca_objectif', type: 'numeric', precision: 14, scale: 2 })
  montantCaObjectif: number;
}
