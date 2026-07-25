import urllib.request
import json
import os
import ssl

# 1. 안정적인 전국 시군구 GeoJSON 데이터 (2013년 기준 오픈소스)
url = "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_municipalities_geo_simple.json"

print("🌐 전국 지도 데이터를 가져오는 중입니다...")

# (추가) 보안 인증(SSL) 에러를 방지하고 브라우저처럼 접속하는 코드
context = ssl._create_unverified_context()
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})

# 웹에서 JSON 데이터를 읽어옵니다.
response = urllib.request.urlopen(req, context=context)
data = json.loads(response.read())

daegu_features = []

# 2. 데이터 필터링: 대구 및 군위군 찾기
for feature in data['features']:
    # 파일 내 각 구/군의 고유 행정구역 코드를 확인합니다.
    code = feature['properties']['code']
    
    # 행정구역 코드: 대구광역시 소속은 '27'로 시작, 군위군은 '47720'입니다.
    if code.startswith('27') or code == '47720':
        
        # 군위군의 경우 과거 경북 데이터이므로 명확하게 이름을 다시 박아줍니다.
        if code == '47720':
            feature['properties']['name'] = '군위군'
            
        daegu_features.append(feature)

# 3. 대구 전용 GeoJSON 포맷으로 새롭게 조립하기
daegu_geojson = {
    "type": "FeatureCollection",
    "features": daegu_features
}

# 4. 파일 저장하기
os.makedirs('./data', exist_ok=True)
file_path = './data/daegu_boundaries.geojson'

with open(file_path, 'w', encoding='utf-8') as f:
    json.dump(daegu_geojson, f, ensure_ascii=False)

print(f"✅ 추출 완료! 총 {len(daegu_features)}개의 구/군 경계선 데이터가 '{file_path}'로 예쁘게 저장되었습니다.")