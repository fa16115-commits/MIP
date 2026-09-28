import {z} from 'zod';
import {authenticate,login,cookie,originCheck,fail,passwordMatches,passwordHash} from '../lib/auth.js';
import {query,transaction} from '../lib/db.js';
import * as service from '../lib/service.js';
import {pdfReport} from '../lib/report.js';
import {readFile} from '../lib/evidence-storage.js';
const send=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
async function body(req){if(req.body){if(Buffer.byteLength(JSON.stringify(req.body))>3000000)fail(413,'Request too large');return typeof req.body==='string'?JSON.parse(req.body):req.body;}const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3000000)fail(413,'Request too large');parts.push(chunk);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{fail(400,'Invalid JSON');}}
export default async function handler(req,res){res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');try{
  const path=new URL(req.url,'http://localhost').pathname.replace(/\/$/,'');const method=req.method;
  if(path==='/api/health'){return send(res,200,{service:'Maturity Intelligence',configured:!!process.env.DATABASE_URL});}
  if(!['GET','POST','PATCH'].includes(method))fail(405,'Method not allowed');
  const mutating=method!=='GET';if(mutating){originCheck(req);if(!String(req.headers['content-type']||'').startsWith('application/json'))fail(415,'JSON requests required');}
  const b=mutating?await body(req):{};
  if(path==='/api/login'&&method==='POST'){const p=z.object({email:z.email().toLowerCase(),password:z.string().min(1).max(128)}).parse(b);const session=await login(p.email,p.password,String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown'));res.setHeader('Set-Cookie',cookie(session.token));return send(res,200,{ok:true});}
  const user=await authenticate(req);if(!user)fail(401,'Sign in to continue');
  if(mutating&&req.headers['x-csrf-token']!==user.csrf)fail(403,'Session verification failed. Reload and try again.');
  if(path==='/api/logout'&&method==='POST'){await query('DELETE FROM sessions WHERE token_hash=$1',[user.token_hash]);res.setHeader('Set-Cookie',cookie('',true));return send(res,200,{ok:true});}
  if(path==='/api/password'&&method==='POST'){const p=z.object({current:z.string().max(128),password:z.string().min(12).max(128)}).parse(b);const row=(await query('SELECT password_hash FROM users WHERE id=$1',[user.id])).rows[0];if(!await passwordMatches(p.current,row.password_hash))fail(400,'Current password is incorrect');const newHash=await passwordHash(p.password);await transaction(async db=>{await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[newHash,user.id]);await db.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);await service.audit(db,user,'password.changed',user.id,null,{sessionsRevoked:true});});res.setHeader('Set-Cookie',cookie('',true));return send(res,200,{ok:true});}
  if(path==='/api/bootstrap'&&method==='GET')return send(res,200,await service.bootstrap(user));
  if(path==='/api/clients'&&method==='POST')return send(res,201,await service.createClient(user,b));
  if(path==='/api/assessments'&&method==='POST')return send(res,201,await service.createAssessment(user,b));
  if(path==='/api/users')return send(res,200,method==='GET'?await service.users(user):await service.createUser(user,b));
  if(path==='/api/memberships'&&method==='POST')return send(res,200,await service.assignUser(user,b));
  if(path==='/api/knowledge')return send(res,200,method==='GET'?await service.knowledge(user):await service.addKnowledge(user,b));
  if(path==='/api/frameworks'&&method==='POST')return send(res,201,await service.saveFramework(user,b));
  let m;
  if((m=path.match(/^\/api\/compare\/([^/]+)\/([^/]+)$/))&&method==='GET')return send(res,200,await service.compareAssessments(user,m[1],m[2]));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/roadmap\/([^/]+)\/dependencies$/))&&method==='POST')return send(res,200,await service.addDependency(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/clients\/([^/]+)\/modules$/))&&method==='POST')return send(res,200,await service.activateModule(user,m[1],b));
  if((m=path.match(/^\/api\/frameworks\/([^/]+)\/approve$/))&&method==='POST')return send(res,200,await service.approveFramework(user,m[1],b));
  if((m=path.match(/^\/api\/knowledge\/([^/]+)\/verify$/))&&method==='POST')return send(res,200,await service.verifyKnowledge(user,m[1],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)$/))&&method==='GET')return send(res,200,await service.assessmentDetail(user,m[1]));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/responses\/([^/]+)(?:\/(review|target))?$/))&&method==='POST')return send(res,200,await (m[3]==='review'?service.reviewResponse:m[3]==='target'?service.setTarget:service.saveResponse)(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/evidence$/))&&method==='POST')return send(res,201,await service.addEvidence(user,m[1],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/evidence\/([^/]+)\/review$/))&&method==='POST')return send(res,200,await service.reviewEvidence(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/evidence\/([^/]+)\/download$/))&&method==='GET'){const detail=await service.assessmentDetail(user,m[1]);const e=detail.evidence.find(e=>e.id===m[2]);if(!e?.object_key)fail(404,'File not found');if(e.scan_status!=='Clean')fail(409,'File is quarantined pending a recorded malware scan');const file=await readFile(e.object_key);if(!file||file.statusCode!==200)fail(502,'File unavailable');res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition','attachment; filename="evidence"');for await(const chunk of file.stream)res.write(chunk);return res.end();}
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/(findings|recommendations|roadmap|lessons)$/))&&method==='POST')return send(res,201,await service.addRecord(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/(findings|recommendations)\/([^/]+)\/approve$/))&&method==='POST')return send(res,200,await service.approveRecord(user,m[1],m[2],m[3],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/recommendations\/([^/]+)\/assets$/))&&method==='POST')return send(res,200,await service.linkAsset(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/roadmap\/([^/]+)$/))&&method==='POST')return send(res,200,await service.updateRoadmap(user,m[1],m[2],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/propose-recommendations$/))&&method==='POST')return send(res,200,await service.proposeRecommendations(user,m[1]));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/status$/))&&method==='POST')return send(res,200,await service.changeStatus(user,m[1],b));
  if((m=path.match(/^\/api\/assessments\/([^/]+)\/(report|report.pdf)$/))&&method==='GET'){const report=await service.report(user,m[1]);if(m[2]==='report')return send(res,200,report);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','attachment; filename="maturity-assessment.pdf"');return res.end(await pdfReport(report));}
  fail(404,'Route not found');
}catch(e){if(e instanceof z.ZodError)return send(res,400,{error:e.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});if(e.code==='23505')return send(res,409,{error:'This record already exists'});if(e.code==='23503')return send(res,400,{error:'A referenced record is unavailable or belongs to another assessment'});if(!e.status)console.error('Request failed:',e.code||e.name);send(res,e.status||500,{error:e.status?e.message:'The request could not be completed. No partial database changes were saved.'});}}
