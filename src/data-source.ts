import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Canal } from './entities/canal.entity';
import { Police } from './entities/police.entity';
import { Assure } from './entities/assure.entity';
import { Prestataire } from './entities/prestataire.entity';
import { ActeMedical } from './entities/acte-medical.entity';
import { FaitPrime } from './entities/fait-prime.entity';
import { FaitSinistre } from './entities/fait-sinistre.entity';
import { FaitFacturePrestataire } from './entities/fait-facture-prestataire.entity';
import { FaitRegularisation } from './entities/fait-regularisation.entity';

// Point d'entrée unique vers PostgreSQL. synchronize=false : le schéma
// n'évolue que via des migrations explicites, jamais en auto-sync sur
// une base de production métier.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: [
    Canal,
    Police,
    Assure,
    Prestataire,
    ActeMedical,
    FaitPrime,
    FaitSinistre,
    FaitFacturePrestataire,
    FaitRegularisation,
  ],
  migrations: ['src/migrations/*.ts'],
});
