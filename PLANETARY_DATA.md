# 행성·달 지오이드 자료와 구현 기준

이 웹의 수성·금성·화성·달 기준면은 NASA PDS의 실제 수치 자료를 사용합니다. 지형 모델이나 색상 이미지에서 추정한 값이 아닙니다. 지구의 기존 관측·KN18·EGM2008 비교 자료는 수정하지 않았습니다. 지구 3D는 모델 탭 없이 EGM2008 전 지구 실제 격자를 표시합니다. 지도에는 KN·EGM2008 탭을 유지합니다. [전 지구 EGM2008 시각화와 적용 기준](EARTH_DATA.md)를 참고하세요. 가상 소행성은 여전히 개념 모형입니다.

## 원자료

| 천체 | 사용한 제품 | 출처와 관련 연구 |
|---|---|---|
| 수성 | JGMESS160A 완전 정규화 중력장 계수, `jgmess_160a_sha.tab` | NASA JPL / MESSENGER. [PDS 계수와 라벨](https://pds-geosciences.wustl.edu/messenger/mess-h-rss_mla-5-sdp-v1/messrs_1001/data/shadr/). Konopliv, Park & Ermakov (2020), [doi:10.1016/j.icarus.2019.07.020](https://doi.org/10.1016/j.icarus.2019.07.020). |
| 금성 | SHG120 `GEOIDGRD.DAT` 지오이드 이상 격자 | NASA PDS / Magellan Radio Science. [PDS 제품 디렉터리](https://pds-geosciences.wustl.edu/mgn/mgn-v-rss-5-gravity-l2-v1/mg_5201/gravity/). 라벨의 모델 이름을 그대로 사용하며 MGNP180U로 표시하지 않습니다. |
| 화성 | GMM-3의 3–90차 `ggmro_120_geoid_90.img` | NASA GSFC / MGS, Mars Odyssey, MRO. [PDS 제품 디렉터리](https://pds-geosciences.wustl.edu/mro/mro-m-rss-5-sdp-v1/mrors_1xxx/data/rsdmap/). Genova et al. (2016), [doi:10.1016/j.icarus.2016.02.050](https://doi.org/10.1016/j.icarus.2016.02.050). |
| 달 | GRGM900C를 600차까지 합성한 `gggrx_0900c_geoid_l600.img` | NASA GSFC / GRAIL A/B. [PDS 제품 디렉터리](https://pds-geosciences.wustl.edu/grail/grail-l-lgrs-5-rdr-v1/grail_1001/rsdmap/). Lemoine et al. (2014), [doi:10.1002/2014GL060027](https://doi.org/10.1002/2014GL060027). |

원본 PDS 라벨은 `data/planet-geoids/*-source.lbl`에 그대로 보관했습니다. `manifest.json`에는 원본 주소, SHA-256, 처리 방법, 격자, 수치 확인 지점과 출력 파일 해시가 있습니다. 빌더는 원자료 해시·크기·유한값·범위를 확인한 뒤에만 결과를 저장합니다.

## 서로 다른 기준면

**화성:** 기준 타원체 a=3396.0 km, 1/f=196.877360, 회전율 7.088218066303858e-5 rad/s라는 원본 정의를 따릅니다. 해당 격자는 3–90차 성분입니다. 완전한 저차항까지 포함한 절대 아레오이드로 해석하면 안 됩니다.

**달:** 기준구 R=1738.0 km, GM=4902.79996708864 km³/s², 회전율 0이라는 PDS 제품 정의를 따릅니다. 원본 0.125° 격자에서 8개 노드마다 추출하여 1°로 표시하므로 미세한 특징은 생략됩니다.

**금성:** 원본은 SHG120 geoid 이상(m)을 정의하지만 라벨에 기준면 반경과 퍼텐셜 수치는 명시하지 않습니다. 6051.8 km 구는 높이 편차를 표현하기 위한 시각적 지지면일 뿐입니다. 이를 공인 수직기준 또는 절대 반경으로 해석하면 안 됩니다. 원본 240°E 시작 격자를 순환 재배열하여 0°E부터 저장했습니다.

**수성:** 원본 160차 계수 중 0–90차를 사용합니다. R=2440.0 km, 원본 회전율 6.138514°/day와 GM을 사용하고, 이 웹이 선택한 W0=GM/R+omega²R²/3에 대해 등퍼텐셜면을 계산했습니다. 공인 수성 수직기준이 아닙니다. SHTOOLS `MakeGeoidGridDH`의 3차 Taylor 방법으로 원심 퍼텐셜을 포함했으며 외부 조석·영구조석 복원·내부 밀도 보정은 적용하지 않았습니다. 7개 별도 지점에서 전체 계수로 퍼텐셜을 재평가하여 잔차를 확인했습니다. [SHTOOLS 계산 설명](https://shtools.github.io/SHTOOLS/pymakegeoidgriddh.html).

## 시각화

색 범례는 각 천체의 저장된 N 값(m)에 대응합니다. 구면/타원체 지지면에서 반지름 방향으로 `확대 배율 × N`을 더해 그립니다. 이것은 기준면 편차의 교육용 표현이지 정밀 측량용 3D 기준면이 아닙니다. 1× 버튼은 시각적 높이 확대만 없애며, 색상은 같은 수치 범위를 유지합니다.

PC 화면망 2°, 모바일 3° 간격에서 쌍선형 보간하며, 경도는 순환 연결합니다. 원자료에 극점이 없는 격자의 마지막 0.5°는 가장자리 평균으로 시각적 연결을 보완합니다. JSON 저장 자릿수와 화면의 소수점은 관측 정확도를 뜻하지 않습니다. 천체마다 모델 기준과 배율·색 범위가 다르므로 굴곡이나 색만으로 중력의 세기를 직접 비교할 수 없습니다.

## 재현과 확인

`python scripts/build_planet_geoids.py`로 같은 원자료에서 출력합니다. 과학 계산에는 NumPy 1.26.4, SciPy 1.13.1, pyshtools 4.13.1을 고정했습니다. `tests/test_planet_geoids.py`는 격자 해시·보간값·배율·출처 링크·모바일·자료 로딩 실패를 검사하고 기존 지구 비교 테스트도 실행합니다.
