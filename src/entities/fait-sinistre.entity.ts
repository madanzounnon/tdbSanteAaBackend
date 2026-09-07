import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Police } from './police.entity';
import { Assure } from './assure.entity';
import { ActeMedical } from './acte-medical.entity';
import { Prestataire } from './prestataire.entity';

@Entity('fait_sinistre')
@Index(['exercice', 'mois'])
export class FaitSinistre {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Police, (police) => police.sinistres)
  @JoinColumn({ name: 'police_id' })
  police: Police;

  @ManyToOne(() => Assure, (assure) => assure.sinistres)
  @JoinColumn({ name: 'assure_id' })
  assure: Assure;

  @ManyToOne(() => ActeMedical, (acte) => acte.sinistres)
  @JoinColumn({ name: 'acte_medical_id' })
  acteMedical: ActeMedical;

  // Nullable : le rattachement BENEFICIAIRE (codnatbe='P') n'est pas garanti
  // sur 100% des lignes source.
  @ManyToOne(() => Prestataire, (prestataire) => prestataire.sinistres, { nullable: true })
  @JoinColumn({ name: 'prestataire_id' })
  prestataire: Prestataire | null;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'int' })
  exercice: number;

  @Column({ type: 'int' })
  mois: number;

  @Column({ name: 'montant_paye', type: 'numeric', precision: 14, scale: 2 })
  montantPaye: number;
}
