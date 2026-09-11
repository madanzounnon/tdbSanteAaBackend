import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { Canal } from './canal.entity';
import { Apporteur } from './apporteur.entity';
import { Assure } from './assure.entity';
import { FaitPrime } from './fait-prime.entity';
import { FaitSinistre } from './fait-sinistre.entity';

export enum StatutSouscripteur {
  ETATIQUE = 'etatique',
  NON_ETATIQUE = 'non_etatique',
}

export enum StatutPolice {
  ACTIVE = 'active',
  ECHUE = 'echue',
  RESILIEE = 'resiliee',
  CLOTUREE = 'cloturee',
}

// Pas de champ prime/tranche stocké ici : la prime d'une police n'a de sens
// que rapportée à une période, elle se calcule via SUM(fait_prime.montant_emis)
// filtré sur l'exercice voulu — jamais une valeur figée au chargement.
@Entity('dim_police')
export class Police {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'numero_police', length: 50, unique: true })
  numeroPolice: string;

  @Column({ length: 150 })
  souscripteur: string;

  @Column({ type: 'enum', enum: StatutSouscripteur, name: 'statut_souscripteur' })
  statutSouscripteur: StatutSouscripteur;

  @Column({ type: 'enum', enum: StatutPolice, name: 'statut_police', default: StatutPolice.ACTIVE })
  statutPolice: StatutPolice;

  @Column({ name: 'date_effet', type: 'date' })
  dateEffet: Date;

  @Column({ name: 'date_echeance', type: 'date' })
  dateEcheance: Date;

  // Clôture = échéance + 3 mois (cf. guide des seuils §6.1) : fige le S/P
  // global de l'exercice et déclenche l'avenant de régularisation.
  @Column({ name: 'date_cloture', type: 'date', nullable: true })
  dateCloture: Date | null;

  @ManyToOne(() => Canal, (canal) => canal.polices)
  @JoinColumn({ name: 'canal_id' })
  canal: Canal;

  // Commercial individuel ayant vendu la police — nullable, cf. Apporteur.
  @ManyToOne(() => Apporteur, (apporteur) => apporteur.polices, { nullable: true })
  @JoinColumn({ name: 'apporteur_id' })
  apporteur: Apporteur | null;

  @OneToMany(() => Assure, (assure) => assure.police)
  assures: Assure[];

  @OneToMany(() => FaitPrime, (prime) => prime.police)
  primes: FaitPrime[];

  @OneToMany(() => FaitSinistre, (sinistre) => sinistre.police)
  sinistres: FaitSinistre[];
}
