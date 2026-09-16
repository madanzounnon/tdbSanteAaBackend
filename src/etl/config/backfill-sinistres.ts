import 'dotenv/config';
import { AppDataSource } from '../../data-source';
import { querySource } from './source-pool';
import { extractSinistres } from '../extractors/sinistre.extractor';
import { loadSinistres } from '../loaders/facts.loader';

// Backfill complet (hors watermark du job mensuel) : à utiliser après un
// vidage de fait_sinistre (ex. migration de schéma), pour ne pas dépendre
// de la date de dernière exécution réussie déjà enregistrée dans etl_log.
//
// Usage :
//   npx ts-node src/etl/config/backfill-sinistres.ts        -> tous les exercices, un par un
//   npx ts-node src/etl/config/backfill-sinistres.ts 2024   -> un seul exercice
//
// Traiter exercice par exercice limite le volume par extraction Oracle
// (~2,2M lignes toutes années confondues) et permet de reprendre sur un
// seul exercice en cas de coupure VPN, sans tout redemander.
async function traiterExercice(exercice: number): Promise<void> {
  console.log(`[Backfill ${exercice}] Extraction depuis Oracle...`);
  const sinistres = await extractSinistres(new Date('2000-01-01'), exercice);
  console.log(`[Backfill ${exercice}] ${sinistres.length} lignes extraites.`);

  const existants: Array<{ numero_reglement_ligne: string }> = await AppDataSource.query(
    'SELECT numero_reglement_ligne FROM fait_sinistre',
  );
  const dejaCharges = new Set(existants.map((r) => r.numero_reglement_ligne));
  const restants = sinistres.filter((s) => !dejaCharges.has(s.numero_reglement_ligne));
  console.log(`[Backfill ${exercice}] ${sinistres.length - restants.length} déjà en base, ${restants.length} restant à charger...`);

  const loaded = await loadSinistres(restants);
  console.log(`[Backfill ${exercice}] ${loaded}/${restants.length} lignes chargées.`);
}

async function main() {
  await AppDataSource.initialize();

  const exerciceArg = process.argv[2] ? Number(process.argv[2]) : undefined;

  if (exerciceArg !== undefined) {
    await traiterExercice(exerciceArg);
  } else {
    const { rows } = await querySource<{ MIN_EX: number; MAX_EX: number }>(`
      SELECT MIN(s.exersini) AS "MIN_EX", MAX(s.exersini) AS "MAX_EX"
      FROM sinistre s
      JOIN categorie c ON c.codecate = s.codecate AND c.codebran = 10
    `);
    const { MIN_EX, MAX_EX } = rows[0];
    console.log(`[Backfill] Exercices ${MIN_EX} à ${MAX_EX} détectés, traitement un par un...`);

    const echecs: number[] = [];
    for (let exercice = MIN_EX; exercice <= MAX_EX; exercice++) {
      try {
        await traiterExercice(exercice);
      } catch (err) {
        console.error(`[Backfill ${exercice}] Échec, passage à l'exercice suivant :`, err);
        echecs.push(exercice);
      }
    }

    if (echecs.length > 0) {
      console.warn(`[Backfill] Exercices en échec à relancer individuellement : ${echecs.join(', ')}`);
    } else {
      console.log('[Backfill] Tous les exercices traités avec succès.');
    }
  }

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('[Backfill] Échec :', err);
  process.exitCode = 1;
});
