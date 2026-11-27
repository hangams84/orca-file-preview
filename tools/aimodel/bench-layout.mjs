// Layout benchmark for the AI Model Preview graph view: the plugin's own layered layout
// (plugin/editor/renderers/aimodel/layout.ts) against @dagrejs/dagre on synthetic ResNet/Transformer DAGs.
//   npm i --no-save @dagrejs/dagre && node tools/aimodel/bench-layout.mjs
// Results are recorded in docs/research/ai-model-visualization.md (section 2.1).
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
let dagre = null
try { dagre = require('@dagrejs/dagre') } catch { console.log('@dagrejs/dagre not installed: custom layout only') }
const { layout } = await import(new URL('../../plugin/editor/renderers/aimodel/layout.ts', import.meta.url))
function resnet(n){const N=[],E=[];for(let i=0;i<n;i++){N.push({id:'n'+i,width:120,height:40});if(i)E.push({from:'n'+(i-1),to:'n'+i});if(i%4===0&&i>=4)E.push({from:'n'+(i-4),to:'n'+i})}return{N,E}}
function transformer(n){const N=[],E=[];let prev='in';N.push({id:'in',width:120,height:40});let k=0;while(N.length<n){const b='b'+(k++);const ids=['q','k','v','mm','sm','mm2','proj','add','ln','fc1','act','fc2','add2'].map(s=>b+s);for(const id of ids)N.push({id,width:120,height:40});const [q,kk,v,mm,sm,mm2,proj,add,ln,fc1,act,fc2,add2]=ids;E.push({from:prev,to:q},{from:prev,to:kk},{from:prev,to:v},{from:q,to:mm},{from:kk,to:mm},{from:mm,to:sm},{from:sm,to:mm2},{from:v,to:mm2},{from:mm2,to:proj},{from:proj,to:add},{from:prev,to:add},{from:add,to:ln},{from:ln,to:fc1},{from:fc1,to:act},{from:act,to:fc2},{from:fc2,to:add2},{from:ln,to:add2});prev=add2}return{N,E}}
function crossings(res,E){return 0}
const rows=[]
for (const [name,gen] of [['resnet',resnet],['transformer',transformer]]) for (const size of [500,2000,10000]) {
  const {N,E}=gen(size)
  let t=performance.now(); const r=layout(N,E,{direction:'TB'}); const tc=performance.now()-t
  let td='skip'
  if (dagre) { t=performance.now(); const g=new dagre.graphlib.Graph(); g.setGraph({rankdir:'TB',nodesep:18,ranksep:36}); g.setDefaultEdgeLabel(()=>({})); for(const n of N)g.setNode(n.id,{width:n.width,height:n.height}); for(const e of E)g.setEdge(e.from,e.to); try{dagre.layout(g); td=(performance.now()-t).toFixed(0)}catch(e){td="fail: "+e.constructor.name} }
  rows.push({graph:name,nodes:N.length,edges:E.length,custom_ms:tc.toFixed(0),dagre_ms:td,custom_w:Math.round(r.width),custom_h:Math.round(r.height)})
}
console.table(rows)
