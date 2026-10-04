import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {useTestDatabase} from '../lib/db.js';
import {migrate} from './migrate.mjs';
import {seed} from './seed.mjs';
import handler from '../api/index.js';
if(process.env.VERCEL||process.env.NODE_ENV==='production')throw new Error('Local development runner cannot run in production');
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:3100';
await fs.mkdir('.local',{recursive:true});
let credentials;try{credentials=JSON.parse(await fs.readFile('.local/access.json','utf8'));}catch{credentials={email:'admin@local.test',password:randomBytes(18).toString('base64url')};await fs.writeFile('.local/access.json',JSON.stringify(credentials),{mode:0o600});}
const db=new PGlite('.local/postgres');useTestDatabase(db);await migrate();await seed(credentials.email,credentials.password);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.json':'application/json'};
http.createServer(async(req,res)=>{if(req.url.startsWith('/api/'))return handler(req,res);try{const pathname=new URL(req.url,'http://localhost').pathname;const file=pathname.startsWith('/assets/')?path.join('public',pathname):'public/index.html';if(path.relative(path.resolve('public'),path.resolve(file)).startsWith('..')){res.statusCode=404;return res.end();}res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(await fs.readFile(file));}catch{res.statusCode=404;res.end('Not found');}}).listen(3100,'127.0.0.1',()=>console.log('Local PostgreSQL development server: http://localhost:3100. Credentials are in ignored .local/access.json.'));
