/* Whole-Earth geoid, EGM2008 / NGA / PROJ. No KN extrapolation, terrain,
 * synthetic field, or alternative-model fallback. Map data remain independent.
 * Latitude is geodetic; N is added along the WGS84 ellipsoid normal.
 */
(function () {
 'use strict';
 const prior={drawGeoid,renderUI,renderDetail,formGeoid,resetCamera,focusSelected,openDialog};
 const active=()=>state.page==='app'&&state.mode==='geoid'&&state.selected==='earth';
 const A=6378137,F=1/298.257223563,E2=F*(2-F),SOURCE_HASH='4191d471eefebf24091b56dbc604353cb3b8cf8cc70e448bb9ae56a272bef17a';
 const ui={gain:10000,coast:true};
 let data=null,status='idle',error='',promise=null,lastReadout=0,lastGeometry=null;
 const meshes=new Map();let coastlines=null;
 const wrap=x=>((x+180)%360+360)%360-180;
 const nfGlobal=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1,minimumFractionDigits:1});
 const number=v=>Number.isFinite(v)?nfGlobal.format(v):'—';
 function validate(d){
  const m=d?.meta,g=d?.grid;
  if(m?.body!=='earth'||m.model!=='EGM2008'||m.unit!=='m'||m.coverage!=='global'||m.isTopography!==false||m.sourceSha256!==SOURCE_HASH)throw Error('전 지구 모델 확인 실패');
  if(g?.rows!==181||g.cols!==360||g.lat0!==90||g.lon0!==-180||g.stepLat!==1||g.stepLon!==1||d.values?.length!==65160)throw Error('전 지구 격자 구조 확인 실패');
  let lo=Infinity,hi=-Infinity;
  for(const n of d.values){if(!Number.isFinite(n)||Math.abs(n)>150)throw Error('유효하지 않은 지오이드고');lo=Math.min(lo,n);hi=Math.max(hi,n)}
  if(Math.abs(lo-m.rangeM[0])>.0002||Math.abs(hi-m.rangeM[1])>.0002||!(lo<0&&hi>0))throw Error('높이 범위 확인 실패');
  for(const c of d.checks||[])if(Math.abs(d.values[c.row*g.cols+c.col]-c.valueM)>.0002)throw Error('검증 지점 불일치');
  for(const row of [0,180])for(let col=1;col<360;col++)if(Math.abs(d.values[row*360+col]-d.values[row*360])>.001)throw Error('극점 자료 불일치');
  d.values=new Float64Array(d.values);return d;
 }
 async function load(retry=false){
  if(promise&&!retry)return promise;
  status='loading';error='';
  promise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
   try{
    const response=await fetch('./data/earth-global/egm2008-global.json?v=1',{signal:controller.signal});
    if(!response.ok)throw Error('HTTP '+response.status);
    data=validate(await response.json());status='ready';meshes.clear();coastlines=null;
    if(active())state.formation=reduced?1:0;
   }catch(e){data=null;status='error';error=String(e);console.error('Global EGM2008:',e)}
   finally{clearTimeout(timer);if(active())renderUI()}
   return data;
  })();return promise;
 }
 // Bilinear interpolation on the simplified display grid. Separate from the
 // map's existing 2.5-minute EGM2008 sampler; longitude has no duplicated seam.
 function sample(lat,lon){
  if(!data||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90)return null;
  const y=90-lat,i=Math.min(179,Math.floor(y)),v=y-i,x=wrap(lon)+180,j=Math.floor(x),k=(j+1)%360,u=x-j;
  const a=data.values[i*360+j],b=data.values[i*360+k],c=data.values[(i+1)*360+j],d=data.values[(i+1)*360+k];
  return (1-v)*((1-u)*a+u*b)+v*((1-u)*c+u*d);
 }
 function vertex(lat,lon,n){
  const p=lat*DEG,l=lon*DEG,c=Math.cos(p),s=Math.sin(p),q=1/Math.sqrt(1-E2*s*s),nx=c*Math.sin(l),nz=c*Math.cos(l);
  return {lat,lon,n,x:q*nx,y:q*(1-E2)*s,z:q*nz,nx,ny:s,nz};
 }
 function mesh(step){
  if(meshes.has(step))return meshes.get(step);
  const vertices=[],faces=[],rows=180/step+1,cols=360/step+1;
  for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
   const lat=90-i*step,lon=-180+j*step;vertices.push(vertex(lat,lon,sample(lat,lon)));
  }
  for(let i=0;i<rows-1;i++)for(let j=0;j<cols-1;j++){
   const k=i*cols+j,indices=[k,k+1,k+cols+1,k+cols];
   faces.push({indices,n:indices.reduce((sum,k)=>sum+vertices[k].n,0)/4});
  }
  const result={vertices,faces,rows,cols,step};meshes.set(step,result);return result;
 }
 function tint(n,light=1){
  const lo=data.meta.rangeM[0],hi=data.meta.rangeM[1];
  const stops=[[lo,[54,84,181]],[lo*.5,[43,161,198]],[0,[128,199,167]],[hi*.5,[239,207,110]],[hi,[211,94,68]]];
  let i=0;while(i<3&&n>stops[i+1][0])i++;
  const t=clamp((n-stops[i][0])/(stops[i+1][0]-stops[i][0]),0,1);
  return 'rgb('+stops[i][1].map((v,k)=>Math.round(clamp((v*(1-t)+stops[i+1][1][k]*t)*light,0,255))).join(',')+')';
 }
 function camera(w,h){
  const mobile=w<=600,panel=$('#rightPanel');
  const top=mobile?130:132,bottom=mobile?Math.max(220,panel.offsetTop-60):h-112;
  const usable=mobile?w:Math.max(170,w-panel.offsetWidth-60);
  const cx=(mobile?w*.5:usable*.53)+state.panX,cy=(top+bottom)/2+state.panY;
  const radius=Math.max(34,Math.min(usable*.34,(bottom-top)*.405))*state.zoom;
  const sl=Math.sin(state.lon),cl=Math.cos(state.lon),sp=Math.sin(state.lat),cp=Math.cos(state.lat);
  const project=(v,gain)=>{
   const lift=v.n*gain/A,x=v.x+lift*v.nx,y=v.y+lift*v.ny,z=v.z+lift*v.nz;
   const xx=x*cl-z*sl,zz=z*cl+x*sl,yy=y*cp-zz*sp;
   const nx=v.nx*cl-v.nz*sl,nz=v.nz*cl+v.nx*sl,ny=v.ny*cp-nz*sp,front=v.ny*sp+nz*cp;
   return {x:cx+radius*xx,y:cy-radius*yy,z:y*sp+zz*cp,front,light:clamp(.73+.21*front-.14*nx+.10*ny,.40,1.04)};
  };
  return {cx,cy,radius,project,mobile,top,bottom};
 }
 function line(ctx,vs,cam,gain,color,width=.65){
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let pen=false,last=null;
  for(const v of vs){const p=cam.project(v,gain);if(p.front<=.025){pen=false;last=null;continue}
   if(pen&&Math.hypot(p.x-last.x,p.y-last.y)<cam.radius*.35)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);
   pen=true;last=p;
  }ctx.stroke();
 }
 function globeLines(){
  if(coastlines)return coastlines;
  coastlines=LAND.flatMap(c=>c.rings).map(r=>r.map(([lon,lat])=>vertex(lat,lon,sample(lat,lon))));
  return coastlines;
 }
 function legend(ctx,cam,h){
  const x=cam.mobile?18:26,y=cam.mobile?$('#rightPanel').offsetTop-34:h-123,width=cam.mobile?174:235,[lo,hi]=data.meta.rangeM;
  const ramp=ctx.createLinearGradient(x,0,x+width,0);
  for(let i=0;i<=20;i++)ramp.addColorStop(i/20,tint(lo+(hi-lo)*i/20));
  ctx.fillStyle=ramp;ctx.fillRect(x,y,width,5);ctx.font=(cam.mobile?'9':'10')+'px sans-serif';ctx.fillStyle='#c6d8df';ctx.textAlign='left';
  ctx.fillText('EGM2008 · 지오이드고 N (m)',x,y-10);ctx.fillText(number(lo),x,y+18);ctx.textAlign='right';ctx.fillText(number(hi),x+width,y+18);
  ctx.textAlign='center';ctx.fillText('0',x+width*(-lo)/(hi-lo),y+18);ctx.textAlign='left';
  if(!cam.mobile){ctx.fillStyle='#94a9b5';ctx.fillText('파랑: 기준면 아래  /  주황: 기준면 위',x,y+36)}
 }
 function scaleUI(){
  const n=ui.gain.toLocaleString('ko-KR')+'×';
  if($('#earthGlobalScale'))$('#earthGlobalScale').textContent=n;
  if($('#earthGlobalGain'))$('#earthGlobalGain').textContent='굴곡 '+n+' · 색상은 실제 N(m)';
  if($('#earthGlobalRange'))$('#earthGlobalRange').value=String(100*Math.log(ui.gain)/Math.log(18000));
  const b=$('[data-earth-global="actual"]');if(b)b.setAttribute('aria-pressed',String(ui.gain===1));
 }
 function setScale(value){if(!Number.isFinite(value))return;ui.gain=Math.round(clamp(value,1,18000));scaleUI()}
 function panel(){
  const el=$('#rightPanel');el.hidden=false;el.classList.remove('planet-geoid-panel','earth-kn-panel','map-panel');el.classList.add('earth-global-panel','mobile-compact');
  const ready=status==='ready';
  el.innerHTML=`<div class="detail-top"><span>EARTH / EGM2008</span><button class="detail-close" data-action="deselect" aria-label="태양계로 돌아가기">${icon('close')}</button></div>
   <div class="detail-heading"><div class="detail-orb" style="--planet:#7cbea8" aria-hidden="true"></div><div><h2>지구 지오이드</h2><p>REAL DATA · GLOBAL</p></div></div>
   <p class="eg-coverage">대륙과 바다, 양 극지방까지<br>전 지구 EGM2008 수치 자료입니다.</p>
   ${ready?`<div class="eg-range"><small>웹 격자 N</small><span>${number(data.meta.rangeM[0])} ~ ${number(data.meta.rangeM[1])} m</span></div>
   <div class="eg-actions"><button data-earth-global="actual" aria-pressed="false">실제 비율 1×</button><button data-earth-global="suggested">굴곡 확대 보기</button></div>`:`<p class="eg-load" role="status">${status==='error'?'자료 로딩 실패 · 가상값으로 대체하지 않습니다.':'전 지구 자료를 불러오는 중입니다.'}</p>${status==='error'?'<button class="secondary full" data-earth-global="retry">다시 불러오기</button>':''}`}
   <button class="primary full" data-action="map">${icon('pin')}동아시아 지도 · KN / EGM</button>
   <button class="eg-source" data-earth-global="sources">${icon('info')}데이터 출처 · 기준면</button>
   <div class="eg-gain" id="earthGlobalGain"></div>
   <button class="mobile-detail-toggle" data-action="expand-detail" style="display:none">표시 옵션 ⌄</button>
   <details><summary>굴곡 배율 · 표시 옵션</summary><div>
    <label class="range-label" for="earthGlobalRange"><span>높이 확대 배율</span><output id="earthGlobalScale"></output></label>
    <input id="earthGlobalRange" type="range" min="0" max="100" step=".1" aria-label="EGM2008 높이의 시각적 확대 배율">
    ${toggleMarkup('grid','위·경도 격자')+toggleMarkup('reference','기준 타원체 선')+toggleMarkup('rotate','자동 회전')}
    <p class="eg-readout" id="earthGlobalReadout"></p>
    <p class="eg-muted">N × 표시 배율로 굴곡을 확대합니다. 산과 계곡의 지형이 아니며, 1×에서는 거의 매끈한 타원체로 보입니다.</p>
   </div></details>`;
  scaleUI();
 }
 function sync(){
  const on=active();document.body.classList.toggle('earth-global-active',on);
  const badge=$('.design-badge');
  if(on&&badge){if(badge.textContent!=='EGM2008 · GLOBAL')badge.dataset.beforeGlobal=badge.textContent;badge.textContent='EGM2008 · GLOBAL'}
  else if(badge?.textContent==='EGM2008 · GLOBAL')badge.textContent=badge.dataset.beforeGlobal||'KN18 × EGM2008';
  if(!on){$('#rightPanel').classList.remove('earth-global-panel');return}
  $('#sceneTitle').textContent='지구 · 전 지구 지오이드';
  $('#sceneSubtitle').textContent='EGM2008 실제 자료 · 전 지구 · WGS84 기준';
  $('#sceneHint').hidden=true;
  $('#sceneNotes').innerHTML='<strong>드래그 회전 · 휠 확대 / 축소</strong><br>색 = 실제 지오이드고 · 굴곡 = 표시 배율 × N';
  $('#statusText').textContent='전 지구 EGM2008 · '+(status==='ready'?'실제 자료':'자료 로딩');
  $('.footer-disclaimer').textContent='실제 모델 자료 · 굴곡 확대 · 지형 아님';
  $('#sceneCanvas').setAttribute('aria-label','전 지구 EGM2008 지오이드. 대륙과 바다 전체에 실제 모델 높이 표시. 드래그 회전, 휠 확대. 지구를 다시 클릭하면 KN·EGM 비교 지도로 이동합니다.');
 }
 renderDetail=function(){if(active()){panel();return}prior.renderDetail();$('#rightPanel').classList.remove('earth-global-panel')};
 renderUI=function(){prior.renderUI();sync();if(active()&&status==='idle')load()};
 resetCamera=function(){prior.resetCamera();if(active()){state.lon=80*DEG;state.lat=18*DEG}};
 focusSelected=function(){if(!active())return prior.focusSelected();resetCamera();toast('전 지구 지오이드를 화면에 맞췄습니다.')};
 formGeoid=function(){if(active()){if(status==='ready')state.formation=reduced?1:0;else load(status==='error');return}return prior.formGeoid()};
 drawGeoid=function(ctx,w,h,dt){
  if(!active())return prior.drawGeoid(ctx,w,h,dt);
  drawStars(ctx,w,h,.82);
  if(state.rotate&&!reduced&&!drag.active)state.lon+=dt*.000028;
  state.formation=Math.min(1,state.formation+dt/900);
  const cam=camera(w,h),{cx,cy,radius}=cam;
  hitObjects=[{id:'earth',x:cx,y:cy,r:radius*1.23,bodyR:radius}];
  if(!data){ctx.save();ctx.strokeStyle='#4b687b';ctx.beginPath();ctx.arc(cx,cy,radius,0,TAU);ctx.stroke();ctx.fillStyle='#b1c5d0';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText(status==='error'?'자료 로딩 실패':'전 지구 EGM2008 로딩 중',cx,cy);ctx.restore();return}
  const m=mesh(cam.mobile?3:2),gain=ui.gain*(1-Math.pow(1-state.formation,3));
  const pts=m.vertices.map(v=>cam.project(v,gain)),faces=[];
  for(const f of m.faces){const ps=f.indices.map(i=>pts[i]);if(ps.reduce((s,p)=>s+p.front,0)<-.01)continue;faces.push({f,ps,z:ps.reduce((s,p)=>s+p.z,0)/4})}
  faces.sort((a,b)=>a.z-b.z);
  ctx.save();
  const glow=ctx.createRadialGradient(cx,cy,radius*.4,cx,cy,radius*1.42);glow.addColorStop(0,'#64c9bd12');glow.addColorStop(1,'#64c9bd00');ctx.fillStyle=glow;ctx.fillRect(cx-radius*1.5,cy-radius*1.5,radius*3,radius*3);
  ctx.lineWidth=.55;
  for(const {f,ps} of faces){const color=tint(f.n,ps.reduce((s,p)=>s+p.light,0)/4);ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.stroke()}
  if(ui.coast)for(const vs of globeLines())line(ctx,vs,cam,gain,'#edf7e1aa',.7);
  if(state.grid){
   for(let i=30/m.step;i<m.rows-1;i+=30/m.step)line(ctx,m.vertices.slice(i*m.cols,(i+1)*m.cols),cam,gain,'#e5ffff30');
   for(let j=0;j<m.cols-1;j+=30/m.step)line(ctx,Array.from({length:m.rows},(_,i)=>m.vertices[i*m.cols+j]),cam,gain,'#e5ffff30');
  }
  if(state.reference){
   // Unfilled dashed references: negative N remains visible, never covered by
   // an opaque reference sphere. These are illustrative reference lines only.
   ctx.setLineDash([4,6]);
   const equator=Array.from({length:181},(_,i)=>vertex(0,-180+i*2,0));
   line(ctx,equator,cam,0,'#d9e8f178',.8);ctx.setLineDash([]);
  }
  legend(ctx,cam,h);ctx.restore();
  lastGeometry={vertices:m.vertices.length,faces:m.faces.length,stepDegrees:m.step,syntheticValues:0,coverage:'global'};
  if(performance.now()-lastReadout>180){lastReadout=performance.now();const el=$('#earthGlobalReadout');if(el)el.textContent='중심 방향 '+number(state.lat/DEG)+'° / '+number(wrap(state.lon/DEG))+'° · N '+number(sample(state.lat/DEG,state.lon/DEG))+' m (1° 격자 보간)'}
 };
 function sources(){
  prior.openDialog('earth-global');
  const m=data?.meta;
  $('#dialog').innerHTML=dialogHeader('지구 · 전 지구 지오이드 자료','EGM2008 / NGA / PROJ')+`<div class="dialog-copy">
   <h3>실제 전 지구 EGM2008 지오이드고</h3><p>NGA의 EGM2008 중력 모델을 바탕으로 GeographicLib가 생성하고 PROJ가 배포한 2.5분 전 지구 지오이드 격자입니다. KN 자료를 세계로 확장하거나 가상 함수로 채운 모형이 아닙니다.</p>
   <div class="formula-card"><div class="eq">표시 위치 = 타원체 위치 + kN · n̂</div><p>N: WGS84 타원체에 대한 지오이드고(m)<br>k: 화면에 표시한 높이 확대 배율<br>n̂: 타원체의 바깥쪽 단위 법선<br>평균값을 빼지 않습니다. 1×는 높이 과장을 없애며 색상은 동일한 N 값을 나타냅니다.</p></div>
   <h3>해상도와 원자료</h3><p>원본: 2.5분(1/24°), 4,321 × 8,640개 노드.<br>웹 자료: 원본에서 24칸마다 추출한 1°, 181 × 360개 노드(65,160개). 양 극점을 포함하며 경도는 순환 연결합니다.<br>화면망: PC 2°, 모바일 3°. 그 사이 값은 웹 격자의 쌍선형 보간입니다. 원본의 미세한 특징을 모두 나타내지는 않습니다.</p>
   ${m?`<p>웹 격자 범위: ${number(m.rangeM[0])} ~ ${number(m.rangeM[1])} m.<br>원본 격자 범위: ${number(m.nativeRangeM[0])} ~ ${number(m.nativeRangeM[1])} m.</p>`:''}
   <h3>지도 화면과의 관계</h3><p>이 3D 화면은 EGM2008 전 지구 시각화 한 가지입니다. 동아시아 지도는 KNGeoid18 / EGM2008 탭과 기존 고해상도 격자·관측점 비교를 그대로 사용합니다. 표시용 1° 자료를 지도 계산에 대체하지 않았습니다.</p>
   <p class="small-notice">산·계곡이나 지표 고도를 그린 모형이 아닙니다. 회전 중 음영도 달라지므로 수치는 색 범례와 함께 읽으세요. 격자 및 표시면은 교육용이며 기준계 실현·조석계의 추가 보정이나 측량 정확도 검증을 수행하지 않았습니다.</p>
   <div class="dialog-ref"><a href="https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84" target="_blank" rel="noopener">NGA · EGM2008 모델</a><br><a href="https://cdn.proj.org/us_nga_README.txt" target="_blank" rel="noopener">PROJ · 데이터 설명과 Public Domain 이용 조건</a><br><a href="https://cdn.proj.org/us_nga_egm08_25.tif" target="_blank" rel="noopener">원본 GeoTIFF</a> · <a href="https://doi.org/10.1029/2011JB008916" target="_blank" rel="noopener">Pavlis 외 (2012) 모델 논문</a><br><a href="./data/earth-global/egm2008-global.json" target="_blank" rel="noopener">웹에 사용한 전 지구 수치</a> · <a href="./data/earth-global/summary.json" target="_blank" rel="noopener">출처·해시·검증 기록</a></div>
   <details class="eg-hash"><summary>원본 SHA-256</summary><code>${SOURCE_HASH}</code></details></div>`;
 }
 function repairCopy(type){
  if(!['concept','help','data','gravity'].includes(type))return;
  // Earlier modules keep historical boilerplate; update text nodes only,
  // without changing any dialog controls, data, or event handlers.
  const replacements=[
   ['전 지구 지오이드의 굴곡은 개념 시각화이며, 이번 추가는 동아시아 지도에서의 모델 비교에 적용됩니다.','전 지구 3D는 실제 EGM2008 자료를 사용하며, 지도에서는 KNGeoid18과 EGM2008을 비교합니다.'],
   ['전 지구 구체는 지오이드 개념을 표현하기 위해 수학 함수로 변형합니다. 구체의 색상·굴곡은 실제 모델값이 아닙니다.','지구 전체의 색과 굴곡은 실제 EGM2008 전 지구 격자 값에 대응합니다. 굴곡만 표시 배율만큼 확대하며 1×로 전환할 수 있습니다.'],
   ['전 지구 지오이드 화면의 색상·굴곡은 여전히 개념 모형이며, 이 지역 자료로 전 지구 중력장을 만들지 않았습니다.','지구 전체 3D는 별도의 실제 EGM2008 전 지구 격자를 사용합니다. 지역 KN 자료를 세계로 확장하지 않았습니다.'],
   ['지구의 전 지구 구체와 가상 소행성은 여전히 개념 모형입니다.','지구 전체 3D는 EGM2008 실제 자료이며 가상 소행성만 개념 모형입니다.'],
   ['전 지구 구체는 개념 시각화입니다.','지구 전체 3D는 실제 EGM2008 자료 기반 시각화입니다.'],
   ['전 지구 구체는 여전히 개념 모형입니다.','지구 전체 3D는 실제 EGM2008 전 지구 격자입니다.'],
   ['지오이드 개념 시각화가 열립니다.','실제 EGM2008 전 지구 지오이드가 열립니다.'],
   ['구체의 색상·굴곡은 실제 모델값이 아닙니다.','지구 구체의 색상·굴곡은 실제 EGM2008 모델값을 사용합니다.']
  ];
  const walker=document.createTreeWalker($('#dialog'),NodeFilter.SHOW_TEXT);let node;
  while(node=walker.nextNode()){let text=node.nodeValue;for(const [a,b] of replacements)text=text.split(a).join(b);node.nodeValue=text}
 }
 openDialog=function(type){prior.openDialog(type);repairCopy(type)};
 document.addEventListener('click',e=>{const b=e.target.closest('[data-earth-global]');if(!b)return;const a=b.dataset.earthGlobal;if(a==='actual')setScale(1);else if(a==='suggested')setScale(10000);else if(a==='sources')sources();else if(a==='retry'){load(true);renderUI()}});
 document.addEventListener('input',e=>{if(e.target.id==='earthGlobalRange')setScale(Math.exp(Number(e.target.value)/100*Math.log(18000)))});
 const earth=planets.find(p=>p.id==='earth');if(earth)earth.desc='전 지구 EGM2008 실제 지오이드를 보고, 지도에서 한반도 관측값을 KN·EGM과 비교합니다.';
 Object.assign(window.GeoidAtlas,{
  earthVersion:'1.1.0',loadEarthGeoid:load,sampleEarthGeoid:sample,setEarthGeoidScale:setScale,
  getEarthGeoidMeshSamples:()=>data?mesh(sceneSize.w<=600?3:2).vertices.map(v=>({lat:v.lat,lon:v.lon,n:v.n})):[],
  getEarthGeoidState:()=>({active:active(),status,model:'EGM2008',coverage:'global',exaggeration:ui.gain,meta:data?.meta||null,grid:data?.grid||null,error,geometry:lastGeometry})
 });
 renderUI();
})();
