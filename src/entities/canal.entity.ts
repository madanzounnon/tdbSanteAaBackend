import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Police } from './police.entity';

export enum TypeCanal {
  COURTIER = 'courtier',
  BUREAU_DIRECT = 'bureau_direct',
  COORDINATION_AGENCES = 'coordination_agences',
  BANCASSURANCE = 'bancassurance',
}

@Entity('dim_canal')
export class Canal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  nom: string;

  @Column({ type: 'enum', enum: TypeCanal, name: 'type_canal' })
  typeCanal: TypeCanal;

  @OneToMany(() => Police, (police) => police.canal)
  polices: Police[];
}
