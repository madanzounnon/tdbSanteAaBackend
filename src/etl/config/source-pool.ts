import oracledb, { Pool } from 'oracledb';

// Connexion vers le système opérationnel source — Oracle (schéma ORASSADM,
// base MERCURE). Mode "thick" activé par défaut : le mode "thin" natif de
// oracledb ne supporte que les serveurs Oracle 12.1+, or MERCURE tourne en
// 11g. Le poste doit donc avoir un Oracle Client installé (ex. OraDb11g_home1,
// déjà utilisé par Toad) ; son répertoire lib peut être précisé via
// ORACLE_CLIENT_LIB_DIR si non détecté automatiquement (PATH / registre).
try {
  oracledb.initOracleClient(
    process.env.ORACLE_CLIENT_LIB_DIR ? { libDir: process.env.ORACLE_CLIENT_LIB_DIR } : undefined,
  );
} catch {
  // déjà initialisé (ex. rechargement à chaud en dev)
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const connectString =
  process.env.SRC_DB_CONNECT_STRING ||
  `${process.env.SRC_DB_HOST}:${process.env.SRC_DB_PORT || 1521}/${process.env.SRC_DB_NAME}`;

let poolPromise: Promise<Pool> | null = null;

function getPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = oracledb.createPool({
      user: process.env.SRC_DB_USER,
      password: process.env.SRC_DB_PASSWORD,
      connectString,
      poolMin: 0,
      poolMax: 5,
    });
  }
  return poolPromise;
}

// Compat minimaliste avec l'API `{ rows }` utilisée par les extracteurs
// (calquée sur `pg`). Binds positionnels au format Oracle (`:1`, `:2`, ...).
export async function querySource<T = unknown>(sql: string, binds: unknown[] = []): Promise<{ rows: T[] }> {
  const pool = await getPool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute<T>(sql, binds as oracledb.BindParameters);
    return { rows: result.rows ?? [] };
  } finally {
    await connection.close();
  }
}
