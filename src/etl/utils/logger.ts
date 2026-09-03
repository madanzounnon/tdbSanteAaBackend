import { AppDataSource } from '../../data-source';

// Ouvre une ligne etl_log au démarrage d'un job, la referme (succès ou
// échec) à la fin. C'est ce journal que la DG/l'IT consultent en cas
// de doute sur la fraîcheur ou la fiabilité d'un chiffre.
export class EtlLogger {
  private logId?: number;

  async start(jobName: string): Promise<void> {
    const [row] = await AppDataSource.query(
      `INSERT INTO etl_log (job_name, status) VALUES ($1, 'running') RETURNING id`,
      [jobName],
    );
    this.logId = row.id;
    console.log(`[ETL] ${jobName} — démarrage (log #${this.logId})`);
  }

  async success(rowsExtracted: number, rowsLoaded: number): Promise<void> {
    await AppDataSource.query(
      `UPDATE etl_log
       SET status = 'success', finished_at = now(), rows_extracted = $2, rows_loaded = $3
       WHERE id = $1`,
      [this.logId, rowsExtracted, rowsLoaded],
    );
    console.log(`[ETL] log #${this.logId} — succès (${rowsLoaded}/${rowsExtracted} lignes chargées)`);
  }

  async failure(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await AppDataSource.query(
      `UPDATE etl_log
       SET status = 'failed', finished_at = now(), error_message = $2
       WHERE id = $1`,
      [this.logId, message],
    );
    console.error(`[ETL] log #${this.logId} — échec : ${message}`);
  }
}
