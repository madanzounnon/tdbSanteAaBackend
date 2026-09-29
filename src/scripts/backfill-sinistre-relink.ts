import 'dotenv/config';
import * as fs from 'fs';
import { AppDataSource } from '../data-source';
import { extractSinistres } from '../etl/extractors/sinistre.extractor';
import { loadSinistres } from '../etl/loaders/facts.loader';

// Reconnecte fait_sinistre.assure_id vers les individus réels du roster
// (cf. backfill-roster-assures.ts) : loadSinistres réaffecte l'assure_id de
// chaque ligne à chaque passage, donc rejouer tout l'historique suffit.
// Exercices récents d'abord (les plus consultés dans le TDB), plus anciens
// ensuite. N'écrit pas dans etl_log, n'affecte pas le watermark incrémental.
//
// Le VPN vers la source Oracle s'est coupé plusieurs fois pendant ce job
// (plusieurs heures attendues) : un fichier de progression évite de
// retraiter les exercices déjà relinkés à chaque relance après coupure —
// ce script est fait pour être relancé tel quel (bash `until ... do sleep`)
// jusqu'à ce qu'il affiche TERMINE.
const PROGRESS_FILE = `${__dirname}/.relink-progress.json`;
const EXERCICES = Array.from({ length: 2027 - 2000 + 1 }, (_, i) => 2027 - i);

function chargerProgres(): Set<number> {
  try {
    return new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')));
  } catch {
    return new Set();
  }
}

function marquerFait(fait: Set<number>): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify([...fait]));
}

AppDataSource.initialize()
  .then(async () => {
    const fait = chargerProgres();
    for (const exercice of EXERCICES) {
      if (fait.has(exercice)) {
        console.log(`Exercice ${exercice} : déjà fait (reprise après coupure).`);
        continue;
      }
      const t0 = Date.now();
      const sinistres = await extractSinistres(new Date('2000-01-01'), exercice);
      if (sinistres.length === 0) {
        console.log(`Exercice ${exercice} : aucune ligne.`);
      } else {
        const loaded = await loadSinistres(sinistres);
        console.log(`Exercice ${exercice} : ${sinistres.length} extraites, ${loaded} chargées en ${Math.round((Date.now() - t0) / 1000)}s.`);
      }
      fait.add(exercice);
      marquerFait(fait);
    }
    console.log('TERMINE');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Échec du relink sinistres (relançable, la progression est sauvegardée)', err.message || err);
    process.exit(1);
  });
