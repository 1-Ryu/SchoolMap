var mapOptions = {
    center: new naver.maps.LatLng(35.8714354, 128.601445),
    zoom: 12
};
var map = new naver.maps.Map('map', mapOptions);

var boundaryPolygons = []; 

console.log("🗺️ 실시간 대구 경계선 그리기 시작!");
var mapUrl = "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_municipalities_geo.json";

fetch(mapUrl)
    .then(function(response) {
        if (!response.ok) throw new Error("지도 데이터를 불러오지 못했습니다.");
        return response.json();
    })
    .then(function(geojson) {
        console.log("✅ 전국 지도 다운로드 완료!");

        var daeguFeatures = geojson.features.filter(function(f) {
            var code = f.properties.code || "";
            var name = f.properties.name || "";
            return code.startsWith('22') || name === '군위군';
        });

        console.log("🎯 대구/군위군 구역 " + daeguFeatures.length + "개 추출 완료!");

        daeguFeatures.forEach(function(feature) {
            var guName = feature.properties.name;
            
            var color = '#cccccc';
            if (['중구', '동구', '수성구'].includes(guName)) color = '#3498DB';
            else if (['서구', '북구'].includes(guName)) color = '#2ECC71';
            else if (['남구', '달서구'].includes(guName)) color = '#F1C40F';
            else if (['달성군'].includes(guName)) color = '#E74C3C';
            else if (['군위군'].includes(guName)) color = '#9B59B6';

            var geomType = feature.geometry.type;
            var coords = feature.geometry.coordinates;

            function drawSinglePolygon(coordinateArray) {
                var path = coordinateArray.map(function(coord) {
                    return new naver.maps.LatLng(coord[1], coord[0]);
                });

                var isChecked = document.getElementById('toggle-boundary').checked;

                var polygon = new naver.maps.Polygon({
                    map: isChecked ? map : null, 
                    paths: [path], 
                    fillColor: color,
                    fillOpacity: 0.15,
                    strokeColor: color,
                    strokeOpacity: 0.8,
                    strokeWeight: 2
                });

                boundaryPolygons.push(polygon);
            }

            if (geomType === 'Polygon') {
                drawSinglePolygon(coords[0]);
            } else if (geomType === 'MultiPolygon') {
                coords.forEach(function(polygon) {
                    drawSinglePolygon(polygon[0]);
                });
            }
        });
        
        console.log("🎉 대구 행정구역 경계선 그리기 대성공!");
    })
    .catch(function(error) {
        console.error("❌ 에러 발생:", error);
    });

function toggleBoundaries() {
    var isChecked = document.getElementById('toggle-boundary').checked;
    console.log("체크박스 상태:", isChecked, " / 다각형 개수:", boundaryPolygons.length);
    
    for (var i = 0; i < boundaryPolygons.length; i++) {
        if (isChecked) {
            boundaryPolygons[i].setMap(map); 
        } else {
            boundaryPolygons[i].setMap(null); 
        }
    }
}

var schoolDataMap = {};
var allEntries = [];
var visibleEntries = [];
var clusterMarkers = [];

var ZOOM_DISTRICT = 11;
var ZOOM_SCHOOL = 13;

var DISTRICT_COLORS = {
    '동부': '#3498DB',
    '서부': '#2ECC71',
    '남부': '#F1C40F',
    '달성': '#E74C3C',
    '군위': '#9B59B6'
};

function createClusterMarker(position, label, count, color, sizePx, zoomTo) {
    var marker = new naver.maps.Marker({
        position: position,
        map: map,
        icon: {
            content: '<div class="marker-fade" style="cursor:pointer;width:' + sizePx + 'px;height:' + sizePx + 'px;border-radius:50%;background:' + color +
                     ';color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
                     'font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,0.35);border:3px solid #fff;">' +
                     '<div style="font-size:12px;font-weight:bold;line-height:1.1;">' + label + '</div>' +
                     '<div style="font-size:15px;font-weight:bold;line-height:1.2;">' + count + '</div>' +
                     '</div>',
            size: new naver.maps.Size(sizePx, sizePx),
            anchor: new naver.maps.Point(sizePx / 2, sizePx / 2)
        },
        zIndex: 100
    });

    naver.maps.Event.addListener(marker, 'click', function() {
        map.setCenter(position);
        map.setZoom(zoomTo);
    });

    clusterMarkers.push(marker);
}

