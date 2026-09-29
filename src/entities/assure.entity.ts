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

  // Identifiant naturel de la personne physique (source : coderisq-codememb,
  // cf. sinistre.extractor.ts). Nullable : les lignes créées avant l'ajout
  // de l'identité individuelle (une par police × type, sans matricule)
  // restent en base jusqu'au nettoyage post-backfill, cf. migration
  // 1700000000009.
  @Column({ type: 'varchar', length: 20, nullable: true })
  matricule: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  nom: string | null;

  @Column({ name: 'date_naissance', type: 'date', nullable: true })
  dateNaissance: Date | null;

  // 'M' / 'F' tel que fourni par la source (RISQUE.sexerisq / RISQUE_FAMILLE.sexememb).
  @Column({ type: 'varchar', length: 1, nullable: true })
  sexe: string | null;

  // true = l'assuré est le salarié lui-même (RISQUE, SINISTRE.codememb IS
  // NULL) ; false = un ayant droit (conjoint/enfant, RISQUE_FAMILLE). Distinct
  // de type_assure : un ayant droit peut être un conjoint adulte, donc
  // "principal" ≠ "adulte".
  @Column({ name: 'est_assure_principal', type: 'boolean', default: true })
  estAssurePrincipal: boolean;

  // Code brut source (RISQUE_FAMILLE.lienpare), ex. 'E' = enfant (seul code
  // confirmé métier à ce jour, cf. transformTypeAssure). Stocké tel quel
  // (pas de table de correspondance inventée pour les autres codes) : NULL
  // pour l'assuré principal (RISQUE, pas de lienpare en source).
  @Column({ name: 'lien_parente', type: 'varchar', length: 5, nullable: true })
  lienParente: string | null;

  // Date d'entrée réelle dans la couverture (source : RISQUE_FAMILLE.dateentr,
  // 96,6% renseigné). N'existe QUE pour les ayants droit — RISQUE (l'assuré
  // principal) n'a aucun champ équivalent en source (table partagée
  // multi-branches, seulement date de naissance/permis de conduire) : reste
  // donc NULL pour un principal, ce n'est pas un oubli d'extraction.
  @Column({ name: 'date_entree', type: 'date', nullable: true })
  dateEntree: Date | null;

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
