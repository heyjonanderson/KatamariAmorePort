// A133: total size after picking every object, double vs float32 accumulation. Usage: node tests/f32_total.js S006 T
const fs=require('fs'),path=require('path'),K=require('../sim.js');
const st=process.argv[2]||'S006';
const play=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data',st,'play.json'),'utf8'));
const S=K.create(play,{noTarget:true,set:process.argv[3]||'S'});
const objs=S.objs.filter(o=>o.boxvol&&!o.noCatch);
console.log(st,'objs',objs.length,'start vol',S.volume,'diam',S.diam,'addRows',S.addRows.length);
function lin(rows,x){if(!rows.length)return 1;if(x<=rows[0][0])return rows[0][1];for(let i=1;i<rows.length;i++){if(x<=rows[i][0]){const a=rows[i-1],b=rows[i];return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);}}return rows[rows.length-1][1];}
console.log(JSON.stringify(S.addRows));
const f=Math.fround, cbrt=Math.cbrt;
function dv(v){return 2*100*cbrt(3*v/(4*Math.PI))+0.02;}
function dv32(v){const t=f(f(3*v)/f(4*f(Math.PI)));const r=f(f(100*f(Math.cbrt(t)))+f(0.01));return f(r*2);}
function run(order,mode){let v=S.volume,d=S.diam;for(const i of order){const o=objs[i];const ar=lin(S.addRows,d);let add=o.boxvol*o.addRatio*ar;if(mode){add=f(add);v=f(v+add);d=dv32(v);}else{v+=add;d=dv(v);}}return d;}
const idx=objs.map((_,i)=>i);
let r=[];for(let t=0;t<6;t++){const o=idx.slice().sort(()=>Math.random()-0.5);r.push([run(o,0),run(o,1)]);}
for(const [a,b] of r)console.log('double',a.toFixed(3),'f32',b.toFixed(3),'diff cm',(b-a).toFixed(4));
