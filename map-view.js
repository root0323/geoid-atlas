/* GEOID ATLAS · real OSM basemap. Original observation data and KN18
 * interpolation are unchanged. Web Mercator tiles are fetched only for the
 * current visible view, after movement settles. No prefetch or offline export.
 */
(function () {
 'use strict';
 const original={renderUI,drawMap,mapProjection,changeZoom,updateZoom,centerMapPoint,dataDialogContent};
 const tileCache=new Map();let inflight=0,viewKey='',viewChanged=0,lastError=false;
 const active=()=>state.page==='app'&&state.mode==='map';
 const notice=document.createElement('div');notice.id='mapNetworkStatus';notice.hidden=true;notice.setAttribute('role','status');$('#viewport').append(notice);
 const scale=document.createElement('div');scale.id='realMapScale';scale.hidden=true;$('#viewport').append(scale);
 const mercatorY=lat=>(1-Math.asinh(Math.tan(clamp(lat,-85.05112878,85.05112878)*DEG))/Math.PI)/2;
 const inverseY=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))/DEG;
 function baseZoom(w,h){
  const small=w<=600,width=Math.max(200,w-64),height=Math.max(180,h-230);
  const lonSpan=small?11:24,latSpan=mercatorY(31)-mercatorY(44);
  return clamp(Math.log2(Math.min(width/(256*lonSpan/360),height/(256*latSpan))),3,8);
 }
 function projection(w,h){
  const top=h<500?82:118,bottom=h-98,z=clamp(baseZoom(w,h)+Math.log2(state.zoom),3,18),world=256*Math.pow(2,z);
  const cx=w/2+state.panX,cy=(top+bottom)/2+state.panY,ox=(128+180)/360*world-cx,oy=mercatorY(37.05)*world-cy;
  return {z,world,cx,cy,top,bottom,usable:w,s:world/360,ox,oy,
   project(lon,lat){return {x:(lon+180)/360*world-ox,y:mercatorY(lat)*world-oy}},
   invert(x,y){return {lon:(x+ox)/world*360-180,lat:inverseY((y+oy)/world)}}};
 }
 function networkStatus(text,retry=false){
  if(!active()){notice.hidden=true;return}
  if(notice.dataset.message===text&&String(retry)===notice.dataset.retry){notice.hidden=!text;return}
  notice.dataset.message=text;notice.dataset.retry=String(retry);notice.textContent=text;notice.hidden=!text;
  if(retry){const b=document.createElement('button');b.textContent='다시 시도';b.onclick=()=>{for(const [key,t] of tileCache)if(t.status==='error')tileCache.delete(key);viewChanged=0;lastError=false;networkStatus('지도를 다시 불러오는 중입니다.')};notice.append(b)}
 }
 function getTile(z,x,y,request){
  const count=Math.pow(2,z);if(y<0||y>=count)return null;
  const tx=((x%count)+count)%count,key=z+'/'+tx+'/'+y;
  let tile=tileCache.get(key);
  if(tile){tile.lastUsed=performance.now();return tile}
  if(!request||inflight>=6)return null;
  tile={status:'loading',lastUsed:performance.now(),image:new Image()};tileCache.set(key,tile);inflight++;
  tile.image.decoding='async';tile.image.referrerPolicy='strict-origin-when-cross-origin';
  tile.image.onload=()=>{tile.status='ready';inflight--};
  tile.image.onerror=()=>{tile.status='error';inflight--;lastError=true};
  const template=(window.GeoidAtlasMapConfig||{}).tileUrl||'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  tile.image.src=template.replace('{z}',z).replace('{x}',tx).replace('{y}',y);
  return tile;
 }
 function trimCache(){
  if(tileCache.size<=160)return;
  const old=[...tileCache.entries()].filter(([,t])=>t.status!=='loading').sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
  for(const [key] of old){if(tileCache.size<=128)break;tileCache.delete(key)}
 }
 function drawTiles(ctx,w,h,pr){
  ctx.fillStyle='#e5eff5';ctx.fillRect(0,0,w,h);
  const now=performance.now(),key=[pr.z,pr.ox,pr.oy,w,h].join('|');
  if(key!==viewKey){viewKey=key;viewChanged=now}
  const request=now-viewChanged>180&&!drag.active&&!touchGesture;
  const z=clamp(Math.round(pr.z),3,18),size=pr.world/Math.pow(2,z);
  const x0=Math.floor(pr.ox/size),x1=Math.floor((pr.ox+w)/size),y0=Math.max(0,Math.floor(pr.oy/size)),y1=Math.min(Math.pow(2,z)-1,Math.floor((pr.oy+h)/size));
  let ready=0,missing=0,errors=0;
  ctx.save();ctx.imageSmoothingEnabled=true;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const tile=getTile(z,x,y,request),px=x*size-pr.ox,py=y*size-pr.oy;
   if(tile&&tile.status==='ready'){ctx.drawImage(tile.image,px,py,size+.35,size+.35);ready++}
   else{missing++;if(tile&&tile.status==='error')errors++;ctx.strokeStyle='#d8e5ed';ctx.lineWidth=.5;ctx.strokeRect(px,py,size,size)}
  }
  ctx.restore();trimCache();
  if(errors&&now-viewChanged>800)networkStatus('일부 지도 타일을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.',true);
  else if(!ready&&missing&&now-viewChanged>500)networkStatus('실제 지도와 지명을 불러오는 중입니다.');
  else networkStatus('');
 }
 function drawScale(w,h,pr){
  const latitude=pr.invert(w/2,h/2).lat,mpp=156543.03392804097*Math.cos(latitude*DEG)/Math.pow(2,pr.z);
  const target=mpp*85,power=Math.pow(10,Math.floor(Math.log10(Math.max(1,target))));
  const n=target/power,meters=(n>=5?5:n>=2?2:1)*power,width=Math.max(20,meters/mpp);
  scale.style.width=width.toFixed(1)+'px';scale.textContent=meters>=1000?(meters/1000)+' km':meters+' m';
 }
 function sync(){
  const on=active();document.body.classList.toggle('real-map-active',on);scale.hidden=!on;
  if(!on){notice.hidden=true;return}
  $('#sceneSubtitle').textContent='실제 지도 위의 관측점을 눌러 비교하세요.';
  $('#statusText').textContent='동아시아 · 실제 지도 · 관측점 탐색';
  const source=$('#mapSource');source.hidden=false;
  source.innerHTML='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a><span class="map-credit-sep"> · </span><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">지도 오류 신고</a>';
  source.setAttribute('aria-label','지도 저작권 및 출처');
  $('#sceneCanvas').setAttribute('aria-label','실제 동아시아 지도. 드래그로 이동, 휠로 확대·축소. 관측점을 누르면 비교 팝업이 열립니다. 관측점 찾기로도 선택할 수 있습니다.');
 }
 renderUI=function(){original.renderUI();sync()};
 mapProjection=function(w,h){return active()?projection(w,h):original.mapProjection(w,h)};
 drawMap=function(ctx,w,h){
  const pr=projection(w,h),project=(lon,lat)=>pr.project(lon,lat);
  drawTiles(ctx,w,h,pr);
  if(dataState.heatmap){
   const raster=getKNRaster(),west=project(KN.lon0,KN.latMax).x,east=project(KN.lonMax,KN.latMax).x;
   ctx.save();ctx.globalAlpha=.30;ctx.imageSmoothingEnabled=true;
   // Reproject each latitude strip rather than stretching a linear-latitude
   // image onto Mercator. The numeric 4-node interpolation remains unchanged.
   for(let row=0;row<KN.rows-1;row++){
    const lat=KN.latMax-row*KN.stepLat,y0=project(KN.lon0,lat).y,y1=project(KN.lon0,lat-KN.stepLat).y;
    if(y1<0||y0>h)continue;
    ctx.drawImage(raster,0,row,KN.cols,1,west,y0,east-west,Math.max(.1,y1-y0));
   }
   ctx.restore();
  }
  mapHits=[];const radius=clamp(1.5*Math.pow(1.30,pr.z-6),1.4,5.2),mobile=w<=600;
  ctx.save();
  for(const p of filteredPoints()){
   const q=project(p.lon,p.lat);if(!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<0||q.x>w||q.y<0||q.y>h)continue;
   mapHits.push({index:p.index,x:q.x,y:q.y,r:Math.max(mobile?9:7,radius+3)});
   ctx.beginPath();ctx.arc(q.x,q.y,p.delta===null?radius+1.6:radius,0,TAU);
   if(p.delta===null){ctx.globalAlpha=1;ctx.strokeStyle='#647887';ctx.lineWidth=1.4;ctx.stroke()}
   else{ctx.globalAlpha=.86;ctx.fillStyle=pointColor(p);ctx.fill();if(pr.z>=9){ctx.globalAlpha=.8;ctx.strokeStyle='#fff';ctx.lineWidth=.75;ctx.stroke()}}
  }
  const selected=observationPoints[dataState.selected];
  if(selected){const q=project(selected.lon,selected.lat);ctx.globalAlpha=1;ctx.fillStyle='#14867525';ctx.beginPath();ctx.arc(q.x,q.y,16,0,TAU);ctx.fill();ctx.fillStyle='#fff';ctx.strokeStyle='#108573';ctx.lineWidth=2;ctx.beginPath();ctx.arc(q.x,q.y,7,0,TAU);ctx.fill();ctx.stroke();ctx.fillStyle='#108573';ctx.beginPath();ctx.arc(q.x,q.y,3,0,TAU);ctx.fill()}
  ctx.restore();hitObjects=[];drawScale(w,h,pr);positionPointPopup();updateZoom();
 };
 updateZoom=function(){
  if(active()){const z=projection(sceneSize.w,sceneSize.h).z;$('#toolZoom').textContent='Z '+z.toFixed(1);$('#zoomStatus').textContent='MAP · '+z.toFixed(1);return}
  original.updateZoom();
 };
 changeZoom=function(factor,anchor){
  if(!active())return original.changeZoom(factor,anchor);
  const w=sceneSize.w,h=sceneSize.h,pr=projection(w,h),point=anchor||{x:w/2,y:h/2},location=pr.invert(point.x,point.y),base=baseZoom(w,h);
  state.zoom=clamp(state.zoom*factor,Math.pow(2,3-base),Math.pow(2,18-base));
  const q=projection(w,h).project(location.lon,location.lat);state.panX+=point.x-q.x;state.panY+=point.y-q.y;updateZoom();
 };
 centerMapPoint=function(p,zoom){
  if(!active())return original.centerMapPoint(p,zoom);
  const w=sceneSize.w,h=sceneSize.h,target=Math.max(10,projection(w,h).z);
  state.zoom=Math.pow(2,target-baseZoom(w,h));state.panX=0;state.panY=0;
  const pr=projection(w,h),q=pr.project(p.lon,p.lat);state.panX=pr.cx-q.x;state.panY=pr.cy-q.y;updateZoom();
 };
 dataDialogContent=function(){return original.dataDialogContent().replace('배경 지도: 기존 Natural Earth 일반화 해안선.','배경 지도: OpenStreetMap 실제 지도 타일(Web Mercator). 확대하면 도로·지명이 표시되며 배경 지도에는 인터넷 연결이 필요합니다.').replace('측량·항법용 지도가 아닙니다.','관측 좌표는 원자료 그대로이며 기준계 변환은 적용하지 않았습니다. 측량·항법용 지도가 아닙니다.')};
 window.GeoidAtlas.version='0.7.0';window.GeoidAtlas.mapProvider='OpenStreetMap';
 window.GeoidAtlas.getMapState=()=>{if(!active())return null;const pr=projection(sceneSize.w,sceneSize.h);return {center:pr.invert(sceneSize.w/2,sceneSize.h/2),zoom:pr.z,loadedTiles:[...tileCache.values()].filter(t=>t.status==='ready').length,tileErrors:[...tileCache.values()].filter(t=>t.status==='error').length}};
 sync();
})();
