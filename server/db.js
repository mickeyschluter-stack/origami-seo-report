import sql from 'mssql';

const config = {
  server: process.env.AZURE_SQL_SERVER,
  port: parseInt(process.env.AZURE_SQL_PORT || '1433', 10),
  database: process.env.AZURE_SQL_DATABASE || 'DA_Improvado',
  user: process.env.AZURE_SQL_USER,
  password: process.env.AZURE_SQL_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 300000,
  connectionTimeout: 30000,
};

let pool = null;
let daDataPool = null;

export async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

export async function getDaDataPool() {
  if (!daDataPool) {
    daDataPool = await new sql.ConnectionPool({
      ...config,
      database: process.env.AZURE_SQL_DATABASE_DADATA || 'DA_Data',
    }).connect();
  }
  return daDataPool;
}

export { sql };
