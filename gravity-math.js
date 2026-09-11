/* Educational LAND reductions. Units: m, mGal, g/cm^3.
 * Assumes observed gravity is already instrument/tide/drift reduced.
 * Missing terrain corrections are never replaced with zero.
 * WGS84 Somigliana normal gravity, first-order free-air, infinite slab.
 */
(function(root){
 'use strict';
 const G=6.67430e-11,SLAB=2*Math.PI*G*1e8;
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 function normal(lat){
  if(!finite(lat)||Math.abs(lat)>90)return null;
  const s=Math.sin(lat*Math.PI/180)**2;
  return 978032.533590406*(1+0.00193185265241*s)/Math.sqrt(1-0.0066943799901413165*s);
 }
 function calculate(input){
  const {lat,height,gravity,density=2.67,terrain=null,curvature=null}=input||{};
  const gamma=normal(lat),reasons=[];
  if(gamma===null)reasons.push('유효한 위도 필요');
  if(!finite(height))reasons.push('표고 없음');
  if(!finite(gravity))reasons.push('관측 중력값 없음');
  if(!finite(density)||density<=0||density>10)reasons.push('밀도는 0 초과 10 이하');
  const usable=reasons.length===0;
  const faCorrection=finite(height)?0.3086*height:null;
  const slabCorrection=finite(height)&&finite(density)&&density>0&&density<=10?SLAB*density*height:null;
  const freeAir=usable?gravity-gamma+faCorrection:null;
  const bouguer=usable?freeAir-slabCorrection:null;
  const tc=finite(terrain)&&terrain>=0?terrain:null,kc=finite(curvature)?curvature:null;
  const complete=usable&&tc!==null?bouguer+tc+(kc===null?0:kc):null;
  const warnings=[];
  if(finite(freeAir)&&Math.abs(freeAir)>300)warnings.push('이상값이 매우 큽니다. 원본 중력값·단위를 확인하세요.');
  if(finite(height)&&height<0)warnings.push('해수면 아래 관측점: 육상 평면식을 단순 적용한 결과입니다.');
  if(!finite(terrain)&&terrain!==null)warnings.push('지형 보정값이 올바르지 않습니다.');
  return {gamma,faCorrection,slabCorrection,freeAir,bouguer,complete,terrain:tc,curvature:kc,density,reasons,warnings,method:kc===null?'평면 근사 · 곡률 보정 미적용':'입력한 지형·곡률 보정 적용'};
 }
 function terrainSector(r1,r2,dz,angle,density=2.67){
  if(![r1,r2,dz,angle,density].every(finite)||r1<0||r2<=r1||angle<=0||density<=0)throw Error('Invalid terrain sector');
  if(dz===0)return 0;
  const d=dz*dz,term=d/(Math.hypot(r1,dz)+r1)-d/(Math.hypot(r2,dz)+r2);
  return G*density*1000*angle*Math.max(0,term)*1e5;
 }
 const api={version:'1.0.0',G,slabCoefficient:SLAB,normal,calculate,terrainSector};
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.GeoidGravityMath=api;
})(typeof globalThis!=='undefined'?globalThis:this);
