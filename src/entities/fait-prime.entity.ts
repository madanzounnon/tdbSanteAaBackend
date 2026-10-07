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

  // Fin de la période couverte par la quittance (QUITTANCE.dateeche) :
  // [date, date_echeance] sert à répartir la prime entre exercices au
  // prorata des jours couverts (mv_sp_portefeuille). Nullable : quittances
  // chargées avant l'ajout de la colonne et non encore reprises.
  @Column({ name: 'date_echeance', type: 'date', nullable: true })
  dateEcheance: Date | null;

  @Column({ type: 'int' })
  exercice: number;

  @Column({ type: 'int' })
  mois: number;

  @Column({ name: 'montant_emis', type: 'numeric', precision: 14, scale: 2 })
  montantEmis: number;

  // Décomposition de montant_emis (source QUITTANCE.primtota) : sur les cas
  // standards, primtota = prime_nette + taxe_prime + accessoire + taxe_accessoire
  // (vérifié sur données réelles) — non garanti sur les ristournes/annulations,
  // dont le signe de chaque composante n'est pas toujours cohérent avec le
  // total (cf. note sur montant_emis dans prime.extractor.ts).
  @Column({ name: 'prime_nette', type: 'numeric', precision: 14, scale: 2, default: 0 })
  primeNette: number;

  @Column({ name: 'accessoire', type: 'numeric', precision: 14, scale: 2, default: 0 })
  accessoire: number;

  @Column({ name: 'taxe_prime', type: 'numeric', precision: 14, scale: 2, default: 0 })
  taxePrime: number;

  // Taxe sur la commission versée (QUITTANCE.taxecomm) — distincte de
  // taxe_prime. Seules ces deux taxes sont réellement alimentées pour la
  // branche Santé (codebran = 10) ; les autres colonnes de taxe/timbre
  // source (taxeacce, timbdime, timbgrad, taxequi2-5, taxecopo, taxetidi,
  // taxetigr) sont systématiquement à 0 et n'ont pas été reprises.
  @Column({ name: 'taxe_commission', type: 'numeric', precision: 14, scale: 2, default: 0 })
  taxeCommission: number;

  @Column({ name: 'montant_encaisse', type: 'numeric', precision: 14, scale: 2, default: 0 })
  montantEncaisse: number;

  @Column({ name: 'commission_versee', type: 'numeric', precision: 14, scale: 2, default: 0 })
  commissionVersee: number;
}
