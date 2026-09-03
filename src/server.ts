import 'dotenv/config';
import { AppDataSource } from './data-source';
import { createApp } from './app';

const PORT = process.env.PORT || 3000;

AppDataSource.initialize()
  .then(() => {
    console.log('Connexion PostgreSQL établie');
    const app = createApp();
    app.listen(PORT, () => {
      console.log(`API TDB Santé démarrée sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Échec de connexion à la base de données', err);
    process.exit(1);
  });
