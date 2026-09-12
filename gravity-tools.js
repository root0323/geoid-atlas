/* Map-only gravity workspace. Original observations/KN/EGM are read-only.
 * First-order land anomalies, assumed mGal input. Complete values require
 * manual terrain correction or an explicitly labelled 20-km DEM estimate.
 * Optional curvature is the SIGNED value to ADD, never an implicit survey correction.
 */
(function(){
 'use strict';
 if(window.GeoidAtlas?.gravityVersion)return;
 const M=window.GeoidGravityMath,models=window.GeoidAtlasModels,S=window.GeoidGravityStages;
 if(!M||!models||!S)throw Error('Gravity dependencies unavailable');
 const previous={renderUI,renderDetail,renderMapTools,pointColor,renderLegend,pointPopupContent,selectDataPoint,renderPointSearch,openDialog};
 const modelPrevious={displayPoints:models.displayPoints,missing:models.missing,activeGrid:models.activeGrid,updateCount:models.updateCount};
 const opt={mode:new URLSearchParams(location.search).get('view')==='gravity'?'gravity':'geoid',layer:'freeAir',density:2.67,region:''},corrections=new Map(),jobs=new Map();
 const labels={freeAir:'프리에어',bouguer:'부게',complete:'완전부게'};
 const finite=n=>typeof n==='number'&&Number.isFinite(n),read=s=>String(s).trim()===''?null:Number(s);
 const onMap=()=>state.page==='app'&&state.mode==='map',active=()=>onMap()&&opt.mode==='gravity';
 let revision=0,values=new Map(),rankKey='',ranking=[],viewCache={key:'',points:[]};
 const eligible=p=>finite(p.gravity)&&finite(p.H)&&finite(p.lat)&&Math.abs(p.lat)<=90;
 const fullPoints=observationPoints.filter(eligible),regional=()=>fullPoints.filter(p=>!opt.region||p.region===opt.region);
 function rename(){
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
  while(n=walker.nextNode()){
   if(n.parentElement?.closest('script,style,textarea,code,pre'))continue;
   const s=n.nodeValue;if(!s.includes('동아시아'))continue;
   n.nodeValue=s.replace(/동아시아 지도/g,'지도').replace(/동아시아 ·/g,'지도 ·').replace(/^동아시아$/,'지도');
  }
  document.querySelectorAll('[aria-label],[title]').forEach(el=>{for(const a of ['aria-label','title']){const s=el.getAttribute(a);if(s?.includes('동아시아 지도'))el.setAttribute(a,s.replace(/동아시아 지도/g,'지도'))}});
 }
 const control=$('#modelControls'),nav=document.createElement('div');nav.className='map-workspace-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','지도 탐구 선택');
 nav.innerHTML='<button role="tab" id="workspace-geoid" data-gravity-mode="geoid" aria-controls="sceneCanvas" aria-selected="true">지오이드 비교</button><button role="tab" id="workspace-gravity" data-gravity-mode="gravity" aria-controls="sceneCanvas" aria-selected="false">중력 보정</button>';
 control.prepend(nav);
 const tools=document.createElement('section');tools.id='gravityControls';tools.hidden=true;tools.setAttribute('aria-label','중력 보정 1·2·3단계와 지역 선택');
 tools.innerHTML='<div class="gravity-tabs" role="tablist" aria-label="중력 보정 단계">'+S.tabs()+'</div><div id="gravityStageSummary" class="gs-summary" role="tabpanel"></div><label class="gravity-region"><span>지역</span><select id="gravityRegion" aria-label="중력 관측 지역"></select></label><p class="gravity-caption" id="gravityCaption"></p>';
 control.querySelector('.model-tabs').after(tools);
 const regionCounts=new Map();for(const p of fullPoints)regionCounts.set(p.region,(regionCounts.get(p.region)||0)+1);
 $('#gravityRegion').innerHTML='<option value="">전체 지역 · '+fullPoints.length+'점</option>'+[...regionCounts].sort((a,b)=>a[0].localeCompare(b[0],'ko')).map(([n,count])=>`<option value="${esc(n)}">${esc(n)} · ${count}점</option>`).join('');
 const settings=document.createElement('section');settings.id='gravitySettings';settings.hidden=true;
 settings.innerHTML='<label for="gravityDensity">가정한 암석 밀도 (g/cm³)</label><input id="gravityDensity" type="number" value="2.67" min="0.1" max="10" step="0.01" required><p>기본값 2.67은 계산을 위한 가정이며 실제 측정 밀도가 아닙니다. 바꾸면 부게 이상이 다시 계산됩니다.</p><p>원본 중력값의 단위는 mGal로 가정합니다. 측정기 오차·시간에 따른 변화 보정 여부는 확인되지 않아 결과는 잠정값입니다.</p><div id="gravitySettingsStatus" role="status"></div><button data-gravity-action="info">수식 · 계산 기준 보기</button>';
 $('#mapSettingsPopover').append(settings);
 function result(p){
  if(values.has(p.index))return values.get(p.index);
  const c=corrections.get(p.index);let terrain=null,curvature=null,method='미입력',densityMismatch=false;
  if(c){
   if(c.method==='dem20'){terrain=c.value*opt.density/c.density;method='20 km 지형 근사';}
   else if(Math.abs(c.density-opt.density)<1e-10){terrain=c.value;curvature=c.curvature;method='사용자 입력';}
   else{densityMismatch=true;method='밀도 변경 · 재입력 필요'}
  }
  const r=M.calculate({lat:p.lat,height:p.H,gravity:p.gravity,density:opt.density,terrain,curvature});
  Object.assign(r,{terrainMethod:method,densityMismatch,terrainSource:c?.source||null,terrainRadiusKm:c?.radiusKm||null});values.set(p.index,r);return r;
 }
 function invalidate(){revision++;values.clear();viewCache.key=''}
 function display(){
  const percent=GeoidAtlas.getModelState().percent,key=[opt.region,percent,dataState.selected,revision].join('|');if(viewCache.key===key)return viewCache.points;
  const pts=regional();let chosen;
  if(percent===100)chosen=pts.slice();
  else{
   if(rankKey!==opt.region||!ranking.length){
    rankKey=opt.region;ranking=[];const xs=pts.map(p=>p.lon*Math.cos(37*DEG)),ys=pts.map(p=>p.lat),used=new Uint8Array(pts.length),d=new Float64Array(pts.length);d.fill(Infinity);let pick=0;
    for(let k=0;k<pts.length;k++){ranking.push(pts[pick]);used[pick]=1;let best=-1,next=0;for(let i=0;i<pts.length;i++){if(used[i])continue;const dist=(xs[i]-xs[pick])**2+(ys[i]-ys[pick])**2;if(dist<d[i])d[i]=dist;if(d[i]>best){best=d[i];next=i}}pick=next}
   }
   chosen=ranking.slice(0,Math.round(pts.length*percent/100));
   const p=observationPoints[dataState.selected];if(p&&eligible(p)&&(!opt.region||p.region===opt.region)&&chosen.length&&!chosen.some(q=>q.index===p.index))chosen[chosen.length-1]=p;
  }
  viewCache={key,points:chosen};return chosen;
 }
 function updateCount(){
  if(!active())return modelPrevious.updateCount();
  const pts=display(),pr=mapProjection(sceneSize.w,sceneSize.h);let inside=0;
  for(const p of pts){const q=pr.project(p.lon,p.lat);if(q.x>=0&&q.x<=sceneSize.w&&q.y>=0&&q.y<=sceneSize.h)inside++}
  const text=`${nf.format(pts.length)} / ${nf.format(regional().length)}개 · 화면 안 ${inside}개`;
  if($('#densityCount').textContent!==text)$('#densityCount').textContent=text;
 }
 function sync(){
  const gravity=active();document.body.classList.toggle('gravity-map-active',gravity);tools.hidden=!gravity;settings.hidden=!gravity;
  nav.querySelectorAll('[data-gravity-mode]').forEach(b=>{const selected=b.dataset.gravityMode===opt.mode;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1});
  tools.querySelectorAll('[data-gravity-layer]').forEach(b=>{const selected=b.dataset.gravityLayer===opt.layer;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1});
  $('#gravityRegion').value=opt.region;
  const stage=S.byLayer(opt.layer);$('#gravityStageSummary').innerHTML=S.caption(opt.layer);
  if(gravity){
   control.querySelector('.model-caption').textContent='지도 · 중력 보정';
   $('#gravityCaption').textContent=opt.layer==='complete'?'지형 보정값이 필요합니다. 점을 눌러 입력하거나 주변 지형으로 추정하세요.':'관측 중력·표고가 있는 점만 표시 · 단위 mGal';
   $('#statusText').textContent=`지도 · ${stage.number}단계 · ${labels[opt.layer]} 이상 · 밀도 ${opt.density} g/cm³`;
   $('.footer-disclaimer').textContent='관측 단위 가정 · 육상 근사 · 잠정값';
   $('#sceneCanvas').setAttribute('aria-label',`지도. 중력 보정 ${stage.number}단계 ${stage.view}. 색은 ${stage.name}, 점을 누르면 ${stage.number}단계까지의 결과가 표시됩니다.`);
   $('#mapSettingsPopover .map-popover-head strong').textContent='중력 계산 설정';
  }else{
   control.querySelector('.model-caption').textContent='지도 · 지오이드 비교';
   $('#mapSettingsPopover .map-popover-head strong').textContent='지도 표시';
  }
  rename();if(onMap()){renderLegend();updateCount()}
 }
 function refresh(){
  if(!onMap())return;
  const p=observationPoints[dataState.selected],el=$('#pointPopup');
  if(p){const opened=[...el.querySelectorAll('details[open]')].map(d=>d.dataset.gravityDetail||d.className);el.innerHTML=pointPopupContent(p);el.querySelectorAll('details').forEach(d=>{if(opened.includes(d.dataset.gravityDetail||d.className))d.open=true});positionPointPopup();if(active())$('#pointLive').textContent=p.id+' 선택. '+S.byLayer(opt.layer).number+'단계. '+S.steps.filter(s=>s.number<=S.byLayer(opt.layer).number).map(s=>s.name+' '+fmt(result(p)[s.key],3)+' mGal').join(', ')}
 }
 function setMode(mode){if(!['geoid','gravity'].includes(mode))return;opt.mode=mode;closeMapPopovers();renderMapTools();sync();refresh()}
 function setLayer(layer){if(!Object.hasOwn(labels,layer))return;opt.layer=layer;renderMapTools();sync();refresh()}
 function setDensity(density){
  if(!finite(density)||density<=0||density>10)throw Error('밀도는 0 초과 10 이하로 입력하세요.');
  opt.density=density;$('#gravityDensity').value=density;invalidate();renderLegend();updateCount();refresh();sync();
 }
 function setCorrection(index,terrain,curvature=null,source='사용자 입력'){
  if(!observationPoints[index]||!finite(terrain)||terrain<0||terrain>1000||curvature!==null&&!finite(curvature))throw Error('지형 보정값은 0~1000 mGal, 곡률 보정값은 부호를 포함한 숫자로 입력하세요.');
  corrections.set(index,{value:terrain,curvature,density:opt.density,method:'manual',source:String(source||'사용자 입력'),calculatedAt:new Date().toISOString()});invalidate();refresh();sync();
 }
 function fitRegion(){
  const ps=regional();if(!ps.length)return;
  closePointPopup();const w=sceneSize.w,h=sceneSize.h,pr=mapProjection(w,h),projected=ps.map(p=>pr.project(p.lon,p.lat));
  const xs=projected.map(p=>p.x),ys=projected.map(p=>p.y),dx=Math.max(1,Math.max(...xs)-Math.min(...xs)),dy=Math.max(1,Math.max(...ys)-Math.min(...ys));
  const factor=Math.min((w<600?w*.65:(w-340)*.75)/dx,Math.max(100,h-340)/dy,16);
  changeZoom(factor);const next=mapProjection(w,h),lon=(Math.max(...ps.map(p=>p.lon))+Math.min(...ps.map(p=>p.lon)))/2,lat=(Math.max(...ps.map(p=>p.lat))+Math.min(...ps.map(p=>p.lat)))/2,q=next.project(lon,lat);
  state.panX+=(w<600?w*.5:(w+260)*.5)-q.x;state.panY+=h*.57-q.y;updateZoom();
 }
 function gravityColor(n){const t=clamp(n/150,-1,1),a=t<0?[59,118,182]:[199,84,53],q=Math.abs(t);return 'rgb('+a.map(v=>Math.round(218*(1-q)+v*q)).join(',')+')'}
 models.displayPoints=()=>active()?display():modelPrevious.displayPoints();
 models.activeGrid=()=>active()?null:modelPrevious.activeGrid();
 models.missing=p=>active()?result(p)[opt.layer]===null:modelPrevious.missing(p);
 models.updateCount=updateCount;
 pointColor=function(p){return active()?result(p)[opt.layer]===null?'#80919a':gravityColor(result(p)[opt.layer]):previous.pointColor(p)};
 renderLegend=function(){
  if(!active())return previous.renderLegend();
  $('#dataLegend').innerHTML=`<strong>${S.byLayer(opt.layer).number}단계 · ${labels[opt.layer]} 이상${opt.layer==='complete'?' · 보정값 기준':''} <span>mGal</span></strong><div class="legend-ramp" style="background:linear-gradient(90deg,${gravityColor(-150)},${gravityColor(0)},${gravityColor(150)})"></div><div class="legend-ticks"><span>≤ −150</span><span>0</span><span>≥ +150</span></div><p>현재 단계의 이상값 · 빈 원: 계산 자료 없음</p>`;
 };
 pointPopupContent=function(p){
  if(!active())return previous.pointPopupContent(p);
  const r=result(p),c=corrections.get(p.index),job=jobs.get(p.index),pending=job?.status==='loading',stage=S.byLayer(opt.layer),third=stage.number===3;
  const stateNote=r.complete===null?'지형 보정 필요':c?.method==='dem20'?'20 km 지형 근사':r.curvature===null?'평면 근사':'입력값 기준';
  const rows=S.resultRows(opt.layer,r,stateNote);
  return `<div class="point-popup-header"><div><span class="point-popup-kicker">중력 보정 · ${stage.number}단계 / 3</span><h3 id="popupTitle">${esc(p.id)}</h3><p class="popup-region">${esc(p.region)} · 밀도 ${opt.density} g/cm³</p></div><button class="popup-close" data-point-close aria-label="관측점 팝업 닫기">${icon('close')}</button></div>
   <div class="popup-coordinates">${fmt(p.lat,6)}° N &nbsp; ${fmt(p.lon,6)}° E</div>${S.progression(opt.layer)}<dl class="popup-values gravity-result">${rows}</dl>${S.calculation(opt.layer,r)}${S.navigation(opt.layer)}
   ${r.reasons.length?'<p class="gravity-warn">'+esc(r.reasons.join(' · '))+'</p>':''}${r.warnings.length?'<p class="gravity-warn">'+esc(r.warnings.join(' '))+'</p>':''}
   ${r.densityMismatch?'<p class="gravity-warn">밀도가 바뀌어 기존 지형 보정값을 적용하지 않았습니다. 새 밀도에 맞춰 다시 입력하세요.</p>':''}
   ${third?'<div class="gs-terrain-controls">':''}${third&&eligible(p)?`<button class="gravity-estimate" data-gravity-action="estimate" data-gravity-index="${p.index}" ${pending?'disabled':''}>${pending?'지형 자료 확인 중…':'주변 지형으로 보정 추정'}</button>`:''}
   ${third&&job?.status==='error'?'<p class="gravity-warn">'+esc(job.error)+' 값을 임의로 채우지 않았습니다.</p>':''}
   ${third?`<p class="gravity-note">${c?.method==='dem20'?'완전부게 값은 주변 20 km의 육상 지형 근사입니다. 먼 지형·곡률·해수/해저 효과는 빠져 있습니다.':'완전부게는 지형 보정값이 있어야 표시됩니다. 곡률값을 입력하지 않으면 평면 근사입니다.'}</p>
   <details class="gravity-extra" data-gravity-detail="input"><summary>지형 보정 TC 직접 입력</summary><form data-gravity-form="${p.index}">
    <label>지형 보정 TC (mGal)<input name="terrain" type="number" min="0" max="1000" step="any" required value="${r.terrain===null?'':r.terrain}" placeholder="미입력 · 0으로 간주하지 않음"></label>
    <details class="gs-curvature"><summary>추가 웹 설정 · 곡률 보정 (자료 외)</summary><label>곡률 보정 (mGal · 선택)<input name="curvature" type="number" step="any" value="${r.curvature===null?'':r.curvature}" placeholder="결과에 더할 값 · 부호 포함"></label><p class="gravity-note">첨부 자료의 3단계에는 없는 추가 항입니다. 입력하면 최종값에 더합니다.</p></details>
    <label>보정값 출처 (선택)<input name="source" type="text" maxlength="180" value="${c?.method==='manual'?esc(c.source):''}" placeholder="계산 자료나 관측 기록"></label>
    <p class="gravity-note">현재 밀도 ${opt.density} g/cm³에 맞는 값을 입력하세요. 곡률 보정이 0이면 직접 0을 입력합니다.</p><button type="submit">계산에 적용</button><button type="button" data-gravity-action="clear" data-gravity-index="${p.index}">입력 지우기</button><div class="gravity-form-status" role="status"></div>
   </form></details></div>`:''}
   <details class="gravity-extra" data-gravity-detail="values"><summary>원본 값 · 계산 과정</summary><dl class="popup-values"><div><dt>관측 중력 g</dt><dd>${fmt(p.gravity,3)}<small>mGal</small></dd></div><div><dt>표고 H</dt><dd>${fmt(p.H,4)}<small>m</small></dd></div><div><dt>위도에 따른 기준 중력</dt><dd>${fmt(r.gamma,3)}<small>mGal</small></dd></div><div><dt>프리에어 보정 (+)</dt><dd>${fmt(r.faCorrection,3)}<small>mGal</small></dd></div>${stage.number>=2?`<div><dt>부게 판 보정 (−)</dt><dd>${fmt(r.slabCorrection,3)}<small>mGal</small></dd></div>`:''}${third?`<div><dt>지형 보정 (+)</dt><dd>${fmt(r.terrain,3)}<small>mGal</small></dd></div><div><dt>추가 곡률 보정 (±)</dt><dd>${fmt(r.curvature,3,true)}<small>mGal</small></dd></div>`:''}</dl><p class="gravity-note">지오이드_데이터.xlsx · 원본 ${p.row}행<br>중력 단위 mGal 가정 · 관측값의 사전 보정 여부 미확인<br>${esc(r.terrainSource||'지형 보정 출처 없음')}</p></details><small class="popup-note">교육용 육상 근사 · 공인 중력 이상이 아닙니다.</small>`;
 };
 async function estimate(index){
  const p=observationPoints[index];if(!p||!eligible(p)||jobs.get(index)?.status==='loading')return;
  jobs.set(index,{status:'loading'});refresh();
  try{const c=await window.GeoidGravityTerrain.estimate(p);corrections.set(index,c);jobs.set(index,{status:'ready'});invalidate()}
  catch(e){jobs.set(index,{status:'error',error:String(e.message||e)})}
  if(active()){refresh();sync()}
 }
 function summary(){
  const pts=regional(),rs=pts.map(result),fa=rs.map(r=>r.freeAir).filter(finite),sb=rs.map(r=>r.bouguer).filter(finite),cb=rs.map(r=>r.complete).filter(finite);
  const stat=a=>({count:a.length,mean:a.length?a.reduce((s,n)=>s+n,0)/a.length:null,min:a.length?Math.min(...a):null,max:a.length?Math.max(...a):null});
  return {region:opt.region||'전체',total:observationPoints.length,gravityPresent:observationPoints.filter(p=>finite(p.gravity)).length,eligible:pts.length,freeAir:stat(fa),bouguer:stat(sb),complete:stat(cb),flagged:rs.filter(r=>r.warnings.length).length,density:opt.density};
 }
 function info(){
  openDialog('gravity-workspace');const s=summary();
  $('#dialog').innerHTML=dialogHeader('중력 보정 · 1·2·3단계','중력이상.pdf · 자료 기반 설명')+S.help(opt.layer,s,M.slabCoefficient);
  $('#dialog').scrollTop=0;$('#dialog').focus({preventScroll:true});
 }
 function csv(){
  const header=['점번호','지역','위도','경도','관측중력_mGal_단위가정','표고_m','밀도_g_cm3','기준중력_mGal','프리에어보정_mGal','부게판보정_mGal','프리에어이상_mGal','단순부게이상_mGal','지형보정_mGal','추가곡률보정_mGal','완전부게이상_mGal','지형보정방법','곡률적용','출처','주의'];
  const rows=observationPoints.filter(p=>!opt.region||p.region===opt.region).map(p=>{const r=result(p);return [p.id,p.region,p.lat,p.lon,p.gravity,p.H,opt.density,r.gamma,r.faCorrection,r.slabCorrection,r.freeAir,r.bouguer,r.terrain,r.curvature,r.complete,r.terrainMethod,r.method,r.terrainSource,[...r.reasons,...r.warnings,'단위·사전보정 여부 가정',r.terrainRadiusKm?'20 km 근사 · 먼 지형/해수/곡률 미반영':''].filter(Boolean).join(' · ')]});
  const cell=v=>{let s=v==null?'':String(v);if(typeof v==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
  return '\ufeff'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n');
 }
 function exportCSV(){const url=URL.createObjectURL(new Blob([csv()],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='중력보정_'+(opt.region||'전체')+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
 renderDetail=function(){previous.renderDetail();rename()};
 renderUI=function(){previous.renderUI();sync()};
 renderMapTools=function(){previous.renderMapTools();sync()};
 selectDataPoint=function(index,center=true){const p=observationPoints[index];if(active()&&p&&opt.region&&p.region!==opt.region){opt.region=p.region;viewCache.key=''}previous.selectDataPoint(index,center);if(active()){refresh();sync()}};
 renderPointSearch=function(){if(!active())return previous.renderPointSearch();const q=dataState.query.trim().toLocaleLowerCase('ko-KR'),points=regional().filter(p=>!q||(p.id+' '+p.region).toLocaleLowerCase('ko-KR').includes(q));$('#pointResults').innerHTML=points.length?points.slice(0,30).map(p=>`<button data-point-index="${p.index}">${esc(p.id)}<span>${esc(p.region)} · 중력 관측</span></button>`).join(''):'<p>해당 검색어·지역에 중력과 표고를 갖춘 관측점이 없습니다.</p>'};
 openDialog=function(type){previous.openDialog(type);rename()};
 nav.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();setMode(e.key==='Home'?'geoid':e.key==='End'?'gravity':opt.mode==='geoid'?'gravity':'geoid');$('#workspace-'+opt.mode).focus()});
 tools.querySelector('.gravity-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const keys=Object.keys(labels),i=keys.indexOf(opt.layer);setLayer(keys[e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3]);$('[data-gravity-layer="'+opt.layer+'"]').focus()});
 control.addEventListener('click',e=>{if(e.target.closest('[data-density]')&&active()){sync();refresh()}});
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('button');if(!b)return;
  if(b.dataset.gravityMode){e.preventDefault();e.stopImmediatePropagation();setMode(b.dataset.gravityMode);return}
  if(b.dataset.gravityLayer){e.preventDefault();e.stopImmediatePropagation();const fromPopup=!!b.closest('#pointPopup');setLayer(b.dataset.gravityLayer);if(fromPopup){const next=$('#pointPopup [data-gs-nav="next"]')||$('#pointPopup [data-gs-nav="previous"]');next?.focus({preventScroll:true});$('#pointPopup').scrollTop=0}return}
  if(active()&&b.dataset.dialog==='data'){e.preventDefault();e.stopImmediatePropagation();info();return}
  const action=b.dataset.gravityAction;if(!action)return;e.preventDefault();e.stopImmediatePropagation();
  if(action==='estimate')estimate(Number(b.dataset.gravityIndex));
  else if(action==='clear'){corrections.delete(Number(b.dataset.gravityIndex));jobs.delete(Number(b.dataset.gravityIndex));invalidate();refresh();sync()}
  else if(action==='info')info();else if(action==='export')exportCSV();
 },true);
 document.addEventListener('submit',e=>{
  const form=e.target.closest?.('[data-gravity-form]');if(!form)return;e.preventDefault();e.stopImmediatePropagation();
  try{setCorrection(Number(form.dataset.gravityForm),read(form.elements.terrain.value),read(form.elements.curvature.value),form.elements.source.value)}catch(error){form.querySelector('.gravity-form-status').textContent=error.message}
 },true);
 $('#gravityRegion').addEventListener('change',e=>{opt.region=e.target.value;viewCache.key='';fitRegion();sync()});
 $('#gravityDensity').addEventListener('change',e=>{try{setDensity(read(e.target.value));$('#gravitySettingsStatus').textContent=''}catch(error){$('#gravitySettingsStatus').textContent=error.message;e.target.value=opt.density}});
 const observer=new MutationObserver(()=>rename());observer.observe($('#dialog'),{childList:true});
 Object.assign(window.GeoidAtlas,{gravityVersion:'1.1.0',gravityStagesVersion:S.version,setGravityStage:n=>{const s=S.steps.find(s=>s.number===Number(n));if(s)setLayer(s.key)},setGravityMode:setMode,setGravityLayer:setLayer,setGravityDensity:setDensity,setGravityCorrection:setCorrection,
  getGravityResult:index=>observationPoints[index]?{...result(observationPoints[index])}:null,getGravityState:()=>({...opt,stage:S.byLayer(opt.layer).number,visibleResults:S.steps.filter(s=>s.number<=S.byLayer(opt.layer).number).map(s=>s.key),active:active(),displayed:active()?display().length:0,summary:summary()}),getGravityCSV:csv,estimateGravityTerrain:estimate});
 sync();
})();
