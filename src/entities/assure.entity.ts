import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Police } from './police.entity';
import { FaitSinistre } from './fait-sinistre.entity';

export enum TypeAssure {
  ADULTE = 'adulte',
  ENFANT = 'enfant',
}

@Entity('dim_assure')
export class Assure {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TypeAssure, name: 'type_assure' })
  typeAssure: TypeAssure;

  @Column({ name: 'prime_annuelle', type: 'numeric', precision: 12, scale: 2 })
  primeAnnuelle: number;

  @ManyToOne(() => Police, (police) => police.assures)
  @JoinColumn({ name: 'police_id' })
  police: Police;

  @OneToMany(() => FaitSinistre, (sinistre) => sinistre.assure)
  sinistres: FaitSinistre[];
}
