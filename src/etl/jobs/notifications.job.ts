import { AppDataSource } from '../../data-source';
import { AnalyseEnCours, lancerAnalyse } from '../../modules/notifications/notifications.service';

// Analyse des alertes (anti-blanchiment, règlements de sinistres) et envoi
// des emails / SMS. Lancée après le chargement des opérations LBC
// (planificateur et chargement à la demande) ; exécutable seule :
//   npm run notifications:lancer
export async function runNotificationsJob(): Promise<void> {
  try {
    const resultat = await lancerAnalyse('AUTO');
    console.log('[NOTIFICATIONS] Analyse terminée', JSON.stringify(resultat));
  } catch (err) {
    if (err instanceof AnalyseEnCours) {
      console.warn('[NOTIFICATIONS]', err.message);
      return;
    }
    throw err;
  }
}

if (require.main === module) {
  AppDataSource.initialize()
    .then(runNotificationsJob)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[NOTIFICATIONS] Échec', err);
      process.exit(1);
    });
}
