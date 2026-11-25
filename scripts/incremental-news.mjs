import {createHash} from "node:crypto";
const normal=s=>String(s??"").normalize("NFKC").replace(/\s+/g," ").trim();
const hash=s=>createHash("sha256").update(s).digest("hex");
const body=a=>normal(a.cleanText||a.fullText||"").slice(0,10000);
const snippet=a=>normal(a.description).slice(0,10000);
export function articleIdentity(a){
 let url=String(a.url||"").trim();
 try{const u=new URL(url);for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid|gclid|igshid|mc_)/i.test(k))u.searchParams.delete(k);u.hash="";u.searchParams.sort();url=u.toString().replace(/^https?:\/\//i,"").replace(/\/$/,"");}catch{}
 return url||normal(a.title).toLowerCase()+"|"+normal(a.source).toLowerCase();
}
export const fingerprint=a=>hash(JSON.stringify([normal(a.title),body(a)||snippet(a)]));
export const cachedRejection=(a,rejected={})=>rejected[hash(articleIdentity(a))]?.fingerprint===fingerprint(a);
export const reusable=a=>Boolean(a&&!a.translationFailed&&normal(a.titleKo)&&normal(a.summaryKo)&&!/[\u0600-\u06ff]/.test(a.titleKo+" "+a.summaryKo));
export function unchanged(old,a){
 if(!old||normal(old.title)!==normal(a.title))return false;
 const x=body(old),y=body(a);
 if(x&&!y)return true;
 if(x&&y)return x===y||(y.length<x.length&&x.startsWith(y));
 if(!x&&y)return false;
 return snippet(old)===snippet(a)||!snippet(a);
}
export async function reconcileArticles({previous,candidates,rejected={},enrich,requiresAi,now,concurrency=3}){
 const saved=new Map(previous.map(a=>[articleIdentity(a),a]));
 const rejects=Object.assign(Object.create(null),rejected);
 const unique=new Map();for(const a of candidates){const k=articleIdentity(a);if(!unique.has(k))unique.set(k,a);}
 const stats={reused:0,aiProcessed:0,added:0,changed:0,excluded:0,failed:0,retained:0};
 const tasks=[...unique];let i=0;
 async function worker(){while(i<tasks.length){
  const [k,a]=tasks[i++],old=saved.get(k),rk=hash(k),fp=fingerprint(a);
  if(old&&unchanged(old,a)&&(!requiresAi||reusable(old))){stats.reused++;continue;}
  if(requiresAi&&!old&&rejects[rk]?.fingerprint===fp){stats.excluded++;continue;}
  if(!requiresAi){saved.set(k,{...old,...a,firstSeenAt:old?.firstSeenAt||old?.date_found||old?.publishedAt||now});stats[old?"changed":"added"]++;continue;}
  stats.aiProcessed++;let result;
  try{result=await enrich(a);}catch(e){console.warn("[incremental] "+String(e.message||e));}
  if(!reusable(result)){stats.failed++;continue;}
  if(result.reportUsefulness==="exclude"&&a.category==="overseas"){rejects[rk]={fingerprint:fp,date:a.publishedAt||now};saved.delete(k);stats.excluded++;continue;}
  delete rejects[rk];saved.set(k,{...result,firstSeenAt:old?.firstSeenAt||old?.date_found||old?.publishedAt||now,aiInputFingerprint:fp,aiProcessedAt:now});stats[old?"changed":"added"]++;
 }}
 await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},worker));
 stats.retained=[...saved.keys()].filter(k=>!unique.has(k)).length;
 for(const [k,v] of Object.entries(rejects))if(Date.parse(v.date)<Date.parse(now)-90*86400000)delete rejects[k];
 const articles=[...saved.values()].sort((a,b)=>Number(b.relevanceScore||0)-Number(a.relevanceScore||0)||(Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0))||articleIdentity(a).localeCompare(articleIdentity(b)));
 return {articles,rejected:rejects,stats};
}
