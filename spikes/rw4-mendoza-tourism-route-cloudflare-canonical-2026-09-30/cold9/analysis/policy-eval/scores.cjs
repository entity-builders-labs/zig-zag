const fs=require('fs');const {terms}=require('./policy-eval.cjs');
const src=fs.readFileSync('spikes/rw4-cloudflare-source-fidelity-2026-10-01/output.md','utf8');
// re-chunk via the port internals
const m=require('./policy-eval.cjs');
const ctx=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const DATA=/data:[a-z0-9.+/-]+(?:;[a-z0-9=.+-]+)*;base64,[a-z0-9+/=]+/gi;const text=src.replace(DATA,'');
// expose chunks: monkeypatch via policy capturing
let CH;m.POLICIES.__cap=(t,chunks,c)=>{CH=chunks;return chunks.map(()=>[0])};m.windowWith(src,ctx[0],6000,m.POLICIES.__cap);
const HW=2;
function per(q){const body=CH.map(c=>terms(text.slice(c.start,c.end))),head=CH.map(c=>terms(c.headings.join(' ')));const df=new Map();for(let i=0;i<CH.length;i++)for(const t of new Set([...body[i],...head[i]]))if(q.has(t))df.set(t,(df.get(t)??0)+1);
return CH.map((_,i)=>{let s=0,hits=[];for(const t of q){const d=df.get(t);if(!d)continue;const idf=Math.log(1+CH.length/d);if(head[i].has(t)){s+=HW*idf;hits.push('H:'+t+':'+idf.toFixed(1))}else if(body[i].has(t)){s+=idf;hits.push(t+':'+idf.toFixed(1))}}return {s,hits}})}
for(const c of ctx.slice(0,2)){const st=per(terms([...c.titles,...c.queries].join(' '))),sn=per(terms(c.snippets.join(' ')));
const rows=CH.map((ch,i)=>({i,r:`${ch.start}-${ch.end}`,len:ch.end-ch.start,st:+st[i].s.toFixed(2),sn:+sn[i].s.toFixed(2),h:ch.headings.slice(-1)[0]||'',sth:st[i].hits.join(' '),snh:sn[i].hits.join(' ')}));
console.log('==',c.label);const top=[...rows].sort((a,b)=>(b.st+b.sn)-(a.st+a.sn)).slice(0,10);for(const r of top)console.log(r.i,r.r,r.len,'st',r.st,'sn',r.sn,'|',r.h.slice(0,40),'|',r.sth,'||',r.snh);
const it=rows.find(r=>r.r.startsWith('41153')||text.slice(CH[r.i].start,CH[r.i].end).includes('Alfa Crux]'));console.log('ITIN',it.i,it.r,it.len,'st',it.st,'sn',it.sn,'|',it.sth,'||',it.snh, 'rank by st', [...rows].sort((a,b)=>b.st-a.st).findIndex(r=>r.i===it.i));}
