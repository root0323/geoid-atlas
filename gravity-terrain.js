/* Optional on-demand LAND terrain estimate, NOT survey-grade complete gravity.
 * Mapzen/AWS Terrarium tiles. Flat annular sectors 0–20 km; relative relief.
 * Curvature, distant terrain, local obstacles and water/bathymetric density
 * contrasts are not modelled. All results explicitly carry these limitations.
 * https://registry.opendata.aws/terrain-tiles/
 * https://github.com/tilezen/joerd/blob/master/docs/formats.md
 */
(function(){
 'use strict';
 const M=window.GeoidGravityMath,cache=new Map(),R=6371008.8,D=Math.PI/180;
 const LIMIT='주변 20 km의 육상 지형 근사입니다. 먼 지형·지구 곡률·해수와 해저 밀도·관측점 바로 주변의 세부 지형은 반영하지 않았습니다.';
 function coord(lat,lon,z){
  const n=2**z,x=(lon+180)/360*n,y=(1-Math.asinh(Math.tan(lat*D))/Math.PI)/2*n;
  return {z,x:Math.floor(x),y:Math.floor(y),px:Math.min(255,Math.max(0,Math.floor((x-Math.floor(x))*256))),py:Math.min(255,Math.max(0,Math.floor((y-Math.floor(y))*256)))};
 }
 function offset(lat,lon,range,bearing){
  const p=lat*D,l=lon*D,q=range/R;
  const a=Math.asin(Math.sin(p)*Math.cos(q)+Math.cos(p)*Math.sin(q)*Math.cos(bearing));
  const b=l+Math.atan2(Math.sin(bearing)*Math.sin(q)*Math.cos(p),Math.cos(q)-Math.sin(p)*Math.sin(a));
  return {lat:a/D,lon:((b/D+540)%360)-180};
 }
 async function tile(c){
  const key=c.z+'/'+c.x+'/'+c.y;if(cache.has(key))return cache.get(key);
  const promise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
   try{
    const response=await fetch('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/'+key+'.png',{signal:controller.signal,mode:'cors',credentials:'omit'});
    if(!response.ok)throw Error('지형 자료 HTTP '+response.status);
    const bitmap=await createImageBitmap(await response.blob());
    if(bitmap.width!==256||bitmap.height!==256){bitmap.close();throw Error('지형 타일 형식 오류')}
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
    return context.getImageData(0,0,256,256).data;
   }finally{clearTimeout(timer)}
  })();cache.set(key,promise);
  try{return await promise}catch(e){cache.delete(key);throw e}
 }
 function elevation(bytes,c){const i=(c.py*256+c.px)*4;if(bytes[i+3]===0)throw Error('지형 자료 결측');const h=bytes[i]*256+bytes[i+1]+bytes[i+2]/256-32768;if(!Number.isFinite(h)||h< -12000||h>9500)throw Error('지형 높이 확인 실패');return h}
 async function estimate(point,onProgress=()=>{}){
  if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lon)||Math.abs(point.lat)>80||!Number.isFinite(point.H)||point.H<0)throw Error('육상 관측점의 좌표와 표고가 필요합니다.');
  const edges=[0,30,60,100,160,250,400,630,1000,1600,2500,4000,6300,10000,16000,20000],sectors=48,parts=[];
  for(let i=0;i<edges.length-1;i++){
   const r1=edges[i],r2=edges[i+1],r=Math.sqrt((r1*r1+r2*r2)/2),z=r<2500?12:r<10000?10:8;
   for(let j=0;j<sectors;j++){const a=(j+.5)*2*Math.PI/sectors,q=offset(point.lat,point.lon,r,a);parts.push({r1,r2,coord:coord(q.lat,q.lon,z)})}
  }
  const origin=coord(point.lat,point.lon,12),unique=new Map();for(const c of [origin,...parts.map(p=>p.coord)])unique.set(c.z+'/'+c.x+'/'+c.y,c);
  const entries=[...unique.entries()],images=new Map();let next=0,done=0;
  await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
   while(next<entries.length){const [key,c]=entries[next++];images.set(key,await tile(c));onProgress(++done,entries.length)}
  }));
  const read=c=>elevation(images.get(c.z+'/'+c.x+'/'+c.y),c),z0=read(origin);
  if(z0< -20)throw Error('해양으로 분류되는 위치입니다. 해저·해수 밀도를 포함한 별도 보정값을 입력하세요.');
  let tc=0,seaSamples=0;
  for(const p of parts){let z=read(p.coord);if(z<0){seaSamples++;z=0}tc+=M.terrainSector(p.r1,p.r2,z-Math.max(0,z0),2*Math.PI/sectors,2.67)}
  if(!Number.isFinite(tc)||tc<0||tc>500)throw Error('지형 보정 추정값을 검토해야 합니다.');
  if(cache.size>128){for(const key of cache.keys()){if(cache.size<=96)break;cache.delete(key)}}
  return {value:tc,density:2.67,method:'dem20',radiusKm:20,source:'Mapzen Terrain Tiles / AWS',sourceURL:'https://registry.opendata.aws/terrain-tiles/',stationDEM:z0,seaSamples,samples:parts.length,tiles:entries.length,limitation:LIMIT,calculatedAt:new Date().toISOString()};
 }
 window.GeoidGravityTerrain={estimate,limitation:LIMIT,version:'1.0.0'};
})();
