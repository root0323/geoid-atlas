/* Planetary reference surfaces, not terrain. PDS source conventions and
 * processing are carried with every grid. No synthetic fallback on errors.
 * Earth and the fictional asteroid remain on the original renderer.
 */
(function(){
 'use strict';
 const ids=['mercury','venus','moon','mars'];
 const titles={mercury:'수성 등퍼텐셜면',venus:'금성 지오이드 이상',moon:'달 지오이드',mars:'아레오이드 편차'};
 const shortModels={mercury:'JGMESS160A',venus:'SHG120',moon:'GRGM900C',mars:'GMM-3'};
 const original={renderUI,renderDetail,drawGeoid,formGeoid,selectPlanet,openDialog};
 const cache=new Map(), meshes=new Map(), scales=new Map();let lastReadout=0;
 const supported=id=>ids.includes(id);
 const active=()=>state.page==='app'&&state.mode==='geoid'&&supported(state.selected);
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const wrap=x=>((x%360)+360)%360;
 const fmt=n=>Number(n).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1});
 const entry=id=>cache.get(id);
 function validate(d,id){
  if(d?.meta?.body!==id||d.meta.unit!=='m'||d.meta.isTopography!==false)throw Error('Wrong planetary data');
  const g=d.grid;
  if(!g||g.rows<2||g.cols<2||g.cols>1000||g.rows>1000||d.values.length!==g.rows*g.cols||!(g.stepLat>0)||!(g.stepLon>0))throw Error('Invalid grid');
  if(Math.abs(g.cols*g.stepLon-360)>1e-6||!d.values.every(Number.isFinite))throw Error('Invalid coordinates/values');
  let lo=Infinity,hi=-Infinity;for(const n of d.values){lo=Math.min(lo,n);hi=Math.max(hi,n)}
  if(hi-lo<1||Math.max(Math.abs(lo),Math.abs(hi))>20000||Math.abs(lo-d.meta.rangeM[0])>.002||Math.abs(hi-d.meta.rangeM[1])>.002)throw Error('Invalid range');
  for(const c of d.checks)if(Math.abs(d.values[c.row*g.cols+c.col]-c.valueM)>.001)throw Error('Grid check failed');
  d.values=new Float64Array(d.values);
  return d;
 }
 async function ensure(id,retry=false){
  if(!supported(id))return null;
  const old=entry(id);if(old&&!retry)return old.promise||old.data;
  const item={status:'loading',data:null,error:null};cache.set(id,item);
  item.promise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
   try{
    const response=await fetch('./data/planet-geoids/'+id+'.json?v=1',{signal:controller.signal});
    if(!response.ok)throw Error('HTTP '+response.status);
    item.data=validate(await response.json(),id);item.status='ready';
    const m=item.data.meta,peak=Math.max(...m.rangeM.map(Math.abs));
    const suggested=Math.max(1,Math.round(.13*m.referenceRadiusM/peak));
    scales.set(id,{value:suggested,suggested,max:Math.max(2,Math.round(.27*m.referenceRadiusM/peak))});
    if(active()&&state.selected===id)state.formation=reduced?1:0;
   }catch(e){item.status='error';item.error=String(e);console.error('Planet geoid '+id,e)}
   finally{clearTimeout(timer);if(state.selected===id)renderUI()}
   return item.data;
  })();return item.promise;
 }
 // Longitude interpolation is periodic. At unsampled poles, taper the last
 // half-degree ring to its longitudinal mean (display-only closure).
 function sample(d,lat,lon){
  const g=d.grid,rows=g.rows,cols=g.cols;
  const yy=clamp((g.lat0-lat)/g.stepLat,0,rows-1),y0=Math.floor(yy),y1=Math.min(rows-1,y0+1),fy=yy-y0;
  const xx=wrap(lon-g.lon0)/g.stepLon,x0=Math.floor(xx)%cols,x1=(x0+1)%cols,fx=xx-Math.floor(xx);
  const at=(r,c)=>d.values[r*cols+c];
  return (at(y0,x0)*(1-fx)+at(y0,x1)*fx)*(1-fy)+(at(y1,x0)*(1-fx)+at(y1,x1)*fx)*fy;
 }
 function displaySample(d,lat,lon){
  const g=d.grid,south=g.lat0-(g.rows-1)*g.stepLat;
  if(lat<=g.lat0&&lat>=south)return sample(d,lat,lon);
  const row=lat>g.lat0?0:g.rows-1,edge=lat>g.lat0?g.lat0:south;
  let mean=0;for(let c=0;c<g.cols;c++)mean+=d.values[row*g.cols+c]/g.cols;
  const t=clamp((Math.abs(lat)-Math.abs(edge))/(90-Math.abs(edge)),0,1);
  return sample(d,edge,lon)*(1-t)+mean*t;
 }
 function meshFor(id,mobile){
  const step=mobile?3:2,key=id+'/'+step;if(meshes.has(key))return meshes.get(key);
  const d=entry(id).data,m=d.meta,vertices=[],faces=[],nlat=180/step,nlon=360/step;
  const a=m.referenceRadiusM,b=a*(1-m.flattening);
  for(let i=0;i<=nlat;i++)for(let j=0;j<=nlon;j++){
   const lat=90-i*step,lon=j*step,c=Math.cos(lat*DEG),s=Math.sin(lat*DEG);
   const ref=a*b/Math.sqrt(b*b*c*c+a*a*s*s);
   vertices.push({lat,lon,c,s,sl:Math.sin(lon*DEG),cl:Math.cos(lon*DEG),ref:ref/a,n:displaySample(d,lat,lon)/a,value:displaySample(d,lat,lon)});
  }
  for(let i=0;i<nlat;i++)for(let j=0;j<nlon;j++){
   const k=i*(nlon+1)+j,indices=[k,k+1,k+nlon+2,k+nlon+1],v=indices.reduce((sum,index)=>sum+vertices[index].value,0)/4;
   faces.push({indices,value:v,row:i,col:j});
  }
  const mesh={vertices,faces,step,nlon};meshes.set(key,mesh);return mesh;
 }
 function scaleUI(){
  const s=scales.get(state.selected);if(!s)return;
  const output=$('#planetScaleValue');if(output)output.textContent=s.value.toLocaleString('ko-KR')+'×';
  const range=$('#planetExaggeration');if(range)range.value=String(100*Math.log(s.value)/Math.log(s.max));
  const actual=$('[data-planet-action="actual"]');if(actual)actual.setAttribute('aria-pressed',String(s.value===1));
 }
 function setScale(value){
  const s=scales.get(state.selected);if(!s)return;
  s.value=Math.round(clamp(value,1,s.max));scaleUI();
 }
 function panel(){
  const id=state.selected,item=entry(id),p=selectedPlanet(),el=$('#rightPanel');
  el.hidden=false;el.classList.add('planet-geoid-panel','mobile-compact');el.classList.remove('map-panel');
  const ready=item?.status==='ready',d=item?.data,m=d?.meta;
  el.innerHTML=`<div class="detail-top"><span>${ready?'NASA PDS · DATA-BASED':'NASA PDS · REFERENCE SURFACE'}</span><button class="detail-close" data-action="deselect" aria-label="태양계로 돌아가기">${icon('close')}</button></div>
   <div class="detail-heading"><div class="detail-orb" style="--planet:${p.color}" aria-hidden="true"></div><div><h2>${p.name}</h2><p>${shortModels[id]}</p></div></div>
   <div class="pg-model">${escape(m?.model||shortModels[id])}</div>
   ${ready?`<div class="pg-scale"><label class="range-label" for="planetExaggeration"><span>굴곡 확대 배율</span><output id="planetScaleValue"></output></label><input type="range" id="planetExaggeration" min="0" max="100" step="0.1" aria-label="실제 높이값의 시각적 확대 배율"><div class="pg-actions"><button data-planet-action="actual" aria-pressed="false">실제 비율 1×</button><button data-planet-action="suggested">확대 보기</button></div></div><p class="pg-sample" id="planetCenterSample"></p>`:`<p class="pg-loading" role="status">${item?.status==='error'?'자료를 불러오지 못했습니다. 가상 굴곡으로 대체하지 않습니다.':'중력장 기준면 자료를 불러오는 중입니다.'}</p>${item?.status==='error'?'<button class="secondary full" data-planet-action="retry">다시 불러오기</button>':''}`}
   <button class="secondary full pg-source-button" data-planet-action="sources">${icon('info')}데이터 출처 · 기준면</button>
   <button class="mobile-detail-toggle" data-action="expand-detail" style="display:none">표시 옵션 ⌄</button>
   <details class="pg-options"><summary>표시 옵션</summary><div>${toggleMarkup('grid','위·경도 격자')+toggleMarkup('reference',id==='venus'?'시각화 지지면':'제품 기준면')+toggleMarkup('rotate','자동 회전')}</div></details>
   <p class="detail-caption pg-caveat">${id==='mars'?'GMM-3의 3–90차 편차입니다.':id==='venus'?'지지 구면은 공인 수직기준이 아닙니다.':id==='moon'?'원본의 무회전 기준구 정의를 사용합니다.':'공개 중력장으로 계산한 선택 등퍼텐셜면입니다.'} 색은 실제 N(m), 모양은 배율만큼 확대합니다.</p>`;
  scaleUI();
 }
 function sync(){
  const on=active();document.body.classList.toggle('planet-geoid-active',on);
  if(!on){$('#rightPanel').classList.remove('planet-geoid-panel');return}
  const id=state.selected,item=entry(id),m=item?.data?.meta;
  $('#sceneTitle').textContent=selectedPlanet().name+' · '+titles[id];
  $('#sceneSubtitle').textContent=(m?.model||shortModels[id])+' · '+(item?.status==='ready'?'중력 자료 기반':'자료 로딩');
  $('#sceneHint').hidden=true;
  $('#sceneNotes').innerHTML='<strong>드래그 회전 · 휠 확대 / 축소</strong><br>색상 = 기준면 편차(m) · 산과 계곡의 지형이 아닙니다.';
  $('#statusText').textContent=titles[id]+' · '+shortModels[id];
  $('.footer-disclaimer').textContent='자료 기반 · 굴곡 확대 · 천체별 기준 상이';
  $('#sceneCanvas').setAttribute('aria-label',selectedPlanet().name+' 중력 자료 기반 '+titles[id]+'. 드래그로 회전하고 굴곡 배율을 조절하세요. 출처 버튼에서 기준을 확인할 수 있습니다.');
 }
 renderDetail=function(){
  if(active()){panel();return}
  original.renderDetail();$('#rightPanel').classList.remove('planet-geoid-panel');
  const p=selectedPlanet();if(state.mode==='solar'&&p&&supported(p.id)){
   const prop=$('#rightPanel .detail-properties');if(prop)prop.innerHTML='<div class="spread"><span>중력장 모델</span><span>'+shortModels[p.id]+'</span></div><div class="spread"><span>기준면</span><span>NASA PDS 자료 기반</span></div>';
  }
 };
 renderUI=function(){original.renderUI();sync();if(active()&&!entry(state.selected))ensure(state.selected)};
 formGeoid=function(){if(!supported(state.selected))return original.formGeoid();if(state.mode==='geoid'){state.formation=reduced?1:0;return}route('geoid',state.selected)};
 selectPlanet=function(id,source){if(supported(id)&&active()&&id===state.selected){openSources();return}return original.selectPlanet(id,source)};
 for(const p of planets)if(supported(p.id))p.desc=shortModels[p.id]+' 중력 자료를 바탕으로 한 기준면을 볼 수 있습니다. 지오이드 형성을 누르면 실제 데이터의 높이 분포가 표시됩니다.';
 function color(value,min,max,light){
  const t=clamp((value-min)/(max-min),0,1),stops=[[44,80,153],[51,167,185],[122,194,148],[234,204,110],[200,94,65]],f=t*4,i=Math.min(3,Math.floor(f)),q=f-i;
  return 'rgb('+stops[i].map((n,k)=>Math.round((n*(1-q)+stops[i+1][k]*q)*light)).join(',')+')';
 }
 drawGeoid=function(ctx,w,h,dt){
  if(!active())return original.drawGeoid(ctx,w,h,dt);
  drawStars(ctx,w,h,.9);
  if(state.rotate&&!reduced&&!drag.active)state.lon+=dt*.000028;
  state.formation=Math.min(1,state.formation+dt/900);
  const mobile=w<=600,id=state.selected,d=entry(id)?.data;
  const radius=Math.min(mobile?w*.31:Math.max(180,w-320)*.32,mobile?h*.20:h*.32)*state.zoom;
  const cx=(mobile?w*.5:(w-300)*.53)+state.panX,cy=h*(mobile?.39:.50)+state.panY;
  hitObjects=[{id,x:cx,y:cy,r:radius*1.28,bodyR:radius}];
  if(!d){ctx.save();ctx.strokeStyle='#466472';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,radius,0,TAU);ctx.stroke();ctx.textAlign='center';ctx.font='12px sans-serif';ctx.fillStyle='#a4bbc7';ctx.fillText(entry(id)?.status==='error'?'자료 로딩 실패 · 다시 불러오기':'NASA PDS 자료 로딩 중',cx,cy);ctx.restore();return}
  const mesh=meshFor(id,mobile),m=d.meta,sc=scales.get(id),gain=sc.value*(1-Math.pow(1-state.formation,3));
  const sl=Math.sin(state.lon),cl=Math.cos(state.lon),sp=Math.sin(state.lat),cp=Math.cos(state.lat);
  const points=mesh.vertices.map(v=>{
   const x=v.c*(v.sl*cl-v.cl*sl),y=v.s,z=v.c*(v.cl*cl+v.sl*sl),yy=y*cp-z*sp,zz=y*sp+z*cp,rr=v.ref+gain*v.n;
   return {x:cx+radius*rr*x,y:cy-radius*rr*yy,z:zz,light:clamp(.65+.28*zz-.15*x+.12*yy,.34,1.08)};
  });
  const faces=[];for(const f of mesh.faces){const z=f.indices.reduce((s,i)=>s+points[i].z,0)/4;if(z>-.025)faces.push({f,z})}faces.sort((a,b)=>a.z-b.z);
  ctx.save();ctx.lineWidth=.5;
  for(const {f} of faces){
   const p=f.indices.map(i=>points[i]);const fill=color(f.value,m.rangeM[0],m.rangeM[1],p.reduce((s,q)=>s+q.light,0)/4);
   ctx.beginPath();ctx.moveTo(p[0].x,p[0].y);for(let k=1;k<4;k++)ctx.lineTo(p[k].x,p[k].y);ctx.closePath();ctx.fillStyle=fill;ctx.strokeStyle=fill;ctx.fill();ctx.stroke();
  }
  if(state.reference){ctx.strokeStyle='#d8eff280';ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.beginPath();ctx.ellipse(cx,cy,radius,radius*(1-m.flattening*Math.cos(state.lat)**2),0,0,TAU);ctx.stroke();ctx.setLineDash([])}
  if(state.grid){
   ctx.strokeStyle='#efffff30';ctx.lineWidth=.55;
   const line=indices=>{ctx.beginPath();let pen=false;for(const i of indices){const p=points[i];if(p.z<=0){pen=false;continue}if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true}ctx.stroke()};
   for(let lat=30;lat<180;lat+=30){const row=Math.round(lat/mesh.step);line(Array.from({length:mesh.nlon+1},(_,j)=>row*(mesh.nlon+1)+j))}
   for(let lon=0;lon<360;lon+=30){const col=Math.round(lon/mesh.step);line(Array.from({length:180/mesh.step+1},(_,i)=>i*(mesh.nlon+1)+col))}
  }
  ctx.strokeStyle='#ffffffa0';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(cx-4,cy);ctx.lineTo(cx+4,cy);ctx.moveTo(cx,cy-4);ctx.lineTo(cx,cy+4);ctx.stroke();
  const lx=mobile?18:26,ly=mobile?Math.min(h*.65,cy+radius*1.28+26):h-142,lw=mobile?160:210;
  const gradient=ctx.createLinearGradient(lx,0,lx+lw,0);for(let i=0;i<=4;i++)gradient.addColorStop(i/4,color(m.rangeM[0]+(m.rangeM[1]-m.rangeM[0])*i/4,...m.rangeM,1));
  ctx.fillStyle=gradient;ctx.fillRect(lx,ly,lw,5);ctx.font=(mobile?'9':'10')+'px sans-serif';ctx.fillStyle='#b9ccd5';ctx.textAlign='left';ctx.fillText(fmt(m.rangeM[0])+' m',lx,ly+20);ctx.textAlign='right';ctx.fillText(fmt(m.rangeM[1])+' m',lx+lw,ly+20);ctx.textAlign='left';ctx.fillText('N · '+(sc.value===1?'실제 비율 1×':'굴곡 '+sc.value.toLocaleString('ko-KR')+'×'),lx,ly-10);
  ctx.restore();
  if(performance.now()-lastReadout>150){lastReadout=performance.now();const target=$('#planetCenterSample');if(target){const lat=state.lat/DEG,lon=wrap(state.lon/DEG);target.textContent='중심 방향 '+fmt(lat)+'° / '+fmt(lon)+'°E · N '+fmt(sample(d,lat,lon))+' m'}}
 };
 function openSources(){
  const id=state.selected,item=entry(id);if(!supported(id))return;
  original.openDialog('planetary');
  const m=item?.data?.meta,g=item?.data?.grid;
  $('#dialog').innerHTML=dialogHeader(selectedPlanet().name+' · 데이터 출처','PLANETARY GRAVITY / NASA PDS')+(m?`<div class="dialog-copy"><h3>${escape(m.model)}</h3><p>${escape(m.agency)}<br>${escape(m.mission)}</p><div class="formula-card"><div class="eq">${escape(m.surfaceName)} · N (m)</div><p>색은 저장된 수치의 분포입니다. 모양은 N에 선택한 배율을 곱해 반지름 방향으로 표현한 시각화이며, 표면 지형이나 정확한 측량용 3D 기준면이 아닙니다.</p></div><h3>자료와 계산</h3><p>${escape(m.method)}</p><h3>기준면 정의</h3><p>${escape(m.referenceText)}</p><h3>좌표·해상도</h3><p>${escape(m.frame)}<br>원자료: ${escape(m.nativeGrid)}<br>웹 데이터: ${g.rows} × ${g.cols}, ${g.stepLat.toFixed(3)}° × ${g.stepLon.toFixed(3)}°<br>${escape(m.processing)}</p><p>화면 사각망 간격: PC 2°, 모바일 3°. 중간 위치는 쌍선형 보간합니다. 원본에 극점이 없는 격자의 마지막 0.5°는 시각적 연결만 보완합니다. 확대 배율은 원자료를 바꾸지 않으며, 표시 자릿수는 측정 정확도가 아닙니다.</p><h3>범위와 해석</h3><p>웹 격자 범위: ${fmt(m.rangeM[0])} ~ ${fmt(m.rangeM[1])} m.<br>천체별 기준과 포함한 성분, 색 범위 및 배율이 다르므로 모양이나 색만으로 천체 간 중력의 세기를 비교할 수 없습니다.</p><div class="dialog-ref"><a href="${escape(m.source)}" target="_blank" rel="noopener">NASA PDS 원자료</a> · <a href="${escape(m.label)}" target="_blank" rel="noopener">PDS 원본 라벨</a><br><a href="${escape(m.paperUrl)}" target="_blank" rel="noopener">${escape(m.paper)}</a><br><a href="./data/planet-geoids/${id}.json" target="_blank" rel="noopener">웹에 사용한 수치 데이터</a> · <a href="./data/planet-geoids/manifest.json" target="_blank" rel="noopener">처리 기록·검증값</a></div><details class="pg-hash"><summary>원자료 SHA-256</summary><code>${escape(m.sourceSha256)}</code></details></div>`:`<div class="dialog-copy">자료 로딩이 완료된 뒤 상세 기준과 출처를 확인할 수 있습니다. <a href="https://pds-geosciences.wustl.edu/dataserv/gravity_models.htm" target="_blank" rel="noopener">NASA PDS 중력 모델 목록</a></div>`);
 }
 openDialog=function(type){original.openDialog(type);if(type==='concept'||type==='help'){const note=document.createElement('p');note.className='small-notice';note.textContent='추가된 천체 데이터: 수성 JGMESS160A, 금성 SHG120, 화성 GMM-3, 달 GRGM900C. 각 천체의 출처 버튼에서 서로 다른 기준면 정의를 확인하세요. 지구의 전 지구 구체와 가상 소행성은 여전히 개념 모형입니다.';$('#dialog').append(note)}};
 document.addEventListener('click',e=>{const button=e.target.closest('[data-planet-action]');if(!button)return;const action=button.dataset.planetAction,s=scales.get(state.selected);if(action==='sources')openSources();else if(action==='actual')setScale(1);else if(action==='suggested'&&s)setScale(s.suggested);else if(action==='retry'){ensure(state.selected,true);renderUI()}});
 document.addEventListener('input',e=>{if(e.target.id==='planetExaggeration'){const s=scales.get(state.selected);if(s)setScale(Math.exp(Number(e.target.value)/100*Math.log(s.max)))}});
 window.GeoidAtlas.version='0.9.0';
 window.GeoidAtlas.getPlanetGeoidState=()=>{const id=state.selected,item=entry(id);return {body:id,active:active(),status:item?.status||'not-loaded',meta:item?.data?.meta||null,grid:item?.data?.grid||null,exaggeration:scales.get(id)?.value||null}};
 window.GeoidAtlas.samplePlanetGeoid=(id,lat,lon)=>{const d=entry(id)?.data;if(!d||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90)return null;return sample(d,lat,lon)};
 renderUI();
})();
