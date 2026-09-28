import crypto from 'node:crypto';
import {promisify} from 'node:util';
import {query} from './db.js';
const scrypt=promisify(crypto.scrypt);
export const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export async function passwordHash(password){const salt=crypto.randomBytes(16).toString('hex');return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
export async function passwordMatches(password,stored){const [salt,value]=stored.split(':');const actual=await scrypt(password,salt,64);const expected=Buffer.from(value,'hex');return expected.length===actual.length&&crypto.timingSafeEqual(actual,expected);}
const cookieName=()=>process.env.NODE_ENV==='test'?'mi_local_session':'__Host-mi_session';
export function cookie(token,clear=false){return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; ${process.env.NODE_ENV==='test'?'':'Secure; '}Max-Age=${clear?0:43200}`;}
export async function authenticate(req){
  const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName()+'='))?.split('=')[1];
  if(!token)return null;
  const {rows}=await query('SELECT u.id,u.email,u.name,u.is_admin,s.csrf,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true',[hash(token)]);
  return rows[0]||null;
}
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function originCheck(req){const configured=process.env.APP_ORIGIN;if(!configured)fail(503,'Application origin is not configured');if(req.headers.origin!==configured)fail(403,'Request origin is not allowed');}
export async function login(email,password,ip){
  const key=hash(email+'|'+ip), accountKey=hash(email);
  for(const k of [key,accountKey]){const {rows}=await query(`INSERT INTO login_limits(key,attempts,expires_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.expires_at<now() THEN 1 ELSE login_limits.attempts+1 END, expires_at=CASE WHEN login_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE login_limits.expires_at END RETURNING attempts`,[k]);if(rows[0].attempts>20)fail(429,'Too many sign-in attempts. Try again later.');}
  const {rows}=await query('SELECT * FROM users WHERE email=$1 AND active=true',[email]);
  const dummy='00000000000000000000000000000000:'+('00'.repeat(64));
  const valid=await passwordMatches(password,rows[0]?.password_hash||dummy);
  if(!rows[0]||!valid)fail(401,'Email or password is incorrect');
  const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
  await query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",[hash(token),rows[0].id,csrf]);
  return {token,csrf};
}
export async function clientAccess(db,user,clientId,roles=[]){
  if(user.is_admin)return 'admin';
  const {rows}=await db.query('SELECT role FROM memberships WHERE client_id=$1 AND user_id=$2',[clientId,user.id]);
  if(!rows[0]||(roles.length&&!roles.includes(rows[0].role)))fail(403,'You do not have access to this client or action');
  return rows[0].role;
}
