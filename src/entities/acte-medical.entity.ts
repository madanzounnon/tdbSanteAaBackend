import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { FaitSinistre } from './fait-sinistre.entity';

export enum NatureActe {
  HOSPITALISATION = 'hospitalisation',
  CONSULTATION = 'consultation',
  PHARMACIE = 'pharmacie',
  OPTIQUE = 'optique',
  DENTAIRE = 'dentaire',
  MATERNITE = 'maternite',
  BIOLOGIE = 'biologie',
  IMAGERIE = 'imagerie',
}

@Entity('dim_acte_medical')
export class ActeMedical {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NatureActe })
  nature: NatureActe;

  @OneToMany(() => FaitSinistre, (sinistre) => sinistre.acteMedical)
  sinistres: FaitSinistre[];
}
