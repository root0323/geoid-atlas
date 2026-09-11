/* Plain-language provenance only. Numerical data, sampling, rendering,
 * reference conventions and the KN/EGM map controls are not modified.
 * Read after the existing planetary and whole-Earth modules.
 */
(function () {
 'use strict';
 if (window.GeoidAtlas?.sourceGuideVersion) return;
 const copy = {
  mercury: {
   name: '수성', model: 'JGMESS160A',
   origin: '수성 탐사선 메신저(MESSENGER)의 관측을 바탕으로 NASA 제트추진연구소(JPL)가 만든 중력 자료를 사용했습니다. NASA의 행성 자료 보관소(PDS)에 공개되어 있습니다.',
   meaning: '수성의 중력 자료로 계산한 높이 기준이 어디에서 높고 낮은지 보여줍니다. 수성 표면의 산이나 분화구 모양을 그린 것은 아닙니다.',
   caution: '공개 자료에 이 웹에서 정한 높이 기준을 적용해 계산했습니다. 공식적으로 정해진 수성의 높이 기준을 뜻하지는 않습니다.'
  },
  venus: {
   name: '금성', model: 'SHG120',
   origin: '금성 탐사선 마젤란(Magellan)의 관측으로 만든 중력 자료를 사용했습니다. NASA의 행성 자료 보관소(PDS)에서 공개한 자료입니다.',
   meaning: '금성의 중력에 따른 높이 차이를 색과 굴곡으로 나타냈습니다. 두꺼운 구름이나 지표의 산맥을 보여주는 그림은 아닙니다.',
   caution: '원자료가 높이를 비교하는 기준을 상세히 설명하지 않아, 바탕의 매끈한 구는 그림을 보여주기 위한 기준으로만 사용했습니다. 금성의 정확한 크기를 읽는 용도로는 사용할 수 없습니다.'
  },
  earth: {
   name: '지구', model: 'EGM2008',
   origin: '미국 국가지리정보국(NGA)이 만든 전 지구 중력 모델을 사용했습니다. 이를 바탕으로 GeographicLib가 만든 높이 자료를 PROJ가 배포합니다.',
   meaning: '중력에 따라 정한 지구의 높이 기준인 지오이드를 보여줍니다. 대륙뿐 아니라 바다와 극지방도 같은 자료로 그렸습니다. 파란색은 매끈한 기준면보다 낮은 곳, 주황색은 높은 곳입니다.',
   caution: '산과 계곡의 높이나 실제 지표 모양이 아닙니다. 이 지구 전체 그림은 EGM2008을 사용하고, 동아시아 지도에서는 KN과 EGM을 바꾸어 관측값과 비교할 수 있습니다.'
  },
  moon: {
   name: '달', model: 'GRGM900C',
   origin: '달을 관측한 그레일(GRAIL) 탐사선 두 대의 자료를 바탕으로 NASA 고다드우주비행센터가 만든 중력 모델을 사용했습니다.',
   meaning: '달의 중력에 따라 정한 높이 기준이 어디에서 높고 낮은지 보여줍니다. 달 표면의 산과 분화구를 그린 지형 지도는 아닙니다.',
   caution: '원자료에서 정한 높이 기준을 그대로 사용했습니다. 이 자료에는 달의 회전 영향이 포함되어 있지 않으며, 지구와 같은 높이 기준을 쓰는 것도 아닙니다.'
  },
  mars: {
   name: '화성', model: 'GMM-3',
   origin: 'NASA가 화성 탐사선들의 관측을 모아 만든 중력 모델입니다. 마스 글로벌 서베이어, 마스 오디세이, 마스 리코너선스 오비터의 자료를 사용했습니다.',
   meaning: '화성에서 중력에 따라 정한 높이 기준을 아레오이드라고 부릅니다. 이 그림은 그 기준이 어디에서 높고 낮은지 보여줍니다. 화성의 산맥이나 계곡 모양은 아닙니다.',
   caution: '이번 그림은 원자료에 담긴 일부 높이 변화를 보여줍니다. 화성의 높이 기준 전체를 빠짐없이 그린 모습은 아닙니다.'
  }
 };
 const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const isActive = () => state.page === 'app' && state.mode === 'geoid' && Object.hasOwn(copy, state.selected);
 const style = document.createElement('style');
 style.id = 'source-guide-style';
 style.textContent = `
 #dialog .source-guide{font-size:14px;line-height:1.85;overflow-wrap:anywhere}
 #dialog .source-guide h3{font-size:15px;line-height:1.5;margin:22px 0 8px;color:var(--text)}
 #dialog .source-guide p{margin:0 0 12px;color:#bacbd4;line-height:1.9}
 #dialog .source-model{display:inline-block;margin:4px 0 0;padding:6px 10px;border:1px solid #435c66;border-radius:6px;font-size:12px;color:#c6e8df}
 #dialog .source-reading{padding:14px 16px;border-left:3px solid #74cdb8;background:#74cdb808;border-radius:0 8px 8px 0;margin-top:19px}
 #dialog .source-reading strong{font-size:13px;color:#c6e8df}
 #dialog .source-reading p{font-size:13px;margin:5px 0 0}
 #dialog .source-links{display:flex;flex-wrap:wrap;gap:10px 18px;margin-top:8px}
 #dialog .source-links a{font-size:12px;text-decoration:underline;text-underline-offset:4px;line-height:1.7}
 #dialog .source-load-note{font-size:12px;color:#e8c89c;padding:10px 0 0}
 @media(max-width:600px){
  #dialog .source-guide{font-size:13px;line-height:1.8}
  #dialog .source-guide h3{font-size:14px;margin-top:19px}
  #dialog .source-reading{padding:11px 12px}
  #dialog .source-reading p{font-size:12px}
 }
 `;
 document.head.append(style);
 function getMetadata(body) {
  const info = body === 'earth' ? window.GeoidAtlas.getEarthGeoidState?.() : window.GeoidAtlas.getPlanetGeoidState?.();
  return info && (body === 'earth' || info.body === body) ? info : null;
 }
 function linksFor(body, meta) {
  if (body === 'earth') return [
   ['NGA 공식 모델 설명', 'https://earth-info.nga.mil/index.php?dir=wgs84&action=wgs84'],
   ['자료 제공처 · PROJ', 'https://cdn.proj.org/us_nga_README.txt'],
   ['원자료 보기', 'https://cdn.proj.org/us_nga_egm08_25.tif'],
   ['관련 연구', 'https://doi.org/10.1029/2011JB008916']
  ];
  if (!meta) return [['NASA 자료 보관소', 'https://pds-geosciences.wustl.edu/dataserv/gravity_models.htm']];
  const links = [['원자료 보기', meta.source], ['원자료 설명', meta.label]];
  if (meta.paperUrl && meta.paperUrl !== meta.label) links.push(['관련 연구', meta.paperUrl]);
  return links;
 }
 function openGuide(body = state.selected) {
  if (!Object.hasOwn(copy, body) || body !== state.selected || !isActive()) return false;
  const text = copy[body], info = getMetadata(body);
  // Reuse the existing accessible dialog, Escape key and focus restoration.
  openDialog('source-guide');
  const dialog = document.getElementById('dialog');
  const links = linksFor(body, info?.meta).filter(([,url]) => typeof url === 'string' && url.startsWith('https://'));
  dialog.innerHTML = dialogHeader(text.name + ' · 자료 출처', '자료와 그림 설명') + `
   <div class="dialog-copy source-guide" data-source-body="${escape(body)}" data-source-guide-version="1">
    <span class="source-model">사용한 모델 · ${escape(text.model)}</span>
    ${info?.status === 'ready' ? '' : '<p class="source-load-note" role="status">화면의 수치 자료는 아직 준비되지 않았습니다. 아래는 이 화면에서 사용하는 자료에 대한 설명입니다.</p>'}
    <h3>자료는 어디에서 왔나요?</h3><p>${escape(text.origin)}</p>
    <h3>이 그림은 무엇을 보여주나요?</h3><p>${escape(text.meaning)}</p>
    <h3>볼 때 알아두세요</h3><p>${escape(text.caution)}</p>
    <div class="source-reading"><strong>울퉁불퉁함은 보기 쉽게 키웠습니다</strong>
     <p>색은 높이 차이를 나타냅니다. 굴곡은 그 차이를 알아보기 쉽게 확대했습니다. ‘실제 비율 1×’를 누르면 높이 과장이 사라집니다.</p>
     <p>천체마다 색의 범위와 확대 정도가 다릅니다. 색이나 울퉁불퉁함만으로 중력의 세기를 비교하지 마세요. 이 그림은 이해를 돕기 위한 것으로, 정밀한 측량에는 사용하지 않습니다.</p>
    </div>
    <h3>출처 확인하기</h3><div class="source-links">${links.map(([label,url]) => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`).join('')}</div>
   </div>`;
  dialog.scrollTop = 0;
  dialog.focus({preventScroll:true});
  return true;
 }
 function renameButtons() {
  document.querySelectorAll('[data-planet-action="sources"], [data-earth-global="sources"]').forEach(button => {
   button.innerHTML = icon('info') + '자료 출처 · 그림 설명';
  });
 }
 const previousDetail = renderDetail;
 renderDetail = function () { previousDetail(); renameButtons(); };
 // These are the two existing entry points: source buttons and clicking an
 // already-selected planetary reference surface. Earth clicks still open map.
 document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-planet-action="sources"], [data-earth-global="sources"]');
  if (!button || button.disabled || !isActive()) return;
  event.preventDefault();event.stopImmediatePropagation();openGuide();
 }, true);
 const previousSelection = selectPlanet;
 selectPlanet = function (id, source) {
  if (id !== 'earth' && id === state.selected && isActive()) { openGuide(id);return; }
  return previousSelection(id, source);
 };
 Object.assign(window.GeoidAtlas, {sourceGuideVersion:'1.0.0', openSourceGuide:openGuide});
 renameButtons();
})();
