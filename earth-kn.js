/* Earth: KNGeoid18 only. Map KN/EGM2008 controls stay independent.
 * Reuses the uploaded KN grid and its existing bilinear sampler unchanged.
 * Outside that grid only a neutral reference ellipsoid is drawn, not N=0 data.
 */
(function () {
 'use strict';
 const prior={drawGeoid,renderUI,renderDetail,formGeoid,resetCamera,focusSelected,openDialog};
 const active=()=>state.page==='app'&&state.mode==='geoid'&&state.selected==='earth';
 const A=6378137,F=1/298.257223563,E2=F*(2-F);
 const center={lat:(KN.lat0+KN.latMax)/2,lon:(KN.lon0+KN.lonMax)/2};
 const ui={view:'globe',gain:12000};
 const meshes=new Map();
 const style=document.createElement('style');style.id='earth-kn-style';
 style.textContent=`
 .earth-kn-active .scene-top{max-width:calc(100% - 350px)}
 .earth-kn-active .scene-subtitle{max-width:360px}
 .earth-kn-active #sceneHint,.earth-kn-active #sceneNotes{display:none!important}
 #rightPanel.earth-kn-panel .detail-top{margin-bottom:12px}
 #rightPanel.earth-kn-panel .detail-heading{margin-bottom:12px}
 .earth-kn-coverage{font-size:10px;line-height:1.8;color:#a9c0cc;margin:0 0 12px}
 .earth-kn-range{display:flex;justify-content:space-between;gap:12px;font:11px var(--mono);color:#c3e7dc;padding:9px 0;margin:0 0 10px;border-block:1px solid #ffffff12}
 .earth-kn-range small{font:9px var(--font);color:#8ca6b2}
 .earth-kn-source{display:block;width:100%;font-size:10px;color:#93b5bc;padding:12px 0 0;text-align:left}
 .earth-kn-gain{font:10px var(--mono);color:#93cbbb;margin-top:10px}
 .earth-kn-actions{display:flex;gap:7px;margin:10px 0 14px}
 .earth-kn-actions button{flex:1;border:1px solid #506774;border-radius:5px;padding:7px 3px;font-size:10px}
 .earth-kn-actions button[aria-pressed='true']{color:#b7f5e4;border-color:#74d1b7;background:#74d1b710}
 .earth-kn-muted{color:#8b9ba7;font-size:10px;line-height:1.8}
 .earth-kn-hash{font:9px/1.7 var(--mono);overflow-wrap:anywhere}
 @media(max-width:600px){
  .earth-kn-active .scene-top{max-width:calc(100% - 36px)}
  #rightPanel.earth-kn-panel{bottom:81px;max-height:34dvh;padding:12px 14px}
  #rightPanel.earth-kn-panel .detail-heading{display:none}
  .earth-kn-coverage{font-size:9px;margin:0 0 7px}
  .earth-kn-range{font-size:10px;padding:6px 0;margin-bottom:5px}
  #rightPanel.earth-kn-panel .full{padding:8px;min-height:32px}
  .earth-kn-source{font-size:9px;padding-top:8px}
  .earth-kn-gain{font-size:9px;margin-top:7px}
  #rightPanel.earth-kn-panel .mobile-detail-toggle{padding:7px 0 0}
 }
 `;
 document.head.append(style);
 function inside(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=KN.lat0-1e-10&&lat<=KN.latMax+1e-10&&lon>=KN.lon0-1e-10&&lon<=KN.lonMax+1e-10}
 function sample(lat,lon){return inside(lat,lon)?sampleKN(clamp(lat,KN.lat0,KN.latMax),clamp(lon,KN.lon0,KN.lonMax)):null}
 // Geographic coordinates are mapped to an explicitly stated WGS84 display
 // ellipsoid. N is added along its outward normal, with a disclosed multiplier.
 function vertex(lat,lon,n=null){
  const p=lat*DEG,l=lon*DEG,c=Math.cos(p),s=Math.sin(p),q=1/Math.sqrt(1-E2*s*s);
  const nx=c*Math.sin(l),nz=c*Math.cos(l);
  return {lat,lon,n,x:q*nx,y:q*(1-E2)*s,z:q*nz,nx,ny:s,nz};
 }
 function gridVertices(lats,lons,fn){
  const vertices=[],faces=[];
  for(const lat of lats)for(const lon of lons)vertices.push(vertex(lat,lon,fn(lat,lon)));
  const cols=lons.length;
  for(let r=0;r<lats.length-1;r++)for(let c=0;c<cols-1;c++){
   const k=r*cols+c,indices=[k,k+1,k+cols+1,k+cols];
   const valid=indices.every(i=>vertices[i].n!==null);
   faces.push({indices,n:valid?indices.reduce((v,i)=>v+vertices[i].n,0)/4:null});
  }
  return {vertices,faces};
 }
 const reference=gridVertices(Array.from({length:37},(_,i)=>-90+i*5),Array.from({length:73},(_,i)=>-180+i*5),()=>null);
 const coastlines=LAND.flatMap(c=>c.rings).map(r=>r.map(([lon,lat])=>vertex(lat,lon,sample(lat,lon))));
 function gridAxis(first,step,count,stride){const a=[];for(let i=0;i<count-1;i+=stride)a.push(first+i*step);a.push(first+(count-1)*step);return a}
 function patch(mobile){
  const stride=ui.view==='region'?(mobile?6:4):8;
  if(!meshes.has(stride))meshes.set(stride,gridVertices(gridAxis(KN.lat0,KN.stepLat,KN.rows,stride),gridAxis(KN.lon0,KN.stepLon,KN.cols,stride),sample));
  return meshes.get(stride);
 }
 function tint(n,light=1){
  const stops=[[44,83,164],[51,163,182],[129,196,143],[232,205,111],[202,103,68]];
  const t=clamp((n-KN.nmin)/(KN.nmax-KN.nmin),0,1)*4,i=Math.min(3,Math.floor(t)),f=t-i;
  return 'rgb('+stops[i].map((v,k)=>Math.round((v*(1-f)+stops[i+1][k]*f)*light)).join(',')+')';
 }
 function camera(w,h){
  const mobile=w<=600,panel=$('#rightPanel'),bottom=mobile?Math.max(190,panel.offsetTop-62):h-155,top=mobile?124:135;
  const width=mobile?w:Math.max(160,w-panel.offsetWidth-70),height=Math.max(90,bottom-top);
  let radius=Math.min(width*.31,height*.42)*state.zoom;
  const tx=width*.5+(mobile?0:18),ty=(top+bottom)/2;
  const sl=Math.sin(state.lon),cl=Math.cos(state.lon),sp=Math.sin(state.lat),cp=Math.cos(state.lat);
  function rotate(v,exaggeration=0){
   const lift=v.n===null?0:v.n*exaggeration/A;
   const x=v.x+lift*v.nx,y=v.y+lift*v.ny,z=v.z+lift*v.nz;
   const xx=x*cl-z*sl,zz=z*cl+x*sl;
   const normalZ=v.nz*cl+v.nx*sl;
   return {x:xx,y:y*cp-zz*sp,z:y*sp+zz*cp,front:v.ny*sp+normalZ*cp};
  }
  let cx=tx+state.panX,cy=ty+state.panY;
  if(ui.view==='region'){
   radius=Math.min(width*.68/((KN.lonMax-KN.lon0)*DEG*Math.cos(center.lat*DEG)),height*.68/((KN.latMax-KN.lat0)*DEG))*state.zoom;
   const anchor=rotate(vertex(center.lat,center.lon,sample(center.lat,center.lon)),ui.gain);
   cx-=radius*anchor.x;cy+=radius*anchor.y;
  }
  const project=(v,gain=0)=>{const p=rotate(v,gain);return {x:cx+radius*p.x,y:cy-radius*p.y,z:p.z,front:p.front,light:clamp(.64+.30*p.front-.16*p.x+.12*p.y,.32,1.06)}};
  return {radius,cx,cy,tx,ty,project,mobile,bottom,width};
 }
 function paint(ctx,m,cam,gain,isData,w,h){
  const points=m.vertices.map(v=>cam.project(v,gain)),faces=[];
  for(const f of m.faces){
   if(isData&&f.n===null)continue;
   const ps=f.indices.map(i=>points[i]);
   if(ps.every(p=>p.front<=0)||ps.every(p=>p.x<0)||ps.every(p=>p.x>w)||ps.every(p=>p.y<0)||ps.every(p=>p.y>h))continue;
   faces.push({f,ps,z:ps.reduce((s,p)=>s+p.z,0)/4});
  }
  faces.sort((a,b)=>a.z-b.z);
  for(const {f,ps} of faces){
   const light=ps.reduce((s,p)=>s+p.light,0)/4;
   const color=isData?tint(f.n,light):'rgb('+[49,59,70].map(v=>Math.round(v*light)).join(',')+')';
   ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=.6;ctx.stroke();
  }
 }
 function line(ctx,vertices,cam,gain,color,width=1,requireData=false){
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let pen=false,last=null;
  for(const v of vertices){
   const p=cam.project(v,gain);
   if(p.front<=.005||(requireData&&v.n===null)){pen=false;last=null;continue}
   if(pen&&Math.hypot(p.x-last.x,p.y-last.y)<cam.radius*.25)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);
   pen=true;last=p;
  }
  ctx.stroke();
 }
 const border=[];
 for(let i=0;i<=64;i++)border.push(vertex(KN.lat0,KN.lon0+(KN.lonMax-KN.lon0)*i/64,sample(KN.lat0,KN.lon0+(KN.lonMax-KN.lon0)*i/64)));
 for(let i=1;i<=48;i++)border.push(vertex(KN.lat0+(KN.latMax-KN.lat0)*i/48,KN.lonMax,sample(KN.lat0+(KN.latMax-KN.lat0)*i/48,KN.lonMax)));
 for(let i=1;i<=64;i++)border.push(vertex(KN.latMax,KN.lonMax-(KN.lonMax-KN.lon0)*i/64,sample(KN.latMax,KN.lonMax-(KN.lonMax-KN.lon0)*i/64)));
 for(let i=1;i<=48;i++)border.push(vertex(KN.latMax-(KN.latMax-KN.lat0)*i/48,KN.lon0,sample(KN.latMax-(KN.latMax-KN.lat0)*i/48,KN.lon0)));
 function legend(ctx,cam,h){
  const x=cam.mobile?18:26,y=cam.mobile?$('#rightPanel').offsetTop-38:h-124,width=cam.mobile?166:218;
  const ramp=ctx.createLinearGradient(x,0,x+width,0);for(let i=0;i<=4;i++)ramp.addColorStop(i/4,tint(KN.nmin+(KN.nmax-KN.nmin)*i/4));
  ctx.fillStyle=ramp;ctx.fillRect(x,y,width,4);ctx.font=(cam.mobile?'9':'10')+'px sans-serif';ctx.textAlign='left';ctx.fillStyle='#c7d8df';
  ctx.fillText('KNGeoid18 · N (m)',x,y-10);ctx.fillText(KN.nmin.toFixed(3),x,y+17);ctx.textAlign='right';ctx.fillText(KN.nmax.toFixed(3),x+width,y+17);ctx.textAlign='left';
  if(!cam.mobile){ctx.fillStyle='#8c9ea9';ctx.fillText('회색은 자료 없는 기준 타원체',x,y+35)}
 }
 function resetEarth(view='globe'){
  ui.view=view;state.lon=center.lon*DEG;state.lat=(center.lat+(view==='region'?22:0))*DEG;
  state.panX=state.panY=0;state.zoom=1;state.rotate=false;updateZoom();
 }
 function updateScale(){
  const output=$('#earthKNScale');if(output)output.textContent=ui.gain.toLocaleString('ko-KR')+'×';
  const badge=$('#earthKNGain');if(badge)badge.textContent='굴곡 확대 '+ui.gain.toLocaleString('ko-KR')+'× · 색상은 실제 N';
  const range=$('#earthKNRange');if(range)range.value=String(100*Math.log(ui.gain)/Math.log(30000));
  const b=$('[data-earth-kn="actual"]');if(b)b.setAttribute('aria-pressed',String(ui.gain===1));
 }
 function panel(){
  const el=$('#rightPanel');el.hidden=false;el.classList.remove('planet-geoid-panel','map-panel');el.classList.add('earth-kn-panel','mobile-compact');
  el.innerHTML=`<div class="detail-top"><span>EARTH / KNGeoid18</span><button class="detail-close" data-action="deselect" aria-label="태양계로 돌아가기">${icon('close')}</button></div>
   <div class="detail-heading"><div class="detail-orb" style="--planet:#7eadb9"></div><div><h2>지구 지오이드</h2><p>KNGeoid18 · REGIONAL</p></div></div>
   <p class="earth-kn-coverage">색이 있는 영역만 KN 실제 자료입니다.<br>회색 영역은 자료 없는 기준 타원체입니다.</p>
   <div class="earth-kn-range"><small>지오이드고 N</small><span>${KN.nmin.toFixed(3)} ~ ${KN.nmax.toFixed(3)} m</span></div>
   <button class="primary full" data-earth-kn="focus">${icon('target')}${ui.view==='globe'?'KN 영역 확대':'지구 전체 보기'}</button>
   <button class="secondary full" data-action="map">${icon('pin')}동아시아 지도 · KN / EGM</button>
   <button class="earth-kn-source" data-earth-kn="sources">${icon('info')} 자료 출처 · 적용 범위</button>
   <div class="earth-kn-gain" id="earthKNGain"></div>
   <button class="mobile-detail-toggle" data-action="expand-detail" style="display:none">표시 옵션 ⌄</button>
   <details><summary>굴곡 배율 · 표시 옵션</summary><div>
   <label class="range-label" for="earthKNRange"><span>높이 확대 배율</span><output id="earthKNScale"></output></label>
   <input id="earthKNRange" type="range" min="0" max="100" step=".1" aria-label="KN 지오이드고 확대 배율">
   <div class="earth-kn-actions"><button data-earth-kn="actual">실제 비율 1×</button><button data-earth-kn="suggested">확대 보기</button></div>
   ${toggleMarkup('grid','위·경도 격자')+toggleMarkup('reference','기준 타원체')+toggleMarkup('rotate','자동 회전')}
   <p class="earth-kn-muted">관측 높이나 지형이 아니라 모델 N입니다. 경계는 자료 범위이며 실제 절벽이 아닙니다.</p></div></details>`;
  updateScale();
 }
 function sync(){
  const on=active();document.body.classList.toggle('earth-kn-active',on);
  if(!on){$('#rightPanel').classList.remove('earth-kn-panel');return}
  $('#sceneTitle').textContent='지구 · KN 지오이드';
  $('#sceneSubtitle').textContent='KNGeoid18 실제 격자 · 한반도 주변만 적용';
  $('#sceneHint').hidden=true;$('#statusText').textContent='KNGeoid18 · 지역 지오이드';
  $('.footer-disclaimer').textContent='KN 자료 범위만 표시 · 굴곡 확대 · 전 지구 모델 아님';
  $('#sceneCanvas').setAttribute('aria-label','KNGeoid18 실제 지역 지오이드. 회색은 자료 없는 기준 타원체. KN 영역 확대 버튼으로 자세히 보기. 지구를 다시 누르면 KN과 EGM을 비교하는 지도로 이동합니다.');
 }
 renderDetail=function(){if(active())panel();else{prior.renderDetail();$('#rightPanel').classList.remove('earth-kn-panel')}};
 renderUI=function(){prior.renderUI();sync()};
 resetCamera=function(){prior.resetCamera();if(active())resetEarth()};
 focusSelected=function(){if(active()){resetEarth('region');renderUI()}else prior.focusSelected()};
 formGeoid=function(){if(active()){state.formation=reduced?1:0;return}prior.formGeoid()};
 drawGeoid=function(ctx,w,h,dt){
  if(!active())return prior.drawGeoid(ctx,w,h,dt);
  drawStars(ctx,w,h,.8);if(state.rotate&&!reduced&&!drag.active)state.lon+=dt*.000028;
  state.formation=Math.min(1,state.formation+dt/900);const gain=ui.gain*(1-Math.pow(1-state.formation,3)),cam=camera(w,h);
  ctx.save();
  if(state.reference){paint(ctx,reference,cam,0,false,w,h);for(const r of coastlines)line(ctx,r,cam,0,'#a3b5bf65',.7)}
  if(state.grid&&state.reference){
   for(let lat=-60;lat<=60;lat+=30)line(ctx,Array.from({length:181},(_,i)=>vertex(lat,i*2)),cam,0,'#c3d7e222',.7);
   for(let lon=0;lon<360;lon+=30)line(ctx,Array.from({length:91},(_,i)=>vertex(-90+i*2,lon)),cam,0,'#c3d7e222',.7);
  }
  paint(ctx,patch(cam.mobile),cam,gain,true,w,h);
  for(const r of coastlines)line(ctx,r,cam,gain,'#eefff7b0',.85,true);
  line(ctx,border,cam,gain,'#8bebcf',1.2,true);
  if(ui.view==='globe'){
   const p=cam.project(vertex(center.lat,center.lon,sample(center.lat,center.lon)),gain);
   if(p.front>.15){ctx.strokeStyle='#8bd6c89c';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(p.x+6,p.y-6);ctx.lineTo(p.x+42,p.y-42);ctx.lineTo(p.x+139,p.y-42);ctx.stroke();ctx.fillStyle='#bddfda';ctx.font='10px sans-serif';ctx.fillText('KN 적용 범위',p.x+47,p.y-49)}
  }
  legend(ctx,cam,h);ctx.restore();
  hitObjects=[{id:'earth',x:ui.view==='region'?cam.tx:cam.cx,y:ui.view==='region'?cam.ty:cam.cy,r:ui.view==='region'?Math.max(w,h):cam.radius*1.12,bodyR:cam.radius}];
 };
 function sources(){
  prior.openDialog('concept');
  $('#dialog').innerHTML=dialogHeader('지구 · KNGeoid18','DATA SOURCE / REGIONAL ONLY')+`<div class="dialog-copy"><h3>사용 자료</h3><p>사용자가 첨부한 <strong>KNGeoid18.dat</strong>의 위도·경도·지오이드고(m) 격자입니다. 기존 지도에 내장된 ${KN.rows} × ${KN.cols}개 원본값과 같은 쌍선형 보간 함수를 재사용하며 원본값은 변경하지 않았습니다.</p><h3>적용 범위</h3><p>위도 ${KN.lat0}° ~ ${KN.latMax}° N<br>경도 ${KN.lon0}° ~ ${KN.lonMax}° E<br>격자 간격 ${KN.stepLat}° × ${KN.stepLon}°<br>원본 높이 범위 ${KN.nmin} ~ ${KN.nmax} m</p><p>KN은 이 파일 범위의 지역 모델입니다. 그 밖의 지역에는 지오이드고를 계산·채움·외삽하지 않습니다. 회색 부분은 위치를 이해하기 위한 기준 타원체이며 KN 지오이드고가 0이라는 뜻이 아닙니다.</p><h3>높이와 시각화</h3><p>화면 색상은 실제 모델 N(m)입니다. 지지 타원체의 법선 방향에 N × 확대 배율을 더해 그립니다. 1×는 높이 확대를 없애며 색 범위는 유지합니다. 경계에는 측면 벽을 만들지 않습니다. 화면망은 원격자 노드를 전 지구 보기에서 8칸마다, 확대 보기에서 PC 4칸·모바일 6칸마다 추출하고 끝 경계도 포함합니다. 출력망에서 생략된 세부 특징은 측정 정확도를 뜻하지 않습니다.</p><h3>기준계 주의</h3><p>시각적 지지면은 WGS84 타원체(a=6378137 m, 1/f=298.257223563)로 정했습니다. 첨부 파일의 기준계 실현·조석계·수직기준 메타데이터가 충분하지 않아 변환하지 않았습니다. 정밀 측량용 기준면이나 공인 정확도 검증 결과가 아닙니다.</p><h3>지도 비교는 별도</h3><p>동아시아 지도에서는 기존 KNGeoid18 / EGM2008 탭, 점 표시 비율, 관측점 팝업과 잔차 계산을 그대로 사용합니다. 지구 3D에는 EGM96 또는 EGM2008을 섞지 않습니다.</p><details><summary>첨부 원자료 SHA-256</summary><p class="earth-kn-hash">${esc(KN.sha256)}</p></details></div>`;
 }
 openDialog=function(type){
  if(type==='earth-kn'){sources();return}
  prior.openDialog(type);
  if(!['concept','help','data'].includes(type))return;
  const replacements=[
   ['전 지구 구체는 지오이드 개념을 표현하기 위해 수학 함수로 변형합니다. 구체의 색상·굴곡은 실제 모델값이 아닙니다.','지구는 KNGeoid18 자료 범위의 실제 N(m)을 표시합니다. 회색은 자료 없는 기준 타원체입니다. 굴곡은 표시된 배율만큼 확대합니다.'],
   ['지구의 전 지구 구체와 가상 소행성은 여전히 개념 모형입니다.','지구는 KNGeoid18 지역 자료만 표시하고 나머지는 회색 기준면으로 남깁니다. 가상 소행성만 개념 모형입니다.'],
   ['전 지구 구체는 여전히 개념 모형입니다.','지구 3D는 KNGeoid18 지역 자료만 표시합니다.'],
   ['전 지구 구체는 개념 시각화입니다.','지구 3D는 KNGeoid18 자료 범위만 시각화합니다.'],
   ['지오이드 개념 시각화가 열립니다.','KNGeoid18 지역 지오이드 시각화가 열립니다.']
  ];
  const walker=document.createTreeWalker($('#dialog'),NodeFilter.SHOW_TEXT);let n;
  while((n=walker.nextNode()))for(const [from,to] of replacements)n.nodeValue=n.nodeValue.split(from).join(to);
 };
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-earth-kn]');if(!b||!active())return;
  const a=b.dataset.earthKn;
  if(a==='focus'){resetEarth(ui.view==='globe'?'region':'globe');renderUI()}
  else if(a==='sources')sources();
  else if(a==='actual'||a==='suggested'){ui.gain=a==='actual'?1:12000;updateScale()}
 });
 document.addEventListener('input',e=>{if(e.target.id==='earthKNRange'){ui.gain=Math.round(Math.exp(Number(e.target.value)/100*Math.log(30000)));updateScale()}});
 Object.assign(window.GeoidAtlas,{
  earthVersion:'0.10.1',
  sampleEarthGeoid:sample,
  getEarthGeoidState:()=>({active:active(),model:'KNGeoid18',view:ui.view,exaggeration:ui.gain,coverage:{south:KN.lat0,north:KN.latMax,west:KN.lon0,east:KN.lonMax},source:KN.file,sourceSha256:KN.sha256,rangeM:[KN.nmin,KN.nmax],global:false,outsideValue:null}),
  getEarthKNMeshSamples:()=>patch(false).vertices.map(v=>({lat:v.lat,lon:v.lon,n:v.n}))
 });
 if(active())resetEarth();renderUI();
})();
