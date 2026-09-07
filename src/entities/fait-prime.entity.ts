import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Police } from './police.entity';

export enum TypeSouscription {
  NOUVELLE_AFFAIRE = 'nouvelle_affaire',
  RENOUVELLEMENT = 'renouvellement',
}

// Granularité = une ligne par quittance (numero_quittance = clé naturelle
// source, codeinte-numequit). PAS d'agrégat par police/mois : une police
// peut avoir plusieurs quittances le même mois (incorporation +
// modification, etc.) — chacune reste distincte pour que la somme sur une
// période donne la vraie prime nette de la police.
@Entity('fait_prime')
@Index(['exercice', 'mois'])
export class FaitPrime {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_quittance', length: 50, unique: true })
  numeroQuittance: string;

  @ManyToOne(() => Police, (police) => police.primes)
  @JoinColumn({ name: 'police_id' })
  police: Police;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'int' })
  exercice: number;

  @Column({ type: 'int' })
  mois: number;

  @Column({ type: 'enum', enum: TypeSouscription, name: 'type_souscription' })
  typeSouscription: TypeSouscription;

  @Column({ name: 'montant_emis', type: 'numeric', precision: 14, scale: 2 })
  montantEmis: number;

  @Column({ name: 'montant_encaisse', type: 'numeric', precision: 14, scale: 2, default: 0 })
  montantEncaisse: number;

  @Column({ name: 'commission_versee', type: 'numeric', precision: 14, scale: 2, default: 0 })
  commissionVersee: number;
}
