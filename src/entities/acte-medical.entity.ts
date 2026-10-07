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
  // 9e catégorie hors les 8 du cahier §4.3 : regroupe les codes ORASS dont
  // le libellé source lui-même ne rattache à aucun soin médical précis
  // (AS "Assistance", DF "Divers", PO "Prothèses hors dentaires" — vérifié
  // via FAMILLE_PRESTATION.LIBFAMPR, pas une ambiguïté de mapping de notre
  // côté : la source ne les catégorise pas plus finement non plus).
  AUTRES = 'autres',
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
