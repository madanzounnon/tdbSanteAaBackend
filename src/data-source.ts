import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Canal } from './entities/canal.entity';
import { Apporteur } from './entities/apporteur.entity';
import { Police } from './entities/police.entity';
import { Assure } from './entities/assure.entity';
import { Prestataire } from './entities/prestataire.entity';
import { ActeMedical } from './entities/acte-medical.entity';
import { TypeAvenant } from './entities/type-avenant.entity';
import { FaitPrime } from './entities/fait-prime.entity';
import { FaitSinistre } from './entities/fait-sinistre.entity';
import { FaitFacturePrestataire } from './entities/fait-facture-prestataire.entity';

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
    Apporteur,
    Police,
    Assure,
    Prestataire,
    ActeMedical,
    TypeAvenant,
    FaitPrime,
    FaitSinistre,
    FaitFacturePrestataire,
  ],
  // Adapte le glob à l'environnement d'exécution : ts-node exécute ce
  // fichier en .ts (migrations lues directement en TypeScript), le build
  // compilé exécute dist/data-source.js et doit lire les .js compilés —
  // Node ne sait pas parser du TypeScript brut (implements, etc.).
  migrations: [__filename.endsWith('.ts') ? 'src/migrations/*.ts' : 'dist/migrations/*.js'],
});
