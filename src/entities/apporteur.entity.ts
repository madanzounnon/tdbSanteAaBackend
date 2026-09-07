import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Police } from './police.entity';

export enum TypeApporteur {
  AGREE = 'agree',
  AFFAIRE_DIRECTE = 'affaire_directe',
  LIBRE = 'libre',
}

// Vendeur individuel (commercial) ayant apporté la police — distinct du
// canal (dim_canal = structure/bureau/courtier). Rattachement à la police
// non garanti (~33% de couverture sur le portefeuille Santé) : une police
// gérée directement par un bureau/la compagnie n'a pas toujours de
// commercial nommé.
@Entity('dim_apporteur')
export class Apporteur {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  nom: string;

  @Column({ type: 'enum', enum: TypeApporteur, name: 'type_apporteur' })
  typeApporteur: TypeApporteur;

  @OneToMany(() => Police, (police) => police.apporteur)
  polices: Police[];
}
