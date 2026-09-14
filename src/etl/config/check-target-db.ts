import 'dotenv/config';
import { AppDataSource } from '../../data-source';

async function main() {
  await AppDataSource.initialize();
  const [row] = await AppDataSource.query('SELECT COUNT(*) AS n FROM fait_sinistre');
  console.log('Lignes actuelles dans fait_sinistre :', row.n);
  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error('Erreur :', err.message ?? err);
  process.exitCode = 1;
});
