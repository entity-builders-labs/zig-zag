const m=require('./policy-eval.cjs');const {terms}=m;const A=m.POLICIES['A stable only (title+query)'];
// helpers re-declared (idfScores not exported) via D/A wrappers
const st=(t,c,x)=>A(t,c,x).map(v=>v[0]);
const sn=(t,c,x)=>A(t,c,{titles:[],queries:x.snippets}).map(v=>v[0]);
const rank=(s)=>{const o=s.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]);const r=new Array(s.length);o.forEach(([,i],k)=>r[i]=k+1);return r};
module.exports={
 'E RRF(stable, snippet) k=60':(t,c,x)=>{const a=rank(st(t,c,x)),b=rank(sn(t,c,x));return c.map((_,i)=>[1/(60+a[i])+(x.snippets.length?1/(60+b[i]):0)])},
 'F stable + flat snippet coverage':(t,c,x)=>{const s=st(t,c,x);const q=terms(x.snippets.join(' '));return c.map((ch,i)=>{const bt=terms(t.slice(ch.start,ch.end)+' '+ch.headings.join(' '));let k=0;for(const w of q)if(bt.has(w))k++;return [s[i]+0.5*k]})},
 'G stable + snippet bonus <= 50% of top stable':(t,c,x)=>{const s=st(t,c,x),n=sn(t,c,x);const ms=Math.max(0,...s),mn=Math.max(0,...n);return s.map((v,i)=>[v+(mn>0?0.5*ms*n[i]/mn:0)])},
};
