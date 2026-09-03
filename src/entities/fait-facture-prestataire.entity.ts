import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Prestataire } from './prestataire.entity';

export enum StatutFacture {
  EN_ATTENTE = 'en_attente',
  EN_RETARD = 'en_retard',
  REGLEE = 'reglee',
}

@Entity('fait_facture_prestataire')
export class FaitFacturePrestataire {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Prestataire, (prestataire) => prestataire.factures)
  @JoinColumn({ name: 'prestataire_id' })
  prestataire: Prestataire;

  @Column({ name: 'date_depot', type: 'date' })
  dateDepot: Date;

  @Column({ name: 'date_reglement', type: 'date', nullable: true })
  dateReglement: Date | null;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  montant: number;

  @Column({ type: 'enum', enum: StatutFacture, default: StatutFacture.EN_ATTENTE })
  statut: StatutFacture;
}