function groupCenter(entries) {
    var sumLat = 0, sumLng = 0;
    entries.forEach(function(e) {
        var pos = e.marker.getPosition();
        sumLat += pos.lat();
        sumLng += pos.lng();
    });
    return new naver.maps.LatLng(sumLat / entries.length, sumLng / entries.length);
}

function currentLevel() {
    var zoom = map.getZoom();
    if (zoom >= ZOOM_SCHOOL) return 'school';
    if (zoom >= ZOOM_DISTRICT) return 'district';
    return 'city';
}

// 같은 단계 안에서 줌만 움직일 때는 다시 그리지 않는다. (마커 수백 개를 지웠다 붙이면 깜빡인다)
var renderedLevel = null;
var shownSchools = [];  // 지금 지도에 올라가 있는 학교들

// 화면 밖 마커까지 지도에 올려두면, 네이버가 확대/축소 매 프레임마다 그 위치를 전부
// 다시 계산하느라 지도 전체가 버벅인다. 보이는 영역(+여유분)만 올린다.
function schoolsInView() {
    var b = map.getBounds();
    var sw = b.getSW(), ne = b.getNE();
    var padLat = (ne.lat() - sw.lat()) * 0.25;
    var padLng = (ne.lng() - sw.lng()) * 0.25;

    return visibleEntries.filter(function(e) {
        var p = e.marker.getPosition();
        return p.lat() >= sw.lat() - padLat && p.lat() <= ne.lat() + padLat &&
               p.lng() >= sw.lng() - padLng && p.lng() <= ne.lng() + padLng;
    });
}

// 전부 지웠다 다시 붙이면 화면이 튀므로, 들어온 것과 나간 것만 손댄다.
function syncSchoolMarkers() {
    var next = schoolsInView();
    var nextSet = new Set(next);
    var prevSet = new Set(shownSchools);

    shownSchools.forEach(function(e) {
        if (!nextSet.has(e)) e.marker.setMap(null);
    });
    next.forEach(function(e) {
        if (!prevSet.has(e)) e.marker.setMap(map);
    });

    shownSchools = next;
    lastSync = { lat: map.getCenter().lat(), lng: map.getCenter().lng(), zoom: map.getZoom() };
}

// 지도를 조금만 움직여도 매번 233개를 훑고 마커를 붙였다 떼면, 폰에서는 손가락을 뗀
// 직후에 화면이 멈칫한다. 화면 밖 여유분(25%)을 절반쯤 소진했을 때만 다시 계산한다.
var lastSync = null;

function needsSync() {
    if (!lastSync || lastSync.zoom !== map.getZoom()) return true;

    var b = map.getBounds(), sw = b.getSW(), ne = b.getNE();
    var c = map.getCenter();
    return Math.abs(c.lat() - lastSync.lat) > (ne.lat() - sw.lat()) * 0.12 ||
           Math.abs(c.lng() - lastSync.lng) > (ne.lng() - sw.lng()) * 0.12;
}

// 이동이 끝나는 순간은 사용자가 화면을 가장 주시하는 때다. 그 프레임을 붙잡지 않도록
// 한가할 때로 미룬다. (마커가 조금 늦게 채워지는 편이 멈칫하는 것보다 낫다)
var syncScheduled = false;

function scheduleSchoolSync() {
    if (syncScheduled) return;
    syncScheduled = true;

    var run = function() {
        syncScheduled = false;
        if (currentLevel() === 'school') syncSchoolMarkers();
    };

    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 300 });
    else setTimeout(run, 0);
}

function hideAllSchools() {
    shownSchools.forEach(function(e) { e.marker.setMap(null); });
    shownSchools = [];
}

