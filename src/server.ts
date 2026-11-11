import 'dotenv/config';
import { AppDataSource } from './data-source';
import { createApp } from './app';
import { synchroniserCatalogue } from './modules/droits/droits.service';

const PORT = process.env.PORT || 3000;

AppDataSource.initialize()
  .then(async () => {
    console.log('Connexion PostgreSQL établie');
    // Catalogue des privilèges (code → table privilege).
    await synchroniserCatalogue();
    const app = createApp();
    app.listen(PORT, () => {
      console.log(`API TDB Santé démarrée sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Échec de connexion à la base de données', err);
    process.exit(1);
  });
