/* Model comparison and display-only sampling. Original observations/KN values
 * are never mutated. EGM2008 is built from the public NGA/PROJ 2.5' grid by
 * scripts/build_egm2008.py; this module checks every ID and coordinate on load. */
(function () {
 'use strict';
 const prior={renderUI,renderMapTools,selectDataPoint,closePointPopup};
 const settings={model:'kn',percent:100};
 const percentages=[100,50,25,10,5];
 let egm=null,egmValues=null,loadState='idle',loadPromise=null,loadError='';
 let ranking=null,sampleCache={key:'',points:[]},statsCache=null,rasterCache={};
 const active=()=>state.page==='app'&&state.mode==='map';
 try{const saved=JSON.parse(localStorage.getItem('geoid-atlas-model-view')||'null');if(saved){if(['kn','egm'].includes(saved.model))settings.model=saved.model;if(percentages.includes(saved.percent))settings.percent=saved.percent}}catch(_){}
 const panel=document.createElement('section');panel.id='modelControls';panel.hidden=true;panel.setAttribute('aria-label','지오이드 모델과 관측점 표시 비율');
 panel.innerHTML='<div class="model-caption">동아시아 · 지오이드 비교</div><div class="model-tabs" role="tablist" aria-label="비교할 지오이드 모델"><button id="model-kn" role="tab" data-model="kn" aria-controls="sceneCanvas" title="KNGeoid18">KN <small>KNGeoid18</small></button><button id="model-egm" role="tab" data-model="egm" aria-controls="sceneCanvas" title="EGM2008">EGM <small>2008</small></button></div><div class="density-label"><span>점 표시 비율</span><strong id="densityValue">100%</strong></div><div class="density-tabs" role="group" aria-label="전체 관측점 중 지도에 표시할 비율">'+percentages.map(p=>`<button data-density="${p}" aria-pressed="${p===100}" title="관측점 ${p}% 표시 · 지도 범위는 유지">${p}%</button>`).join('')+'</div><div class="density-count" id="densityCount"></div><div class="model-load" id="modelLoad" role="status" hidden></div>';
 $('#viewport').append(panel);
 const save=()=>{try{localStorage.setItem('geoid-atlas-model-view',JSON.stringify(settings))}catch(_){}};
 function modelName(model=settings.model){return model==='egm'?'EGM2008':'KNGeoid18'}
 function modelValue(p,model=settings.model){return model==='kn'?p.kn:egmValues&&Number.isFinite(egmValues[p.index])?egmValues[p.index]:null}
 function residual(p,model=settings.model){const n=modelValue(p,model);return p.N===null||n===null?null:p.N-n}
 function layerValue(p){return dataState.layer==='observed'?p.N:dataState.layer==='kn'?modelValue(p):residual(p)}
 function heightRange(){return [Math.floor(Math.min(KN.nmin,egm?egm.grid.nmin:14)),Math.ceil(Math.max(KN.nmax,egm?egm.grid.nmax:34))]}
 function buildRanking(){
  if(ranking)return ranking;
  // Progressive farthest-point sampling preserves geographic coverage. Every
  // lower percentage is a prefix of one fixed order, independent of the model.
  const n=observationPoints.length,x=new Float64Array(n),y=new Float64Array(n),dist=new Float64Array(n),used=new Uint8Array(n),order=[];
  dist.fill(Infinity);let pick=0;
  for(let i=0;i<n;i++){x[i]=observationPoints[i].lon*Math.cos(37*DEG);y[i]=observationPoints[i].lat;if(!Number.isFinite(x[i]+y[i]))throw new Error('Invalid observation coordinate')}
  for(let k=0;k<n;k++){
   order.push(pick);used[pick]=1;let best=-1,next=-1;
   for(let i=0;i<n;i++){if(used[i])continue;const dx=x[i]-x[pick],dy=y[i]-y[pick],d=dx*dx+dy*dy;if(d<dist[i])dist[i]=d;if(dist[i]>best){best=dist[i];next=i}}
   pick=next;
  }
  ranking=order;return order;
 }
 function displayPoints(){
  const key=[settings.percent,dataState.filter,dataState.selected].join('|');if(sampleCache.key===key)return sampleCache.points;
  const eligible=filteredPoints();let points;
  if(settings.percent===100)points=eligible.slice();
  else{
   const ids=new Set(eligible.map(p=>p.index)),n=Math.round(eligible.length*settings.percent/100);
   points=buildRanking().filter(i=>ids.has(i)).slice(0,n).map(i=>observationPoints[i]);
   // A searched point replaces one sampled point, never increases the count.
   const chosen=observationPoints[dataState.selected];
   if(chosen&&ids.has(chosen.index)&&points.length&&!points.some(p=>p.index===chosen.index))points[points.length-1]=chosen;
  }
  sampleCache={key,points};return points;
 }
 function statistics(model=settings.model){
  if(model==='kn')return {...dataStats};if(!egmValues)return null;if(statsCache)return {...statsCache};
  const valid=observationPoints.map(p=>({p,d:residual(p,'egm')})).filter(o=>o.d!==null),n=valid.length;
  const sum=valid.reduce((s,o)=>s+o.d,0),sum2=valid.reduce((s,o)=>s+o.d*o.d,0),largest=valid.reduce((a,b)=>!a||Math.abs(b.d)>Math.abs(a.d)?b:a,null);
  statsCache={total:observationPoints.length,valid:n,missing:observationPoints.length-n,mean:n?sum/n:null,rmse:n?Math.sqrt(sum2/n):null,mae:n?valid.reduce((s,o)=>s+Math.abs(o.d),0)/n:null,min:n?Math.min(...valid.map(o=>o.d)):null,max:n?Math.max(...valid.map(o=>o.d)):null,maxabs:largest?Math.abs(largest.d):null,largestIndex:largest?largest.p.index:null,outside:observationPoints.filter(p=>modelValue(p,'egm')===null).length,nmin:dataStats.nmin,nmax:dataStats.nmax};return {...statsCache};
 }
 function updateCount(){
  if(!active())return;const points=displayPoints(),pr=mapProjection(sceneSize.w,sceneSize.h);
  const count=points.filter(p=>{const q=pr.project(p.lon,p.lat);return q.x>=0&&q.x<=sceneSize.w&&q.y>=0&&q.y<=sceneSize.h}).length;
  const text=`${nf.format(points.length)} / ${nf.format(filteredPoints().length)}개 · 화면 안 ${nf.format(count)}개`;
  const el=$('#densityCount');if(el.textContent!==text)el.textContent=text;
 }
 function renderControls(){
  panel.hidden=!active();if(!active())return;
  panel.querySelectorAll('[data-model]').forEach(b=>{const on=b.dataset.model===settings.model;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1});
  panel.querySelectorAll('[data-density]').forEach(b=>{const on=Number(b.dataset.density)===settings.percent;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});
  $('#densityValue').textContent=settings.percent+'%';
  const el=$('#modelLoad');el.hidden=!(settings.model==='egm'&&loadState!=='ready');
  if(!el.hidden){el.textContent=loadState==='error'?'EGM 자료를 불러오지 못했습니다.':'EGM2008 자료를 불러오는 중…';if(loadState==='error'){const retry=document.createElement('button');retry.textContent='다시 시도';retry.onclick=()=>loadEGM(true);el.append(retry)}}
  $('#statusText').textContent=`동아시아 · ${modelName()} · 점 ${settings.percent}%`;
  const layer=$('[data-layer="kn"]');if(layer)layer.textContent=settings.model==='egm'?'EGM N':'KN18 N';
  const gridLabel=$('#gridToggle').previousElementSibling;if(gridLabel)gridLabel.textContent=(settings.model==='egm'?'EGM2008':'KN18')+' 모델 격자';
  $('#sceneCanvas').setAttribute('aria-label',`실제 동아시아 지도. ${modelName()} 비교, 관측점 ${settings.percent}% 표시. 드래그로 이동, 휠로 확대·축소, 관측점을 누르면 팝업이 열립니다.`);
  updateCount();
 }
 function refreshPopup(){
  const p=observationPoints[dataState.selected];if(!p)return;
  const el=$('#pointPopup'),expanded=!!el.querySelector('details[open]');el.innerHTML=pointPopupContent(p);const details=el.querySelector('details');if(details)details.open=expanded;positionPointPopup();
  $('#pointLive').textContent=`${p.id}. 관측 ${fmt(p.N)} m, ${modelName()} ${fmt(modelValue(p))} m, 잔차 ${fmt(residual(p),4,true)} m.`;
 }
 function setModel(model){if(!['kn','egm'].includes(model))return;settings.model=model;state.model=model;save();renderMapTools();refreshPopup();renderControls();if(model==='egm')loadEGM()}
 function setPercent(percent){if(!percentages.includes(percent))return;settings.percent=percent;save();renderControls()}
 panel.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.model||b.dataset.density){e.stopPropagation();closeMapPopovers()}if(b.dataset.model)setModel(b.dataset.model);if(b.dataset.density)setPercent(Number(b.dataset.density))});
 panel.querySelector('.model-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setModel(e.key==='Home'?'kn':e.key==='End'?'egm':settings.model==='kn'?'egm':'kn');$('#model-'+settings.model).focus()});
 async function loadEGM(retry=false){
  if(egm)return true;if(loadPromise&&!retry)return loadPromise;if(loadState==='error'&&!retry)return false;
  loadState='loading';loadError='';renderControls();
  loadPromise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
   try{
    const response=await fetch('./data/egm2008.json?v=1',{signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json(),g=data.grid;
    if(data.meta.model!=='EGM2008'||!Array.isArray(data.points)||data.points.length!==observationPoints.length||!g||g.values.length!==g.rows*g.cols)throw new Error('EGM 데이터 형식 불일치');
    const values=new Float64Array(observationPoints.length);values.fill(NaN);const seen=new Set();
    for(const record of data.points){const [index,id,lat,lon,n]=record,p=observationPoints[index];if(!p||seen.has(index)||p.id!==id||Math.abs(p.lat-lat)>1e-10||Math.abs(p.lon-lon)>1e-10||n!==null&&!Number.isFinite(n))throw new Error('EGM 관측점 매칭 오류');seen.add(index);if(n!==null)values[index]=n}
    if(!g.values.every(Number.isFinite)||!(g.rows>1&&g.cols>1&&g.stepLat>0&&g.stepLon>0))throw new Error('EGM 격자 검증 실패');
    egm=data;egmValues=values;statsCache=null;const computed=statistics('egm');
    if(computed.valid!==data.meta.statistics.valid||Math.abs(computed.rmse-data.meta.statistics.rmse)>1e-8)throw new Error('EGM 잔차 검증 실패');
    loadState='ready';rasterCache={};
    document.querySelector('.home-footer > span:last-child').innerHTML='관측 · KN18 · EGM2008 연결 <span class="footer-sep">·</span> 4,787개 관측점';
    $('.design-badge').textContent='KN18 × EGM2008';
    renderMapTools();refreshPopup();renderControls();return true;
   }catch(error){egm=null;egmValues=null;statsCache=null;loadState='error';loadError=String(error.message||error);console.error('EGM2008:',error);renderMapTools();refreshPopup();renderControls();return false}
   finally{clearTimeout(timer);loadPromise=null}
  })();return loadPromise;
 }
 function activeGrid(){return settings.model==='kn'?KN:egm?egm.grid:null}
 function raster(){
  const grid=activeGrid();if(!grid)return null;const range=heightRange(),key=settings.model+'|'+range.join('|');if(rasterCache[key])return rasterCache[key];
  const canvas=document.createElement('canvas');canvas.width=grid.cols;canvas.height=grid.rows;
  const c=canvas.getContext('2d'),image=c.createImageData(grid.cols,grid.rows);
  for(let r=0;r<grid.rows;r++)for(let col=0;col<grid.cols;col++){
   const n=settings.model==='kn'?knValues[(grid.rows-1-r)*grid.cols+col]:grid.values[r*grid.cols+col],rgb=heightColor(n,range[0],range[1]),i=(r*grid.cols+col)*4;image.data.set([...rgb,255],i);
  }
  c.putImageData(image,0,0);rasterCache[key]=canvas;return canvas;
 }
 function sampleEGM(lat,lon){
  if(!egm||!isNumber(lat)||!isNumber(lon))return null;const g=egm.grid,x=(lon-g.lon0)/g.stepLon,y=(g.latMax-lat)/g.stepLat;
  if(x<0||y<0||x>g.cols-1||y>g.rows-1)return null;
  const j=Math.min(Math.floor(x),g.cols-2),i=Math.min(Math.floor(y),g.rows-2),u=x-j,v=y-i,n=(dy,dx)=>g.values[(i+dy)*g.cols+j+dx];
  return (1-v)*((1-u)*n(0,0)+u*n(0,1))+v*((1-u)*n(1,0)+u*n(1,1));
 }
 pointColor=function(p){const v=layerValue(p);if(v===null)return '#7b8894';const range=dataState.layer==='observed'?[dataStats.nmin,dataStats.nmax]:heightRange();return `rgb(${dataState.layer==='residual'?residualColor(v):heightColor(v,range[0],range[1])})`};
 renderLegend=function(){
  const el=$('#dataLegend'),layer=dataState.layer,name=modelName(),range=layer==='observed'?[dataStats.nmin,dataStats.nmax]:heightRange();
  el.innerHTML=layer==='residual'?`<strong>${name} 잔차 <span>m</span></strong><div class="legend-ramp residual-ramp"></div><div class="legend-ticks"><span>≤ −0.20</span><span>0</span><span>≥ +0.20</span></div><p>관측 − ${name} · 두 모델 동일 색상 기준</p>`:`<strong>${layer==='observed'?'관측 N = h − H':name+' 모델 N'} <span>m</span></strong><div class="legend-ramp height-ramp"></div><div class="legend-ticks"><span>${fmt(range[0],2)}</span><span>${fmt(range[1],2)}</span></div><p>${layer==='observed'?'관측 높이 차이 · 모델 전환과 무관':'두 모델 동일 색상 기준 · 4점 보간'}</p>`;
  el.innerHTML+='<div class="legend-missing"><i></i> 값 없음'+(dataState.heatmap?' · 배경 '+name+' 높이':'')+'</div>';
 };
 pointPopupContent=function(p){
  const value=modelValue(p),d=residual(p),name=modelName(),pending=settings.model==='egm'&&loadState!=='ready';
  return `<div class="point-popup-header"><div><span class="point-popup-kicker">${name} · 관측점 비교</span><h3 id="popupTitle">${esc(p.id)}</h3><p class="popup-region">${esc(p.region)} · 관측점</p></div><button class="popup-close" data-point-close aria-label="관측점 팝업 닫기" title="닫기 (Esc)">${icon('close')}</button></div><div class="popup-coordinates">${fmt(p.lat,6)}° N &nbsp; ${fmt(p.lon,6)}° E</div><dl class="popup-values"><div><dt>관측 지오이드고</dt><dd>${fmt(p.N)}<small>m</small></dd></div><div><dt>${name}</dt><dd>${fmt(value)}<small>m</small></dd></div><div class="popup-delta"><dt>잔차 · 관측 − 모델</dt><dd>${fmt(d,4,true)}<small>m</small></dd></div></dl>${d===null?`<p class="point-warning">${pending?'EGM 자료 연결 전 · 임의값은 표시하지 않습니다.':p.N===null?'원본 높이 누락 · 잔차 계산 제외':'모델값 없음 · 잔차 계산 제외'}</p>`:''}<details class="popup-original"><summary>원본 높이 · 다른 모델 보기</summary><dl class="popup-values"><div><dt>타원체고 h</dt><dd>${fmt(p.h)}<small>m</small></dd></div><div><dt>표고 H</dt><dd>${fmt(p.H)}<small>m</small></dd></div><div><dt>${modelName(settings.model==='kn'?'egm':'kn')}</dt><dd>${fmt(modelValue(p,settings.model==='kn'?'egm':'kn'))}<small>m</small></dd></div></dl><p>N = h − H · 모델값은 주변 4점 보간<br>지오이드_데이터.xlsx · 원본 ${p.row}행</p></details><small class="popup-note">기준계 일치 가정 · 잠정 비교</small>`;
 };
 renderMapTools=function(){prior.renderMapTools();renderControls()};
 selectDataPoint=function(index,center=true){prior.selectDataPoint(index,center);refreshPopup();renderControls()};
 closePointPopup=function(focus=false){prior.closePointPopup(focus);if(active())updateCount()};
 renderUI=function(){prior.renderUI();renderControls();if(active())loadEGM()};
 function summaryCard(model){const s=statistics(model);return `<div class="file-card"><div class="spread"><strong>${modelName(model)}</strong><span>${s?'연결됨':'연결 대기'}</span></div>${s?`<div class="data-summary-inline"><div>비교 가능<strong>${nf.format(s.valid)}개</strong></div><div>평균 잔차<strong>${fmt(s.mean,4,true)} m</strong></div><div>RMSE<strong>${fmt(s.rmse)} m</strong></div><div>평균 절대 잔차<strong>${fmt(s.mae)} m</strong></div></div>`:'<p>EGM2008 자료가 연결되면 실제 계산 결과를 표시합니다.</p>'}</div>`}
 dataDialogContent=function(){return dialogHeader('KN · EGM 자료와 계산 기준','MODEL COMPARISON')+`<div class="dialog-copy"><p>지오이드_데이터.xlsx의 ${nf.format(observationPoints.length)}개 관측점과 KNGeoid18 원본을 그대로 유지했습니다. EGM2008은 NGA 공개 모델을 PROJ가 배포하는 2.5분 격자에서 추가했습니다.</p>${summaryCard('kn')}${summaryCard('egm')}<div class="formula-card"><div class="eq">N<sub>관측</sub> = h − H<br>ΔN = N<sub>관측</sub> − N<sub>모델</sub></div><p>두 모델 모두 관측점의 십진 위도·경도를 사용한 주변 4점 쌍선형 보간입니다. EGM2008의 기준 타원체는 WGS84입니다. 원본 표고를 H로 취급했으며, 중력값으로 역산하지 않습니다.</p></div><h3>점 표시 비율</h3><p>100%는 필터에 해당하는 모든 관측점입니다. 낮은 비율에서는 지역 분포를 넓게 유지하도록 고정 순서로 일부 점만 표시합니다. 모델을 바꿔도 같은 점들이 표시되고 지도 위치·확대 수준은 그대로입니다. 선택한 점이 표본에 없으면 표본 한 점과 교체해 개수를 유지합니다.</p><p><strong>이 비율은 화면 표시만 바꿉니다.</strong> 원본 자료, 위의 전체 통계, 전체 CSV에는 영향을 주지 않습니다. 필터로 모수를 줄인 경우 분모도 함께 표시합니다. 정수 개수로 반올림하므로 실제 비율은 아주 조금 다를 수 있습니다.</p><h3>해석 시 주의</h3><p>높이 누락 ${dataStats.missing}개는 관측 N·잔차 계산에서만 제외합니다. 큰 잔차는 임의로 제거하지 않았습니다. 표시 자릿수는 모델의 정확도를 뜻하지 않습니다.</p><div class="small-notice">${esc(egm?egm.meta.datumNotice:GEOID_DATA.datumNotice)}</div><p>hybrid_geoid.gri는 미연결입니다. 전 지구 지오이드의 굴곡은 개념 시각화이며, 이번 추가는 동아시아 지도에서의 모델 비교에 적용됩니다.</p><div class="dialog-ref">EGM2008: <a href="https://cdn.proj.org/us_nga_README.txt" target="_blank" rel="noopener">NGA / PROJ 자료·Public Domain 안내</a><br>계산 기록: <a href="./data/egm2008-summary.json" target="_blank" rel="noopener">원자료 해시·격자·검증값</a><br>배경 지도: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a></div><button class="secondary full" data-data-action="export">${icon('file')}전체 KN · EGM 비교 CSV 저장</button></div>`};
 exportComparison=function(){
  const cell=v=>{let s=v==null?'':String(v);if(/^[=+@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
  const header=['원본_엑셀행','점의번호','도엽명칭','위도_십진','경도_십진','표고_H_m','타원체고_h_m','관측_N_m','KNGeoid18_N_m','잔차_관측_KN_m','EGM2008_N_m','잔차_관측_EGM_m','비교상태'];
  const lines=[header,...observationPoints.map(p=>[p.row,p.id,p.region,p.lat,p.lon,p.H,p.h,p.N,p.kn,p.delta,modelValue(p,'egm'),residual(p,'egm'),p.status+(egm?'':' · EGM 미연결')])];
  const blob=new Blob(['\ufeff'+lines.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='지오이드_KN18_EGM2008_전체비교.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('표시 비율과 관계없이 전체 '+nf.format(observationPoints.length)+'개를 저장합니다.');
 };
 window.GeoidAtlasModels={displayPoints,activeGrid,raster,residual,missing:p=>layerValue(p)===null,updateCount};
 Object.assign(window.GeoidAtlas,{version:'0.8.0',setModel,setPointPercent:setPercent,loadEGM,sampleEGM,getModelState:()=>({...settings,status:loadState,error:loadError,displayed:displayPoints().length,eligible:filteredPoints().length}),getDisplayedPointIds:()=>displayPoints().map(p=>p.index),getDataSummary:()=>statistics(),getDataState:()=>({...dataState,...settings}),getPoints:()=>observationPoints.map(p=>({...p,egm:modelValue(p,'egm'),deltaEgm:residual(p,'egm'),activeModelValue:modelValue(p),activeResidual:residual(p)})),getVisiblePointCount:()=>displayPoints().length});
 renderControls();renderLegend();if(active())loadEGM();
})();