function renderMarkers(force) {
    var level = currentLevel();
    var levelChanged = level !== renderedLevel;

    // 학교 단계에서는 이동·확대로 보이는 범위가 계속 바뀌므로 맞춰준다.
    // 단계가 바뀌거나 필터가 바뀐 때는 바로, 단순 이동은 미뤄서 처리한다.
    if (level === 'school') {
        if (levelChanged) {
            clusterMarkers.forEach(function(m) { m.setMap(null); });
            clusterMarkers = [];
        }
        renderedLevel = level;

        if (force || levelChanged) syncSchoolMarkers();
        else if (needsSync()) scheduleSchoolSync();
        return;
    }

    if (!force && !levelChanged) return;
    renderedLevel = level;

    clusterMarkers.forEach(function(m) { m.setMap(null); });
    clusterMarkers = [];
    hideAllSchools();

    if (visibleEntries.length === 0) return;

    allEntries.forEach(function(e) { e.infoWindow.close(); });

    if (level === 'district') {
        var groups = {};
        visibleEntries.forEach(function(e) {
            var d = e.rawData['district'] || '기타';
            (groups[d] = groups[d] || []).push(e);
        });
        Object.keys(groups).forEach(function(d) {
            var members = groups[d];
            createClusterMarker(groupCenter(members), d, members.length, DISTRICT_COLORS[d] || '#7F8C8D', 62, ZOOM_SCHOOL);
        });
    } else {
        createClusterMarker(groupCenter(visibleEntries), '대구', visibleEntries.length, '#2C3E50', 84, ZOOM_DISTRICT);
    }
}

// zoom_changed는 확대/축소 애니메이션 '도중에' 발생해서, 그때 마커를 갈아끼우면 화면이 튄다.
// idle은 지도 움직임이 완전히 끝난 뒤에 한 번만 발생하므로 교체가 자연스럽다.
naver.maps.Event.addListener(map, 'idle', function() { renderMarkers(); });

