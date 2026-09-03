import { AppDataSource } from '../../data-source';
import { Police } from '../../entities/police.entity';

export class ChiffreAffairesService {
  async getKpis(exercice: number) {
    const [result] = await AppDataSource.query(
      `SELECT
         SUM(montant_emis) AS ca_ytd,
         SUM(montant_encaisse) AS ca_encaisse_ytd,
         ROUND(SUM(montant_encaisse) / NULLIF(SUM(montant_emis), 0) * 100, 1) AS taux_recouvrement,
         COUNT(DISTINCT police_id) AS nombre_polices
       FROM fait_prime WHERE exercice = $1`,
      [exercice],
    );
    return result;
  }

  async getParCanal(exercice: number) {
    return AppDataSource.query(
      `SELECT
         c.nom AS canal,
         c.type_canal,
         SUM(fp.montant_emis) AS ca_canal,
         ROUND(SUM(fp.montant_emis) * 100.0 / SUM(SUM(fp.montant_emis)) OVER (), 1) AS part_marche_pct
       FROM fait_prime fp
       JOIN dim_police p ON p.id = fp.police_id
       JOIN dim_canal c ON c.id = p.canal_id
       WHERE fp.exercice = $1
       GROUP BY c.nom, c.type_canal
       ORDER BY ca_canal DESC`,
      [exercice],
    );
  }

  async getRepartitionParTranche(exercice: number) {
    const repo = AppDataSource.getRepository(Police);
    return repo
      .createQueryBuilder('police')
      .select('police.tranchePrime', 'tranche')
      .addSelect('COUNT(*)', 'nombre_polices')
      .addSelect('SUM(police.primeAnnuelle)', 'primes_cumulees')
      .where('EXTRACT(YEAR FROM police.dateEffet) = :exercice', { exercice })
      .groupBy('police.tranchePrime')
      .getRawMany();
  }
}
