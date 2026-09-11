import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Police } from './police.entity';
import { TypeAvenant } from './type-avenant.entity';

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

  // Nullable = police d'origine, aucun avenant (équivalent "nouvelle
  // affaire"). Sinon, dim_type_avenant.code = '1' identifie un vrai
  // renouvellement — les autres avenants (incorporation, modification,
  // retrait, ajustement...) restent distingués plutôt que fondus dans un
  // flag binaire.
  @ManyToOne(() => TypeAvenant, (typeAvenant) => typeAvenant.primes, { nullable: true })
  @JoinColumn({ name: 'type_avenant_id' })
  typeAvenant: TypeAvenant | null;

  @Column({ type: 'date' })
  date: Date;

  // Date de souscription de l'avenant (AVENANT.datesous), distincte de
  // `date` (date d'effet de la quittance) — sert notamment à la vue
  // v_regularisation. Nullable : absente pour les quittances sans avenant
  // (nouvelle affaire) et pas toujours renseignée en source.
  @Column({ name: 'date_avenant', type: 'date', nullable: true })
  dateAvenant: Date | null;

  @Column({ type: 'int' })
  exercice: number;

  @Column({ type: 'int' })
  mois: number;

  @Column({ name: 'montant_emis', type: 'numeric', precision: 14, scale: 2 })
  montantEmis: number;

  @Column({ name: 'montant_encaisse', type: 'numeric', precision: 14, scale: 2, default: 0 })
  montantEncaisse: number;

  @Column({ name: 'commission_versee', type: 'numeric', precision: 14, scale: 2, default: 0 })
  commissionVersee: number;
}
