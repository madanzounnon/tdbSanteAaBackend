import 'dotenv/config';
import { querySource } from './source-pool';

async function main() {
  const { rows } = await querySource<{ NOW: Date }>('SELECT SYSDATE AS "NOW" FROM dual');
  console.log('Connexion Oracle OK, heure serveur :', rows[0]);
}

main().catch((err) => {
  console.error('Connexion Oracle échouée :', err);
  process.exitCode = 1;
});
