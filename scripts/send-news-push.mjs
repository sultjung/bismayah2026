import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='https://sultjung.github.io/bismayah2026/';
const config=JSON.parse(fs.readFileSync('push-config.json','utf8'));
const apiKey=process.env.ONESIGNAL_REST_API_KEY;
if(!config.appId||!apiKey){console.log('Push not configured; skipping.');process.exit(0);}
const sources=[['data/domestic-news.json','국내'],['data/overseas-news.json','이라크'],['data/com-activities.json','COM']];
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const articles=[];
for(const [file,category] of sources){
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(data.articles))throw Error('Invalid articles: '+file);
 for(const a of data.articles){
   const title=clean(a.titleKo||a.title_ko||a.title||a.title_original);
   const date=String(a.publishedAt||a.published_date||'');
   const identity=category==='COM'?(date.slice(0,10)||a.id):a.url||a.id||clean(a.title);
   if(!identity||!title)continue;
   articles.push({id:hash(category+'|'+identity),category,title,date});
 }
}
const statePath='data/push-state.json';
const now=new Date().toISOString();
const previous=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
const state=previous?.appId===config.appId?previous:null;
const known=new Set(state?.seen||[]);
const fresh=[...new Map(articles.filter(a=>!known.has(a.id)).map(a=>[a.id,a])).values()];
const save=()=>{for(const a of articles)known.add(a.id);fs.writeFileSync(statePath,JSON.stringify({appId:config.appId,seen:[...known].sort()},null,2)+'\n');};
if(!state){save();console.log('Initial baseline saved without sending old news.');process.exit(0);}
if(!fresh.length){console.log('No new articles.');process.exit(0);}
fresh.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
const counts=Object.entries(fresh.reduce((o,a)=>(o[a.category]=(o[a.category]||0)+1,o),{})).map(([k,v])=>k+' '+v+'건').join(' · ');
const message=(counts+' | '+fresh[0].title).slice(0,180);
const digest=hash(config.appId+'|'+fresh.map(a=>a.id).sort().join('|'));
const uuid=digest.slice(0,8)+'-'+digest.slice(8,12)+'-4'+digest.slice(13,16)+'-8'+digest.slice(17,20)+'-'+digest.slice(20,32);
const response=await fetch('https://api.onesignal.com/notifications?c=push',{method:'POST',headers:{Authorization:'Key '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({app_id:config.appId,target_channel:'push',included_segments:['Subscribed Users'],headings:{en:'BNCP News · 신규 뉴스 '+fresh.length+'건',ko:'BNCP News · 신규 뉴스 '+fresh.length+'건'},contents:{en:message,ko:message},url:root,chrome_web_icon:root+'assets/favicon.png',firefox_icon:root+'assets/favicon.png',idempotency_key:uuid,ttl:86400}),signal:AbortSignal.timeout(30000)});
const result=await response.json();
if(!response.ok)throw Error('OneSignal HTTP '+response.status);
if(!result.id){
 const errors=JSON.stringify(result.errors||'');
 if(/not subscribed|no recipients/i.test(errors)){console.log('No subscribed recipients; recording current articles.');save();process.exit(0);}
 throw Error('OneSignal did not accept notification: '+errors.slice(0,300));
}
save();console.log('Notification accepted: '+result.id+'; articles: '+fresh.length);
