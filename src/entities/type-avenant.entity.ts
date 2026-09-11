import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { FaitPrime } from './fait-prime.entity';

// Référentiel ORASS TYPE_AVENANT (code, libellé, nature) — remplace le
// flag binaire type_souscription : un mouvement de prime n'est pas
// seulement "nouvelle affaire" ou "renouvellement", il peut être une
// incorporation, un retrait, une modification, un ajustement de prime,
// etc. `code` = CODTYPAV (ex: '1' = Avenant de renouvellement),
// `nature` = NATUAVEN (R = renouvellement, D = divers, J = ajustement,
// S = suspension, A = annulation, G = régularisation...).
//
// Les avenants de nature 'J' (ajustement/réajustement de prime) alimentent
// la vue v_regularisation (cf. migration) — pas de table dédiée, ce sont
// les mêmes lignes fait_prime, simplement filtrées.
@Entity('dim_type_avenant')
export class TypeAvenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 10, unique: true })
  code: string;

  @Column({ length: 150 })
  libelle: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  nature: string | null;

  @OneToMany(() => FaitPrime, (prime) => prime.typeAvenant)
  primes: FaitPrime[];
}
