import {createSign} from 'node:crypto';
import {transaction} from './db.js';

// Optional reporting mirror. PostgreSQL remains authoritative. One worker holds
// the advisory lock; deterministic full-range writes make retries idempotent.
export function mirrorRows(snapshots){
  const assessments=[['Assessment ID','Snapshot ID','Client','Assessment','Date','Frameworks','Approved index','Target index','Approved at']];
  const responses=[['Assessment ID','Snapshot ID','Module','Domain','Criterion ID','Criterion','Weight','Approved score','Target','Confidence','Source','Source location']];
  for(const s of snapshots){const r=s.report;
    assessments.push([r.assessment.id,s.id,r.client.name,r.assessment.title,String(r.assessment.assessment_date).slice(0,10),r.frameworks.map(f=>f.definition.title+' '+f.version).join('; '),r.results.score??'',r.results.target??'',String(s.approved_at)]);
    for(const m of r.results.modules)for(const d of m.domains)for(const c of d.criteria)responses.push([r.assessment.id,s.id,m.title,d.title,c.id,c.title,c.weight,c.score??'',c.target??'',c.confidence??'',c.source?.title??'',c.source?.location??'']);
  }
  return {assessments,responses};
}
async function accessToken(){
  const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'{}');
  if(!credentials.client_email||!credentials.private_key)throw new Error('Google service account is not configured');
  const now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const unsigned=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const jwt=unsigned+'.'+createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key,'base64url');
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw new Error('Google authorization failed');return (await res.json()).access_token;
}
export async function syncSheets(){
  if(!/^[\w-]+$/.test(process.env.SHEET_ID||''))throw new Error('Configure a dedicated reporting SHEET_ID');
  return transaction(async db=>{
    const lock=await db.query('SELECT pg_try_advisory_xact_lock(74281391) acquired');
    if(!lock.rows[0].acquired)return {skipped:true};
    const pending=(await db.query("SELECT id FROM sync_outbox WHERE status<>'Completed' ORDER BY id")).rows;
    if(!pending.length)return {synced:0};
    const token=await accessToken(),base=`https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}`;
    const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('Google Sheets reporting sync failed ('+r.status+')');return r.json();};
    const metadata=await call('?fields=sheets.properties.title');
    const missing=['Assessments','Responses'].filter(title=>!metadata.sheets?.some(s=>s.properties.title===title));
    if(missing.length)await call(':batchUpdate',{requests:missing.map(title=>({addSheet:{properties:{title}}}))});
    const rows=mirrorRows((await db.query('SELECT * FROM report_snapshots ORDER BY approved_at,id')).rows);
    // RAW prevents client-entered strings from becoming spreadsheet formulas.
    await call('/values:batchUpdate',{valueInputOption:'RAW',data:[{range:'Assessments!A1',values:rows.assessments},{range:'Responses!A1',values:rows.responses}]});
    await db.query("UPDATE sync_outbox SET status='Completed',attempts=attempts+1,last_error=null,completed_at=now() WHERE id=ANY($1::uuid[])",[pending.map(p=>p.id)]);
    return {synced:pending.length,assessments:rows.assessments.length-1,responses:rows.responses.length-1};
  });
}
