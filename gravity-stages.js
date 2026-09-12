/* Three cumulative teaching stages, based on the user-supplied 중력이상.pdf
 * (pp. 6–18). Explanations and view composition only: existing observations,
 * WGS84/0.3086/slab calculations and DEM service are NOT changed.
 * '+' in a view label means show successive results, never add anomalies.
 */
(function(root){
 'use strict';
 const steps=[
  {key:'freeAir',number:1,name:'프리에어 이상',short:'프리에어',view:'프리에어 이상',action:'위도·고도 보정',pages:'6–10쪽 · 정리 18쪽',formula:'Δgfa = g − gt + FAC',
   description:'관측 높이가 높아지면 지구 중심에서 멀어져 중력이 작아집니다. 높이의 영향을 되돌리는 프리에어 보정값(FAC)을 더하고, 같은 위도의 표준중력(gt)을 뺍니다.',
   remains:'아직 관측점과 해수면 사이의 암석 질량 효과는 남아 있습니다.'},
  {key:'bouguer',number:2,name:'단순 부게 이상',short:'부게',view:'프리에어 + 부게',action:'질량 보정 추가',pages:'11–14쪽 · 정리 18쪽',formula:'ΔgB = Δgfa − BC',
   description:'1단계 뒤에도 관측점과 해수면 사이에 있는 암석의 중력 효과는 남습니다. 이를 관측점 높이만큼 두꺼운, 끝없이 넓고 평평한 판으로 가정해 그 효과(BC)를 뺍니다.',
   remains:'실제 산과 계곡은 평평한 판과 다릅니다. 이 차이는 다음 단계에서 다룹니다.'},
  {key:'complete',number:3,name:'완전부게 이상',short:'완전부게',view:'프리에어 + 부게 + 완전부게',action:'지형 보정 추가',pages:'15–16쪽 · 정리 18쪽',formula:'ΔgBC = ΔgB + TC',
   description:'2단계의 평평한 판과 실제 산·계곡의 차이를 지형 보정값(TC)으로 반영합니다. 자료의 설명에서는 산이 위로 끌어당기는 효과와 계곡에서 과하게 뺀 효과를 모두 더하는 방향으로 보정합니다.',
   remains:'세 결과를 함께 비교합니다. TC가 없으면 3단계 결과는 미계산이며, 0으로 대신하지 않습니다.'}
 ];
 const byLayer=key=>steps.find(s=>s.key===key)||steps[0];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const format=n=>Number.isFinite(n)?(n>=0?'+':'')+n.toFixed(3):'—';
 function tabs(){return steps.map(s=>`<button role="tab" data-gravity-layer="${s.key}" aria-controls="sceneCanvas gravityStageSummary" aria-label="${s.number}단계: ${s.view}"><span class="gs-number">${s.number}</span><span>${s.short}<small>${s.number===1?'위도·고도':s.number===2?'+ 질량 보정':'+ 지형 보정'}</small></span></button>`).join('')}
 function caption(layer){const s=byLayer(layer);return `<div class="gs-summary-head"><strong>${s.number}단계 · ${s.action}</strong><button data-gravity-action="info">단계 설명</button></div><p>${s.view}${s.number>1?' 비교':''}</p><small>지도 색: ${s.name} · 중력이상.pdf ${s.pages}</small>`}
 function progression(layer){const s=byLayer(layer);return `<div class="gs-progress" aria-label="현재 ${s.number}단계, ${s.action}">${steps.map(t=>`<span class="${t.number<=s.number?'gs-reached':''}" ${t.number===s.number?'aria-current="step"':''}>${t.number} ${t.number===1?'위도·고도':t.number===2?'질량':'지형'}</span>`).join('<i aria-hidden="true">→</i>')}</div>`}
 function resultRows(layer,r,stateNote){const s=byLayer(layer);return steps.filter(t=>t.number<=s.number).map(t=>`<div data-gravity-result="${t.key}" class="${t.number===s.number?'gravity-current':''}"><dt><span class="gs-row-number">${t.number}</span>${t.name}<small>${t.number===1?'위도·고도 반영':t.number===2?'프리에어에 질량 보정 추가':esc(stateNote)}</small></dt><dd>${r[t.key]===null?'<span class="gravity-pending">미계산</span>':format(r[t.key])+'<small>mGal</small>'}</dd></div>`).join('')}
 function calculation(layer,r){
  const s=byLayer(layer);
  const phrase=s.number===1?'관측 중력 − 표준중력 + 고도 보정':s.number===2?'1단계 결과 − 암석 판의 효과':'2단계 결과 + 지형 보정';
  const operation=s.number===1?`FAC ${format(r.faCorrection)}`:s.number===2?`BC ${Number.isFinite(r.slabCorrection)?'−'+r.slabCorrection.toFixed(3):'—'}`:`TC ${format(r.terrain)}`;
  const extra=s.number===3&&r.curvature!==null?`<p class="gs-extra-notice">추가 웹 설정: 입력한 곡률 보정 K ${format(r.curvature)} mGal도 최종값에 더했습니다. 이 추가 항은 첨부 자료의 3단계 식에는 없습니다.</p>`:'';
  return `<div class="gs-operation"><strong>${phrase}</strong><span>${operation} mGal</span></div>${extra}<p class="gs-reading">${s.number===1?'높이의 영향은 보정했지만, 암석 질량의 영향은 남아 있습니다.':s.number===2?'1단계와 2단계의 차이가 이번에 뺀 부게 판 보정량입니다.':r.complete===null?'TC를 입력하거나 아래 버튼으로 주변 지형 보정을 추정하세요. 앞 두 단계의 값은 그대로 비교할 수 있습니다.':'TC를 더한 뒤의 결과를 앞 두 단계와 비교해 보세요.'}</p>`;
 }
 function navigation(layer){const s=byLayer(layer);return `<div class="gs-navigation">${s.number>1?`<button data-gravity-layer="${steps[s.number-2].key}" data-gs-nav="previous">← ${s.number-1}단계</button>`:''}${s.number<3?`<button class="gs-next" data-gravity-layer="${steps[s.number].key}" data-gs-nav="next">${s.number+1}단계 · ${s.number===1?'부게':'지형'} 보정 추가 →</button>`:'<button data-gravity-action="info">세 단계 설명 보기</button>'}</div>`}
 function help(layer,summary,slab){const current=byLayer(layer);return `<div class="dialog-copy gravity-dialog gs-guide">
  <p class="gs-source">설명 기준: 첨부 자료 <strong>중력이상.pdf</strong> 6–18쪽. 아래 순서는 자료 18쪽의 보정 흐름을 따릅니다.</p>
  <p><strong>앞 단계의 결과에 보정을 하나씩 추가합니다.</strong> ‘프리에어 + 부게’는 두 이상값을 더하라는 뜻이 아니라 두 단계의 결과를 함께 비교한다는 뜻입니다. 지도 색은 현재 단계의 결과를, 점 팝업은 그 단계까지의 결과를 보여줍니다.</p>
  ${steps.map(s=>`<section class="gs-help-step ${s.key===layer?'gs-help-current':''}"><span class="gs-help-number">${s.number}</span><div><h3>${s.number}단계 · ${s.name}</h3><p class="gs-help-action">${s.action}</p><p>${s.description}</p><div class="gravity-equation">${s.formula}</div><p>${s.remains}</p><small>중력이상.pdf ${s.pages}</small></div></section>`).join('')}
  <p>g는 관측 중력, gt는 관측점 위도의 표준중력입니다. FAC는 프리에어 보정, BC는 암석 판의 효과, TC는 지형 보정입니다. 이상값과 보정량의 단위는 mGal입니다.</p>
  <h3>이 웹에서 값을 확인하는 방법</h3><p>지역과 관측점을 선택한 뒤 1 → 2 → 3단계를 이동하세요. 1단계는 프리에어만, 2단계는 프리에어·부게, 3단계는 세 이상값을 보여줍니다. 같은 점과 지도 위치는 유지됩니다.</p>
  <p>지형 보정이 없으면 3단계는 ‘미계산’입니다. ‘주변 지형으로 보정 추정’ 또는 직접 입력을 사용하세요. TC를 직접 0으로 입력한 경우에만 0을 적용합니다. 자료의 식에서 TC=0이면 2·3단계 값이 같고, TC가 양수면 3단계가 더 큽니다.</p>
  <details class="gs-method"><summary>첨부 자료와 기존 웹의 계산식 차이</summary>
   <p><strong>이번 변경은 단계와 설명을 바꾼 것입니다.</strong> 기존 관측값과 계산식은 유지했습니다. 자료의 근사 계수로 따로 계산하면 웹 수치와 차이가 생길 수 있습니다.</p>
   <p><strong>자료 6쪽</strong>은 gt = 978031.8 × (1 + 0.005278895 sin²φ + 0.000023462 sin⁴φ)를 제시합니다. 웹은 기존 WGS84 표준중력 계산을 유지합니다.</p>
   <p><strong>자료 8쪽</strong>: FAC = 0.308 × h. <strong>기존 웹</strong>: FAC = 0.3086 × H.</p>
   <p><strong>자료 11쪽</strong>: BC = 0.0419 × ρ × h, 밀도 2.67에서 약 0.112 × h. <strong>기존 웹</strong>: BC = ${Number(slab).toFixed(7)} × ρ × H.</p>
   <p>자료의 h는 해수면부터 관측점까지의 고도이며, 이 웹에서는 원본의 표고 H를 대응시킵니다. 지오이드 비교의 타원체고 h와 혼동하지 않도록 화면은 H로 표시합니다.</p>
   <p><strong>자료 15쪽</strong>: 완전부게 = 단순 부게 + TC. 기존 웹에 남아 있는 곡률 보정 K 입력은 자료에 없는 추가 설정입니다. 입력했을 때에만 그 값도 더하고 별도 안내합니다.</p>
  </details>
  <details class="gs-method"><summary>자료에 없는 웹의 지형 추정 기능과 한계</summary>
   <p>자동 TC는 Mapzen/AWS 공개 지형 자료로 선택한 관측점 주변 20 km를 근사한 값입니다. 이 방법이나 계산 범위는 첨부 자료가 제시한 것이 아니라 기존 웹의 구현입니다.</p>
   <p>먼 지형, 지구 곡률, 해수와 해저의 영향은 포함하지 않으므로 정밀한 완전부게 이상을 대신하지 않습니다. 원본 중력값 단위는 mGal로 가정했고 사전 계기·조석 보정 여부는 확인되지 않았습니다. 밀도 2.67 g/cm³도 가정입니다.</p>
   <p>자료 11·13·17쪽의 바다 보정은 육지와 별도로 설명되어 있습니다. 이 화면은 육상 관측점 계산이며, 해양식이나 해수 밀도차 보정은 적용하지 않습니다. 중력 또는 표고가 없는 점을 가상값으로 채우지 않습니다.</p>
  </details>
  <h3>현재 지역 자료</h3><p>${esc(summary.region)} · 계산 가능한 관측점 ${summary.eligible}개 / 지형 보정값까지 있는 점 ${summary.complete.count}개. 지역 전체를 빈틈없이 측정한 면 자료가 아닌 관측점 자료입니다.</p>
  <button class="secondary full" data-gravity-action="export">현재 지역 전체 중력 계산 CSV 저장</button><p class="gs-source">점 표시 비율이나 현재 단계와 관계없이 CSV는 기존 전체 계산 열을 유지합니다. 보정 입력은 현재 페이지에만 저장됩니다.</p>
 </div>`}
 // The new tablist owns its keyboard navigation. Scope focus to it: a closed
 // point popup can retain previous/next buttons with the same layer attribute.
 root.document?.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tab=event.target.closest?.('#gravityControls .gravity-tabs [data-gravity-layer]');
  if(!tab||!root.GeoidAtlas?.setGravityStage)return;
  event.preventDefault();event.stopImmediatePropagation();
  const i=byLayer(tab.dataset.gravityLayer).number-1;
  const target=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;
  root.GeoidAtlas.setGravityStage(target+1);
  root.document.querySelector('#gravityControls [data-gravity-layer="'+steps[target].key+'"]').focus();
 },true);
 root.GeoidGravityStages={version:'1.0.0',steps,byLayer,tabs,caption,progression,resultRows,calculation,navigation,help};
})(typeof globalThis!=='undefined'?globalThis:this);
