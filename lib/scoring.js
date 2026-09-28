import Decimal from 'decimal.js';
Decimal.set({precision:32,rounding:Decimal.ROUND_HALF_UP});
const D=x=>new Decimal(x);
export const display=x=>x==null?null:D(x).toFixed(2);
export function weighted(items){
  if(!items.length||items.some(x=>x.score==null))return null;
  if(items.some(x=>!D(x.weight).isFinite()||!D(x.weight).gt(0)||!D(x.score).isFinite()||D(x.score).lt(1)||D(x.score).gt(5)))throw new Error('Invalid score or weight');
  return items.reduce((a,x)=>a.plus(D(x.score).times(x.weight)),D(0)).div(items.reduce((a,x)=>a.plus(x.weight),D(0))).toString();
}
export function criterionIndex(criterion,answers){return weighted(criterion.questions.map(q=>({weight:q.weight,score:answers[q.id]??null})));}
export function stage(index,criteria,rules={}) {
  if(index==null||!rules.bands?.length)return {level:null,reason:'Stage thresholds require framework approval',gates:[]};
  let level=rules.bands.filter(b=>D(index).gte(b.minimum)).reduce((a,b)=>Math.max(a,b.level),1);
  const gates=[];
  for(const gate of rules.gates||[]){
    if(gate.status!=='Approved'||!gate.rationale||!gate.source)continue;
    const c=criteria.find(x=>x.id===gate.criterionId);
    if(!c||c.score==null)return {level:null,reason:'Critical criterion is incomplete',gates:[]};
    if(D(c.score).lt(gate.minimum)&&level>gate.cap){level=gate.cap;gates.push({criterionId:gate.criterionId,cap:gate.cap,rationale:gate.rationale,source:gate.source});}
  }
  return {level,reason:gates.length?'Limited by approved critical criteria':'Weighted index thresholds',gates};
}
export function calculate(frameworks,responses,approvedOnly=false){
  const map=new Map(responses.map(r=>[r.criterion_id,r]));
  const modules=frameworks.map(f=>{
    const def=f.definition;
    const domains=def.domains.map(d=>{
      const criteria=d.criteria.map(c=>{const r=map.get(c.id);let score=null;if(r){score=approvedOnly?(r.review_status==='Approved'?r.reviewer_score:null):(r.reviewer_score??r.consultant_score);}return {id:c.id,title:c.title,weight:c.weight,score:score==null?null:String(score),target:r?.target==null?null:String(r.target),confidence:r?.confidence??null,reviewStatus:r?.review_status??'Pending',source:c.source};});
      const score=weighted(criteria),target=weighted(criteria.map(c=>({score:c.target,weight:c.weight})));
      return {id:d.id,title:d.title,weight:d.weight,score,target,gap:score!=null&&target!=null?D(target).minus(score).toString():null,criteria,stage:stage(score,criteria,d.stageRules)};
    });
    const score=weighted(domains),target=weighted(domains.map(d=>({score:d.target,weight:d.weight})));
    return {id:f.id,moduleId:f.module_id,title:def.title,weight:f.weight??1,score,target,domains,stage:stage(score,domains.flatMap(d=>d.criteria),def.stageRules),gap:score!=null&&target!=null?D(target).minus(score).toString():null};
  });
  const score=weighted(modules),target=weighted(modules.map(m=>({score:m.target,weight:m.weight})));
  return {score,target,gap:score!=null&&target!=null?D(target).minus(score).toString():null,modules,complete:score!=null,stage:{level:null,reason:'Overall stage thresholds and gates require approval'}};
}
