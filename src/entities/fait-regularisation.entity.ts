import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Police } from './police.entity';
import { Canal } from './canal.entity';

export enum StatutRegularisation {
  A_REGULARISER = 'a_regulariser',
  REGULARISEE = 'regularisee',
}

@Entity('fait_regularisation')
export class FaitRegularisation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Police, (police) => police.regularisations)
  @JoinColumn({ name: 'police_id' })
  police: Police;

  @ManyToOne(() => Canal, (canal) => canal.regularisations)
  @JoinColumn({ name: 'canal_id' })
  canal: Canal;

  @Column({ type: 'int' })
  exercice: number;

  @Column({ name: 'montant_a_regulariser', type: 'numeric', precision: 14, scale: 2 })
  montantARegulariser: number;

  @Column({ name: 'montant_encaisse', type: 'numeric', precision: 14, scale: 2, default: 0 })
  montantEncaisse: number;

  @Column({ type: 'enum', enum: StatutRegularisation, default: StatutRegularisation.A_REGULARISER })
  statut: StatutRegularisation;

  // Date d'émission de l'avenant correcteur — non renseignée tant que
  // statut = A_REGULARISER.
  @Column({ name: 'date_avenant', type: 'date', nullable: true })
  dateAvenant: Date | null;
}
