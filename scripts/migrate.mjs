import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {query,transaction} from '../lib/db.js';
export async function migrate(){const exists=(await query("SELECT to_regclass('public.schema_versions') found")).rows[0].found;if(exists)return;const sql=await fs.readFile(new URL('../db/001-initial.sql',import.meta.url),'utf8');await transaction(db=>db.exec?db.exec(sql):db.query(sql));}
if(process.argv[1]===fileURLToPath(import.meta.url)){await migrate();console.log('Migrations complete');process.exit(0);}
