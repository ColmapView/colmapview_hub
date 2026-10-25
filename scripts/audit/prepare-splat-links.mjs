/** Bind checked Gaussian headers to exact published model selections. Operator-only network work. */
import { build } from 'esbuild';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const scratch=resolve('.tmp/splat-link-audit-20261025'), viewer=resolve('../colmap-webview');
await mkdir(scratch,{recursive:true});
const plan=JSON.parse(await readFile(resolve(scratch,'plan.json')));
const fresh=new Map((await readFile(resolve(scratch,'headers.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>{
  const row=JSON.parse(line);return [[row.sourceId,row.revision,null,row.path].join('\0'),row];
}));
for(const row of JSON.parse(await readFile(resolve(scratch,'raw-headers.json'),'utf8')))
  fresh.set([row.sourceId,row.revision,null,row.path].join('\0'),row);
const positions=JSON.parse(await readFile(resolve(scratch,'raw-position-associations.json'),'utf8'));
const exports={
  'src/hooks/urlLoaderPolicy.ts':['createDefaultManifest'],
  'src/hooks/urlLoaderColmapDiscovery.ts':['withDiscoveredColmapPaths'],
  'src/types/manifest.ts':['ColmapManifestSchema'],
  'src/types/cameraDatasetManifest.ts':['CameraDatasetManifestSchema'],
};
const moduleFile=resolve(scratch,'viewer-manifest-tools.mjs');
await build({stdin:{contents:Object.entries(exports).map(([file,names])=>`export {${names}} from ${JSON.stringify(resolve(viewer,file))};`).join('\n'),resolveDir:viewer,loader:'ts'},
  outfile:moduleFile,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{}'},
  plugins:[{name:'anonymous-operator-transport',setup(b){b.onResolve({filter:/fetchDatasetResource$/},()=>({path:'transport',namespace:'audit'}));b.onLoad({filter:/.*/,namespace:'audit'},()=>({contents:'export const fetchDatasetResource=(url,timeout,init)=>fetch(url,init); export const fetchDatasetRequest=fetchDatasetResource;',loader:'js'}));}}]});
const tools=await import(pathToFileURL(moduleFile).href);
const hash=body=>createHash('sha256').update(body).digest('hex');
const key=(source,path)=>[source.sourceId,source.revision,null,path].join('\0');
const fileUrl=(source,path)=>`https://huggingface.co/datasets/${source.sourceId.slice(3)}/resolve/${source.revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
const report=[], routes=[];
const previous=new Map(JSON.parse(await readFile(resolve(scratch,'prepared.json'),'utf8').catch(()=>' {"routes":[]}')).routes.map(row=>[row.id,row]));
const committed=await readFile('data/gaussian-routing.json.gz').then(bytes=>JSON.parse(gunzipSync(bytes))).catch(error=>{
  if(error.code!=='ENOENT')throw error;return {routes:[]};
});
for(const row of committed.routes)previous.set(row.id,row);
const cached=new Map();
async function fetchPublic(url,init={}){
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||target.hash)throw Error('Only public HTTPS sources can be audited');
  const cacheKey=JSON.stringify([init.method??'GET',url,new Headers(init.headers).get('range')]);
  if(!cached.has(cacheKey))cached.set(cacheKey,(async()=>{
    const r=await fetch(url,{...init,signal:AbortSignal.timeout(30000)});
    if(!r.body)return {status:r.status,headers:r.headers,body:null};
    const reader=r.body.getReader(),chunks=[];let total=0;
    try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>16*1024*1024)throw Error('Operator metadata response exceeds 16 MiB');chunks.push(Buffer.from(part.value));}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    return {status:r.status,headers:r.headers,body:Buffer.concat(chunks)};
  })());
  const r=await cached.get(cacheKey);return new Response(r.body,{status:r.status,headers:r.headers});
}
function checkedAsset(asset,source){
  const h=fresh.get(key(source,asset.path))??asset.header;
  const gaussians=h?.gaussians??h?.vertices;
  if(!h||h.status!=='header_checked'||!['splats','gaussian-splat'].includes(h.role)||!Number.isSafeInteger(gaussians)||gaussians<1)return null;
  if(h.encoding)return null;
  const bytes=h.bytes??Number(/\/(\d+)$/.exec(h.receipt?.contentRange??'')?.[1]);
  if(!Number.isSafeInteger(bytes)||bytes<1)return null;
  const allowOrigin=h.allowOrigin??h.receipt?.allowOrigin;
  if(allowOrigin!=='*'&&allowOrigin!=='https://colmapview.opsiclear.com')return null;
  return {path:asset.path,url:fileUrl(source,asset.path),format:asset.kind,bytes,gaussians,
    role:/(?:\/change_detection\/|\/T[12]_change\.ply$)/i.test(asset.path)?'change_subset':'model',
    headerSha256:h.headerSha256??h.receipt?.sha256,headerBytes:h.headerBytes??h.receipt?.bytes,
    allowOrigin,headerCheckedAt:h.checkedAt??'2026-10-19',
    association:asset.owners.length?'scene_hierarchy':asset.associationRule??'named_training_output',
    ...(asset.associationRule==='sampled_identical_gaussian_positions'?{positionAssociation:positions.find(row=>row.path===asset.path&&row.url===fileUrl(source,asset.path))}:{})};
}
function matches(scene,asset,source){
  if(asset.owners.includes(scene.id))return true;
  if(!asset.nameCandidates.includes(scene.id))return false;
  if(asset.associationRule==='gs_pool_capture_and_time')return true;
  if(asset.associationRule==='publisher_shared_world')return true;
  if(asset.associationRule==='sampled_identical_gaussian_positions')
    return positions.some(row=>row.id===scene.id&&row.path===asset.path&&row.url===fileUrl(source,asset.path)&&row.matched>=32);
  const leaf=scene.scope.split('/').at(-1), parts=asset.path.split('/');
  if(source.sourceId==='hf:pablovela5620/nerf-synthetic-mirror')return asset.path===`trained/${leaf}.ply`;
  if(source.sourceId==='hf:alexmkwizu/gaussian_training_datasets')return asset.path===`tested_outputs/${leaf}.ply`;
  if(source.sourceId==='hf:ChenJJ123/d3dgs-benchmark')return parts[1]===leaf&&parts.at(-1)==='frame_0000.ply';
  if(source.sourceId==='hf:anonymous-user-submission/Poison-3DGS')return false; // Different variants must retain their own worlds.
  if(source.sourceId==='hf:nviolante/dot3d')return parts.includes(leaf);
  if(source.sourceId==='hf:vlongle/pixie')return parts[0]==='real_scene_models'&&parts[1]===leaf;
  if(source.sourceId==='hf:zhaoshiwen/blur-slam-bpn-data')return parts[0]==='results'&&parts[1]===leaf;
  if(source.sourceId==='hf:Yiwen-ntu/GaussianEditor_Result')return false;
  return false;
}
function selectedAtStaticTime(asset){
  const name=asset.path.split('/').at(-1);
  return !/^(?:frame_)?\d{4,}\.ply$/.test(name)||/^(?:frame_)?0+\.ply$/.test(name);
}
async function baseManifest(scene){
  const prior=previous.get(scene.id);
  if(prior?.baseViewerUrl===scene.viewerUrl&&JSON.stringify(prior.files)===JSON.stringify(scene.files))
    return {manifest:prior.baseManifest,...(prior.baseManifestSha256?{baseManifestSha256:prior.baseManifestSha256}:{})};
  const target=new URL(scene.viewerUrl).searchParams.get('url');
  if(!target)throw Error('Missing dataset URL');
  if(target.startsWith('https://colmapview.opsiclear.com/hub/datasets/individual/manifests/')){
    const name=new URL(target).pathname.split('/').at(-1);
    const body=await readFile('public/hub/datasets/individual/manifests/'+name);
    return {manifest:JSON.parse(body),baseManifestSha256:hash(body)};
  }
  if(scene.kind==='camera-scene'||scene.kind==='scene')return {manifest:{format:'colmapview-camera-dataset',version:1,metadataUrl:target}};
  const manifest=await tools.withDiscoveredColmapPaths(tools.createDefaultManifest(target),{fetchImpl:fetchPublic,log:()=>{}});
  return {manifest};
}
async function prepare(scene){
  const source=plan.sources[scene.source];
  const candidates=[...new Set([...scene.localAssets,...scene.siblingCandidates])].map(i=>plan.assets[i]);
  const gaussian=candidates.map(a=>({asset:a,checked:checkedAsset(a,source)})).filter(a=>a.checked);
  const eligible=gaussian.filter(a=>matches(scene,a.asset,source)&&selectedAtStaticTime(a.asset)).map(a=>a.checked);
  const row={id:scene.id,sourceId:source.sourceId,kind:scene.kind,path:scene.path,
    candidates:candidates.length,checkedGaussians:gaussian.length,selectedAssets:eligible.length,status:'no_gaussian_candidates',
    ...(scene.availableSplats?{previousGaussianStatus:scene.availableSplats.status}:{})};
  report.push(row);
  if(!eligible.length){
    if(scene.geometryLinked){row.status='already_linked_geometry';return;}
    row.status=gaussian.length?'association_or_temporal_review':candidates.length?'no_supported_gaussians':'no_gaussian_candidates';
    if(gaussian.length&&source.sourceId==='hf:anonymous-user-submission/Poison-3DGS'&&scene.path.startsWith('benchmark/clean/')){
      row.status='different_reconstruction_variant';
      row.reason='Only poisoned-variant training outputs are listed. Clean source photographs do not establish a shared coordinate frame or an equivalent reconstruction.';
    }
    return;
  }
  try{
    const base=await baseManifest(scene);
    if(base.manifest.geometryFiles?.some(file=>file.role==='splat')){row.status='already_linked_geometry';return;}
    const manifest=structuredClone(base.manifest);
    if(manifest.format==='colmapview-camera-dataset')manifest.version=2;
    manifest.splats=eligible.map(asset=>asset.url);
    const projection=source.sourceId==='hf:pablovela5620/nerf-synthetic-mirror'
      ?JSON.parse(await readFile(resolve(scratch,'mic-alignment.json')).catch(()=>JSON.stringify(previous.get(scene.id)?.projection??null))):undefined;
    if(source.sourceId==='hf:pablovela5620/nerf-synthetic-mirror'&&(!projection||!projection.best.matrix.every((r,i)=>r.every((v,j)=>v===(i===j?1:0)))||projection.best.coverage<0.98))throw Error('Mic requires an independently checked alignment');
    (manifest.format==='colmapview-camera-dataset'?tools.CameraDatasetManifestSchema:tools.ColmapManifestSchema).parse(manifest);
    routes.push({id:scene.id,sourceId:source.sourceId,revision:source.revision,kind:scene.kind,path:scene.path,
      files:scene.files,baseViewerUrl:scene.viewerUrl,baseManifest:base.manifest,
      ...(base.baseManifestSha256?{baseManifestSha256:base.baseManifestSha256}:{}),manifest,assets:eligible,
      ...(projection?{projection}:{})});
    row.status='ready';
  }catch(error){row.status='preparation_failed';row.error=error.message;}
  await appendFile(resolve(scratch,'preparation-progress.ndjson'),JSON.stringify(row)+'\n');
}
let next=0;
await Promise.all(Array.from({length:4},async()=>{while(next<plan.scenes.length){const scene=plan.scenes[next++];await prepare(scene);}}));
routes.sort((a,b)=>a.id.localeCompare(b.id));report.sort((a,b)=>a.id.localeCompare(b.id));
const output={schemaVersion:1,checkedAt:new Date().toISOString(),baselineGeneration:plan.baselineGeneration,
  viewerVersion:'0.25.0',viewerCommit:'02af3fbaa91d11b00179e4780f3af717f66e1d61',
  scope:'Exact current published model selections. Gaussian headers and scoped publisher associations; no upgraded sparse-point, photograph or full-export claims.',
  routes,report};
await writeFile(resolve(scratch,'prepared.json'),JSON.stringify(output,null,2)+'\n');
const summary={scenes:report.length,linkedScenes:routes.length,linkedAssets:routes.reduce((n,row)=>n+row.assets.length,0),statuses:{}};
for(const row of report)summary.statuses[row.status]=(summary.statuses[row.status]??0)+1;
await writeFile(resolve(scratch,'preparation-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
