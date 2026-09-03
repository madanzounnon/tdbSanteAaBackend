import { AppDataSource } from '../../data-source';

export interface RegularisationSource {
  numero_police: string;
  canal_id: string;
  exercice: number;
  montant_a_regulariser: number;
}

// La régularisation n'existe pas comme table source dans ORASSADM (aucune
// table "régularisation" trouvée) : c'est une règle de gestion propre au
// tableau de bord, calculée ICI à partir de notre propre entrepôt
// (dim_police + fait_prime + fait_sinistre), pas extraite d'Oracle.
//
// Formule reprise du cahier §6.1 : Montant à Régulariser = S - P + (P x
// taux de frais de gestion), pour les polices échues/clôturées en perte
// (S/P > 75%). Taux de gestion fixé au milieu de la fourchette 20-25% du
// cahier — à ajuster si la DG communique un taux exact par catégorie.
//
// Recalcule l'ensemble du portefeuille échu/clôturé à chaque exécution
// (idempotent via l'upsert police+exercice du loader) : `since` n'est pas
// utilisé comme filtre, faute de colonne de modification fiable sur un
// résultat dérivé.
const TAUX_FRAIS_GESTION = 0.225;

export async function extractRegularisations(_since: Date): Promise<RegularisationSource[]> {
  const rows: Array<{
    numero_police: string;
    canal_id: string;
    exercice: number;
    prime_emise: string;
    sinistres_payes: string;
  }> = await AppDataSource.query(`
    SELECT
      p.numero_police,
      p.canal_id,
      fp.exercice,
      SUM(fp.montant_emis) AS prime_emise,
      COALESCE(SUM(fs.montant_paye), 0) AS sinistres_payes
    FROM fait_prime fp
    JOIN dim_police p ON p.id = fp.police_id
    LEFT JOIN fait_sinistre fs ON fs.police_id = fp.police_id AND fs.exercice = fp.exercice
    WHERE p.statut_police IN ('echue', 'cloturee') AND p.canal_id IS NOT NULL
    GROUP BY p.numero_police, p.canal_id, fp.exercice
    HAVING COALESCE(SUM(fs.montant_paye), 0) / NULLIF(SUM(fp.montant_emis), 0) > 0.75
  `);

  return rows.map((r) => {
    const primeEmise = Number(r.prime_emise);
    const sinistresPayes = Number(r.sinistres_payes);
    return {
      numero_police: r.numero_police,
      canal_id: r.canal_id,
      exercice: r.exercice,
      montant_a_regulariser: sinistresPayes - primeEmise + primeEmise * TAUX_FRAIS_GESTION,
    };
  });
}