function getSchoolIcon(grade) {
    var mainColor = "#BDC3C7"; 
    var roofColor = "#7F8C8D"; 
    var flagColor = "#95A5A6"; 

    if (grade === "가") {
        mainColor = "#5DADE2"; 
        roofColor = "#2874A6"; 
        flagColor = "#3498DB"; 
    } else if (grade === "나") {
        mainColor = "#58D68D"; 
        roofColor = "#1D8348"; 
        flagColor = "#2ECC71"; 
    } else if (grade === "다") {
        mainColor = "#F4D03F"; 
        roofColor = "#D4AC0D"; 
        flagColor = "#F1C40F"; 
    } else if (grade === "라") {
        mainColor = "#F1948A"; 
        roofColor = "#B03A2E"; 
        flagColor = "#E74C3C"; 
    }

    var svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="40" height="40">` +
        `<rect x="12" y="28" width="40" height="32" fill="${mainColor}" rx="4" />` +
        `<polygon points="32,12 6,28 58,28" fill="${roofColor}" />` +
        `<path d="M26,60 L26,48 A6,6 0 0,1 38,48 L38,60 Z" fill="#8E44AD" />` +
        `<rect x="18" y="36" width="8" height="8" fill="#FFFFFF" rx="1" />` +
        `<rect x="38" y="36" width="8" height="8" fill="#FFFFFF" rx="1" />` +
        `<line x1="32" y1="12" x2="32" y2="4" stroke="#7F8C8D" stroke-width="2" />` +
        `<rect x="32" y="4" width="10" height="6" fill="${flagColor}" />` +
        `</svg>`;

    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

// 급지는 5종뿐이라 아이콘 주소를 한 번만 만들어 재사용한다.
var schoolIconCache = {};
function getSchoolIconUrl(grade) {
    var key = grade || '-';
    if (!schoolIconCache[key]) schoolIconCache[key] = getSchoolIcon(grade);
    return schoolIconCache[key];
}

// ── 네이버 길찾기 연결 ──────────────────────────────────────────
// 소요시간을 직접 계산하지 않고 출발지·도착지 좌표만 네이버에 넘긴다. (API 키·요금 없음)
// 모바일 앱 스킴(nmap://)은 네이버 공식 문서에 명시된 방식이지만,
// PC 웹 주소는 네이버가 "공식 지원하지 않는다"고 답변한 비공식 형식이라 언젠가 바뀔 수 있다.
// 그때 이 두 함수만 고치면 되도록 여기에 모아둔다.
var NAVER_APP_NAME = 'schoolmap.web';
var homePosition = null;  // 나중에 '우리집 위치' 기능이 붙으면 {lat, lng}가 들어간다.

function buildNaverAppUrl(mode, lat, lng, name) {
    var params = 'dlat=' + lat + '&dlng=' + lng + '&dname=' + encodeURIComponent(name);
    if (homePosition) {
        params = 'slat=' + homePosition.lat + '&slng=' + homePosition.lng +
                 '&sname=' + encodeURIComponent('우리집') + '&' + params;
    }
    return 'nmap://route/' + mode + '?' + params + '&appname=' + NAVER_APP_NAME;
}

function buildNaverWebUrl(lat, lng, name) {
    // 웹에서는 이동수단 지정 방식이 공식 문서에 없어서, 출발지·도착지만 넘기고
    // 대중교통/자동차 선택은 네이버 화면에 맡긴다.
    var params = 'elng=' + lng + '&elat=' + lat + '&etext=' + encodeURIComponent(name) + '&menu=route';
    if (homePosition) {
        params = 'slng=' + homePosition.lng + '&slat=' + homePosition.lat +
                 '&stext=' + encodeURIComponent('우리집') + '&' + params;
    }
    return 'https://map.naver.com/index.nhn?' + params;
}

function openNaverRoute(mode, lat, lng, name) {
    var webUrl = buildNaverWebUrl(lat, lng, name);
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (!isMobile) {
        // 새 탭으로 열어야 보던 지도(필터·줌 상태)가 그대로 남는다.
        window.open(webUrl, '_blank');
        return;
    }

    // 앱이 없으면 스킴 호출이 아무 일도 일으키지 않으므로, 잠시 뒤 웹으로 넘긴다.
    // 앱이 떴다면 화면이 가려져(document.hidden) 이 타이머는 무시된다.
    setTimeout(function() {
        if (!document.hidden) window.location.href = webUrl;
    }, 1200);
    window.location.href = buildNaverAppUrl(mode, lat, lng, name);
}

function jsQuote(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 배포(Vercel)에서는 templates/index.html이 루트로 서빙되어 ../data 상대경로가 어긋난다.
// GitHub raw 절대주소를 쓰면 배포와 로컬 양쪽에서 같은 파일을 바라본다.
// 데이터를 수정했을 때는 GitHub에도 올려야 배포본에 반영된다.
var csvUrl = "https://raw.githubusercontent.com/1-Ryu/SchoolMap/refs/heads/main/data/%EB%8C%80%EA%B5%AC%EC%B4%88%EB%93%B1%ED%95%99%EA%B5%90_%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%A2%8C%ED%91%9C%EC%99%84%EB%A3%8C.csv";

Papa.parse(csvUrl, {
    download: true,
    header: true,
    dynamicTyping: true,
    complete: function(results) {
        var data = results.data;

        data.forEach(function(school) {
            var lat = school['latitude']; 
            var lng = school['longitude'];
            var name = school['school_name']; 
            
            if (lat && lng && name) {
                var marker = new naver.maps.Marker({
                    position: new naver.maps.LatLng(lat, lng),
                    map: null,
                    // HTML(content) 마커는 SVG 자식 8개짜리 DOM이 마커마다 생겨서,
                    // 수백 개가 깔리면 확대/축소 때 재배치 비용이 커진다. 이미지 아이콘은 1개 노드로 끝난다.
                    icon: {
                        url: getSchoolIconUrl(school['grade_class']),
                        size: new naver.maps.Size(40, 40),
                        scaledSize: new naver.maps.Size(40, 40),
                        anchor: new naver.maps.Point(20, 40)
                    }
                });

                var hasResearch = school['research_topic'] !== null && school['research_topic'] !== undefined && String(school['research_topic']).trim() !== "" && String(school['research_topic']) !== "-";
                var researchText = hasResearch ? `${school['research_topic']} <span style="font-size:11px; color:#E74C3C;">(${school['research_year']}/${school['research_total_years']}년차)</span>` : "-";

                var hasIB = school['ib_stage'] !== null && school['ib_stage'] !== undefined && String(school['ib_stage']).trim() !== "" && String(school['ib_stage']) !== "-";
                var ibText = hasIB ? school['ib_stage'] : "-";

                var hasFuture = (school['future_total_years'] !== null && school['future_total_years'] !== undefined && String(school['future_total_years']).trim() !== "" && String(school['future_total_years']) !== "-") ||
                                (school['future_year'] !== null && school['future_year'] !== undefined && String(school['future_year']).trim() !== "" && String(school['future_year']) !== "-");
                var futureText = hasFuture ? `${school['future_year']}/${school['future_total_years']}년차` : "-";

                var dist = school['district'] || '-';
                var gr = school['grade_class'] ? school['grade_class'] + '급지' : '-';

                var infoWindow = new naver.maps.InfoWindow({
                    content: `
                        <div style="width:280px; padding:15px; border-radius:8px; box-shadow:0 2px 6px rgba(0,0,0,0.3); font-family:sans-serif;">
                            <h3 style="margin:0 0 5px 0; color:#2C3E50; font-size:16px;">${name}</h3>
                            <p style="margin:0 0 12px 0; font-size:12px; color:#7F8C8D;">${school['address'] || ''}</p>
                            
                            <table style="width: 100%; font-size: 13px; border-collapse: collapse; text-align: left;">
                                <tr style="border-bottom: 1px solid #eee;">
                                    <th style="padding: 5px 0; color:#34495E; width: 35%;">교육지원청/급지</th>
                                    <td style="padding: 5px 0; color:#2980B9; font-weight:bold;">${dist} / ${gr}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #eee;">
                                    <th style="padding: 5px 0; color:#34495E;">학급수</th>
                                    <td style="padding: 5px 0;">총 ${school['class_total']}학급 <span style="font-size:11px; color:#7F8C8D;">(일반 ${school['class_regular']} / 특수 ${school['class_special']})</span></td>
                                </tr>
                                <tr style="border-bottom: 1px solid #eee;">
                                    <th style="padding: 5px 0; color:#34495E;">연구학교</th>
                                    <td style="padding: 5px 0;">${researchText}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #eee;">
                                    <th style="padding: 5px 0; color:#34495E;">IB학교</th>
                                    <td style="padding: 5px 0;">${ibText}</td>
                                </tr>
                                <tr>
                                    <th style="padding: 5px 0; color:#34495E;">미래학교</th>
                                    <td style="padding: 5px 0;">${futureText}</td>
                                </tr>
                            </table>

                            <div style="margin-top:12px; padding-top:10px; border-top:1px solid #E5E8E8;">
                                <div style="font-size:11px; color:#95A5A6; margin-bottom:6px;">여기까지 길찾기</div>
                                <div style="display:flex; gap:6px;">
                                    <button onclick="openNaverRoute('car', ${lat}, ${lng}, '${jsQuote(name)}')"
                                        style="flex:1; height:32px; background:#EAF2F8; color:#2980B9; border:1px solid #AED6F1; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer;">🚗 자동차</button>
                                    <button onclick="openNaverRoute('public', ${lat}, ${lng}, '${jsQuote(name)}')"
                                        style="flex:1; height:32px; background:#EAF2F8; color:#2980B9; border:1px solid #AED6F1; border-radius:4px; font-size:12px; font-weight:bold; cursor:pointer;">🚌 대중교통</button>
                                </div>
                                <div style="font-size:10px; color:#B2BABB; margin-top:5px;">네이버 지도에서 열립니다</div>
                            </div>
                        </div>
                    `,
                    backgroundColor: "white",
                    borderColor: "#3498DB",
                    borderWidth: 2,
                    anchorSkew: true
                });

                var entry = {
                    marker: marker,
                    infoWindow: infoWindow,
                    rawData: school
                };
                schoolDataMap[name] = entry;
                allEntries.push(entry);

                naver.maps.Event.addListener(marker, "click", function(e) {
                    if (infoWindow.getMap()) {
                        infoWindow.close();
                    } else {
                        infoWindow.open(map, marker);
                    }
                });
            }
        });

        visibleEntries = allEntries.slice();
        renderMarkers(true);
    },
    error: function(err) {
        alert("데이터 파일을 불러올 수 없습니다.");
    }
});

function updateClassCountDisplay() {
    var val = document.getElementById("filter-class-count").value;
    document.getElementById("class-count-display").innerText = val;
}

function searchSchool() {
    var keyword = document.getElementById("searchInput").value.trim();
    if (!keyword) {
        alert("검색할 학교 이름을 입력해주세요.");
        return;
    }

    var found = false;
    
    for (var schoolName in schoolDataMap) {
        if (schoolName.includes(keyword)) {
            var target = schoolDataMap[schoolName];
            map.setCenter(target.marker.getPosition());
            map.setZoom(15);
            // 마커 교체는 미뤄서 처리되므로, 검색은 팝업을 열기 전에 즉시 갱신해준다.
            renderMarkers(true);
            target.infoWindow.open(map, target.marker);
            found = true;
            break;
        }
    }

    if (!found) {
        alert("'" + keyword + "' 학교를 찾을 수 없습니다.");
    }
}

function toggleFilterPanel() {
    var filterBox = document.getElementById('filter-box');
    var btn = document.getElementById('toggleFilterBtn');
    
    if (filterBox.style.display === 'none') {
        filterBox.style.display = 'flex'; 
        btn.innerText = '▲ 세부검색';
        btn.style.background = '#7F8C8D'; 
    } else {
        filterBox.style.display = 'none'; 
        btn.innerText = '▼ 세부검색';
        btn.style.background = '#2ECC71'; 
    }
}

function applyFilters() {
    var f_dist = document.getElementById("filter-district").value;
    
    var gradeCheckboxes = document.querySelectorAll('#filter-grade input[type="checkbox"]');
    var selectedGrades = [];
    gradeCheckboxes.forEach(function(cb) {
        if (cb.checked) selectedGrades.push(cb.value);
    });

    var f_research = document.getElementById("filter-research").value;
    var f_ib = document.getElementById("filter-ib").value;
    var f_future = document.getElementById("filter-future").value;
    
    var filterMode = document.querySelector('input[name="filter-mode"]:checked').value;
    var minClassCount = parseInt(document.getElementById("filter-class-count").value, 10);
    var matched = [];

    for (var schoolName in schoolDataMap) {
        var target = schoolDataMap[schoolName];
        var data = target.rawData;
        var isMatch = true;

        if (f_dist !== "전체" && data['district'] !== f_dist) isMatch = false;
        if (data['grade_class'] && !selectedGrades.includes(data['grade_class'])) isMatch = false;
        
        var schoolClassTotal = parseInt(data['class_total'], 10);
        if (!isNaN(schoolClassTotal) && schoolClassTotal < minClassCount) {
            isMatch = false;
        }

        if (isMatch) {
            var specialActiveCount = 0; 
            var specialPassCount = 0;   

            if (f_research !== "미설정") {
                specialActiveCount++;
                var hasResearch = data['research_topic'] !== null && data['research_topic'] !== undefined && String(data['research_topic']).trim() !== "" && String(data['research_topic']) !== "-";
                if ((f_research === "지정교" && hasResearch) || (f_research === "미지정교" && !hasResearch)) {
                    specialPassCount++;
                }
            }

            if (f_ib !== "미설정") {
                specialActiveCount++;
                var hasIB = data['ib_stage'] !== null && data['ib_stage'] !== undefined && String(data['ib_stage']).trim() !== "" && String(data['ib_stage']) !== "-";
                var passIB = false;
                if (f_ib === "운영") passIB = hasIB;
                else passIB = (hasIB && String(data['ib_stage']).includes(f_ib));
                
                if (passIB) {
                    specialPassCount++;
                }
            }

            if (f_future !== "미설정") {
                specialActiveCount++;
                var hasFuture = (data['future_total_years'] !== null && data['future_total_years'] !== undefined && String(data['future_total_years']).trim() !== "" && String(data['future_total_years']) !== "-") ||
                                (data['future_year'] !== null && data['future_year'] !== undefined && String(data['future_year']).trim() !== "" && String(data['future_year']) !== "-");
                if ((f_future === "지정교" && hasFuture) || (f_future === "미지정교" && !hasFuture)) {
                    specialPassCount++;
                }
            }

            if (specialActiveCount > 0) {
                if (filterMode === 'and') {
                    if (specialPassCount < specialActiveCount) isMatch = false;
                } else if (filterMode === 'or') {
                    if (specialPassCount === 0) isMatch = false;
                }
            }
        }

        if (isMatch) {
            matched.push(target);
        } else {
            target.infoWindow.close();
        }
    }

    visibleEntries = matched;
    renderMarkers(true);
}

// 모바일에서는 세부검색이 펼쳐져 있으면 지도를 절반 가려서, 접힌 상태로 시작한다.
if (window.innerWidth <= 768) {
    document.getElementById('filter-box').style.display = 'none';
    var initBtn = document.getElementById('toggleFilterBtn');
    initBtn.innerText = '▼ 세부검색';
    initBtn.style.background = '#2ECC71';
}

naver.maps.Event.addListener(map, 'click', function(e) {
    for (var schoolName in schoolDataMap) {
        var infoWindow = schoolDataMap[schoolName].infoWindow;
        if (infoWindow.getMap()) {
            infoWindow.close();
        }
    }
});