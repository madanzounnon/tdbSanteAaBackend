import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { FaitFacturePrestataire } from './fait-facture-prestataire.entity';
import { FaitSinistre } from './fait-sinistre.entity';

export enum CategoriePrestataire {
  HOPITAL_PUBLIC = 'hopital_public',
  CLINIQUE_PRIVEE = 'clinique_privee',
  PHARMACIE = 'pharmacie',
  LABORATOIRE = 'laboratoire',
  CABINET_MEDICAL = 'cabinet_medical',
  CENTRE_OPTIQUE = 'centre_optique',
  CABINET_DENTAIRE = 'cabinet_dentaire',
  MATERNITE = 'maternite',
  CENTRE_IMAGERIE = 'centre_imagerie',
  CENTRE_DE_SANTE = 'centre_de_sante',
  CABINET_KINESITHERAPIE = 'cabinet_kinesitherapie',
}

@Entity('dim_prestataire')
export class Prestataire {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  nom: string;

  @Column({ type: 'enum', enum: CategoriePrestataire })
  categorie: CategoriePrestataire;

  @Column({ default: true })
  conventionne: boolean;

  @OneToMany(() => FaitFacturePrestataire, (facture) => facture.prestataire)
  factures: FaitFacturePrestataire[];

  @OneToMany(() => FaitSinistre, (sinistre) => sinistre.prestataire)
  sinistres: FaitSinistre[];
}
