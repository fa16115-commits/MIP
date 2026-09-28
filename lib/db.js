import pg from 'pg';
let pool;
let local;
export function useTestDatabase(database) {
  if(process.env.NODE_ENV !== 'test') throw new Error('Test database injection disabled');
  local=database;
}
export async function database() {
  if(local) return local;
  if(!process.env.DATABASE_URL) throw Object.assign(new Error('Database is not configured'),{status:503});
  pool ??= new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:10000});
  return pool;
}
export async function query(sql,params=[]) {return (await database()).query(sql,params);}
export async function transaction(fn) {
  const db=await database();
  if(local) return db.transaction(fn);
  const client=await db.connect();
  try {await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result;}
  catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
}
