import { AppDataSource } from '../../data-source';

// Renvoie la date de la dernière extraction réussie d'un job, pour ne
// relire côté source que les enregistrements nouveaux/modifiés depuis
// (extraction incrémentale, indispensable dès que les volumes grossissent).
export async function getWatermark(jobName: string): Promise<Date> {
  const [row] = await AppDataSource.query(
    `SELECT started_at FROM etl_log
     WHERE job_name = $1 AND status = 'success'
     ORDER BY started_at DESC LIMIT 1`,
    [jobName],
  );
  // Par défaut, si aucun run précédent : on repart de loin (première charge complète).
  return row ? row.started_at : new Date('2000-01-01');
}
