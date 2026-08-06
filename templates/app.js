/* ══════════════════════════════════════════════════════════════
   학교어디 — 대구 초등학교 지도
   ══════════════════════════════════════════════════════════════ */

var map = new naver.maps.Map('map', {
    center: new naver.maps.LatLng(35.8714354, 128.601445),
    zoom: 12,
    mapDataControl: false,
    scaleControl: false
});

/* ── 급지 색 ───────────────────────────────────────────────────
   한 계열 안에서 밝기를 네 단계로 고르게 벌린다. 색을 구분하지 못해도
   진하기만으로 순서가 읽히게 하려는 것이다.
   숫자는 네 단계 모두 흰색으로 통일했다. 다·라는 배경이 밝아 대비가 낮으므로
   (다 2.1:1, 라 1.4:1) 숫자가 흐리게 보인다면 글자에 외곽선을 넣어야 한다. */
var GRADE_TONE = {
    '가': { b: '#A6390F', f: '#ffffff' },
    '나': { b: '#E4622C', f: '#ffffff' },
    '다': { b: '#F59F55', f: '#ffffff' },
    '라': { b: '#FBD7AE', f: '#ffffff' },
    '':   { b: '#C6C0B6', f: '#ffffff' }    // 급지가 없는 국립·사립
};
var GRADES = ['가', '나', '다', '라'];

function toneFor(g) { return GRADE_TONE[g || ''] || GRADE_TONE['']; }

/* 지원청 구역 색. 강조색과 싸우지 않도록 채도를 낮춰 잡았다. */
var DISTRICT_COLORS = {
    '동부': '#D4694A', '서부': '#6E8F7A', '남부': '#8A7CA8',
    '달성': '#C9A25B', '군위': '#7A8B9E'
};

/* ── 마커 아이콘 ───────────────────────────────────────────────
   HTML(content) 마커는 마커마다 DOM이 생겨서 수백 개가 깔리면 확대/축소 때
   재배치 비용이 커진다. 이미지 아이콘은 1개 노드로 끝나므로 SVG를 주소로 만들어 쓴다.

   머리를 크게, 꼬리를 짧게 잡아 뭉툭하고 둥근 물방울을 만든다.
   반지름 15.5 원의 중심 (18,18)에서 끝점 (18,40.5)로 접선을 그은 모양이라,
   머리와 전체 높이의 비가 0.83으로 시안의 둥근 핀과 같다.
   (꼬리를 길게 빼면 뾰족하고 날카로워 보인다) */
var PIN_W = 36, PIN_H = 44, PIN_TIP = 42;
var PIN_PATH = 'M6.76 28.68A15.5 15.5 0 1 1 29.24 28.68L18 40.5Z';
var pinCache = {};

function pinUrl(grade, count, selected) {
    var key = (grade || '-') + '|' + count + '|' + (selected ? 's' : 'n');
    if (pinCache[key]) return pinCache[key];

    var t = toneFor(grade);
    var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + PIN_W + '" height="' + PIN_H + '" viewBox="0 0 36 44">' +
        '<path d="' + PIN_PATH + '" fill="' + t.b + '" ' +
            'stroke="' + (selected ? '#1A1A17' : '#ffffff') + '" ' +
            'stroke-width="' + (selected ? 3 : 2.6) + '" stroke-linejoin="round"/>' +
        '<text x="18" y="22.6" text-anchor="middle" font-family="sans-serif" ' +
            'font-size="13.5" font-weight="700" fill="' + t.f + '">' + count + '</text>' +
        '</svg>';

    pinCache[key] = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    return pinCache[key];
}

function pinIcon(grade, count, selected) {
    var scale = selected ? 1.25 : 1;
    var w = Math.round(PIN_W * scale), h = Math.round(PIN_H * scale);
    return {
        url: pinUrl(grade, count, selected),
        size: new naver.maps.Size(w, h),
        scaledSize: new naver.maps.Size(w, h),
        // 좌표를 가리키는 것은 그림의 아래 끝이 아니라 꼬리 끝점이다.
        anchor: new naver.maps.Point(Math.round(w / 2), Math.round(PIN_TIP * scale))
    };
}

/* ── 지원청 경계선 ────────────────────────────────────────────── */
var boundaryPolygons = [];
var boundaryOn = false;
var mapUrl = "https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2013/json/skorea_municipalities_geo.json";

var GU_TO_DISTRICT = {
    '중구': '동부', '동구': '동부', '수성구': '동부',
    '서구': '서부', '북구': '서부',
    '남구': '남부', '달서구': '남부',
    '달성군': '달성', '군위군': '군위'
};

/* 원본 경계선은 전국 지도용이라 점이 아주 촘촘하다. 대구만 추려도 26,000개가 넘는데,
   켜둔 채로 지도를 움직이면 그 점을 매 프레임 다시 그리느라 화면이 끊긴다.
   화면에서 구분되지 않을 만큼만(약 20m) 점을 솎아낸다.
   재귀 대신 스택을 쓴다. 9,000점짜리 구역에서 호출이 깊어질 수 있다. */
var SIMPLIFY_TOLERANCE = 0.0002;   // 위도 1도 ≈ 111km 이므로 약 22m

function simplifyRing(pts, tol) {
    if (pts.length < 3) return pts;

    var keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    var tol2 = tol * tol;

    while (stack.length) {
        var seg = stack.pop(), first = seg[0], last = seg[1];
        if (last - first < 2) continue;

        var ax = pts[first][0], ay = pts[first][1];
        var dx = pts[last][0] - ax, dy = pts[last][1] - ay;
        var len2 = dx * dx + dy * dy;
        var maxD = -1, idx = -1;

        for (var i = first + 1; i < last; i++) {
            var px = pts[i][0] - ax, py = pts[i][1] - ay, d;
            if (len2 === 0) {
                d = px * px + py * py;
            } else {
                var t = (px * dx + py * dy) / len2;
                t = t < 0 ? 0 : (t > 1 ? 1 : t);
                var cx = px - t * dx, cy = py - t * dy;
                d = cx * cx + cy * cy;
            }
            if (d > maxD) { maxD = d; idx = i; }
        }

        if (maxD > tol2 && idx > -1) {
            keep[idx] = 1;
            stack.push([first, idx], [idx, last]);
        }
    }

    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
}

fetch(mapUrl)
    .then(function(response) {
        if (!response.ok) throw new Error("지도 데이터를 불러오지 못했습니다.");
        return response.json();
    })
    .then(function(geojson) {
        var daeguFeatures = geojson.features.filter(function(f) {
            var code = f.properties.code || "";
            var name = f.properties.name || "";
            return code.startsWith('22') || name === '군위군';
        });

        daeguFeatures.forEach(function(feature) {
            var guName = feature.properties.name;
            var color = DISTRICT_COLORS[GU_TO_DISTRICT[guName]] || '#9E9E96';
            var coords = feature.geometry.coordinates;

            function drawSinglePolygon(coordinateArray) {
                var path = simplifyRing(coordinateArray, SIMPLIFY_TOLERANCE).map(function(coord) {
                    return new naver.maps.LatLng(coord[1], coord[0]);
                });
                // 지도에는 미리 붙여두고 보이기만 끈다. 붙였다 떼는 데는 30ms가 걸리는데
                // setVisible은 즉시 처리되어, 미는 동안 껐다 켜도 걸리지 않는다.
                boundaryPolygons.push(new naver.maps.Polygon({
                    map: map,
                    visible: false,
                    paths: [path],
                    fillColor: color, fillOpacity: 0.13,
                    strokeColor: color, strokeOpacity: 0.75, strokeWeight: 2
                }));
            }

            if (feature.geometry.type === 'Polygon') {
                drawSinglePolygon(coords[0]);
            } else if (feature.geometry.type === 'MultiPolygon') {
                coords.forEach(function(polygon) { drawSinglePolygon(polygon[0]); });
            }
        });
    })
    .catch(function(error) {
        console.error("경계선을 불러오지 못했습니다:", error);
    });

/* 경계선은 SVG 도형으로 그려진다. 화면을 덮는 큰 도형 10개를 매 프레임 다시 칠하는
   셈이라, 점을 90% 줄여도 칠할 면적은 그대로여서 폰에서는 미는 동안 끊긴다.
   움직이는 중에는 감추고 멈췄을 때만 보여준다. 지도를 미는 동안 경계선이 잠깐
   사라지지만, 어차피 그때는 보고 있지 않다. */
var boundaryShown = false;

function showBoundaries(v) {
    if (boundaryShown === v || boundaryPolygons.length === 0) return;
    boundaryShown = v;
    boundaryPolygons.forEach(function(p) { p.setVisible(v); });
}

function toggleBoundaries() {
    boundaryOn = !boundaryOn;
    showBoundaries(boundaryOn);
    renderChips();   // 필터 안 '지원청 구역' 칩의 켜짐 표시를 맞춘다
}

naver.maps.Event.addListener(map, 'dragstart', function() { showBoundaries(false); });
naver.maps.Event.addListener(map, 'zoom_changed', function() { showBoundaries(false); });

/* ── 학교 데이터 ──────────────────────────────────────────────── */
var schoolDataMap = {};
var allEntries = [];
var visibleEntries = [];
var clusterMarkers = [];
var selectedEntry = null;

var ZOOM_DISTRICT = 11;
var ZOOM_SCHOOL = 13;

function has(v) {
    return v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '-';
}

function createClusterMarker(position, label, count, color, sizePx, zoomTo) {
    var marker = new naver.maps.Marker({
        position: position,
        map: map,
        icon: {
            content: '<div class="cluster marker-fade" style="width:' + sizePx + 'px;height:' + sizePx +
                     'px;background:' + color + '">' +
                     '<div class="cl-name">' + label + '</div>' +
                     '<div class="cl-num">' + count + '</div></div>',
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
        sumLat += pos.lat(); sumLng += pos.lng();
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
var shownSchools = [];

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

    shownSchools.forEach(function(e) { if (!nextSet.has(e)) e.marker.setMap(null); });
    next.forEach(function(e) { if (!prevSet.has(e)) e.marker.setMap(map); });

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

    if (level === 'district') {
        var groups = {};
        visibleEntries.forEach(function(e) {
            var d = e.rawData['district'] || '기타';
            (groups[d] = groups[d] || []).push(e);
        });
        Object.keys(groups).forEach(function(d) {
            var members = groups[d];
            createClusterMarker(groupCenter(members), d, members.length,
                                DISTRICT_COLORS[d] || '#9E9E96', 62, ZOOM_SCHOOL);
        });
    } else {
        createClusterMarker(groupCenter(visibleEntries), '대구', visibleEntries.length,
                            '#8A4A12', 84, ZOOM_DISTRICT);
    }
}

// zoom_changed는 확대/축소 애니메이션 '도중에' 발생해서, 그때 마커를 갈아끼우면 화면이 튄다.
// idle은 지도 움직임이 완전히 끝난 뒤에 한 번만 발생하므로 교체가 자연스럽다.
naver.maps.Event.addListener(map, 'idle', function() {
    renderMarkers();
    showBoundaries(boundaryOn);
});
/* 시트를 닫아도 경로선은 남긴다. 폰에서는 시트가 화면을 거의 덮어서,
   닫은 뒤라야 비로소 길을 볼 수 있기 때문이다.
   지도 빈 곳을 누르는 것은 '그만 보겠다'는 뜻이라 그때 지운다. */
naver.maps.Event.addListener(map, 'click', function(e) {
    if (pickingHome) { setHome(e.coord); return; }
    closePanels();
    closeSheetByTap();
});

/* 길게 누르기(longtap)로도 집을 옮길 수 있게 해봤지만, 기기에 따라 지도가
   그 동작을 드래그 시작으로 먹어버려 반응하지 않는다. 되는지 안 되는지
   확신할 수 없는 조작은 두지 않는다. 집은 버튼으로만 정한다. */

/* ── 네이버 길찾기 연결 ────────────────────────────────────────
   소요시간을 직접 계산하지 않고 출발지·도착지 좌표만 네이버에 넘긴다. (API 키·요금 없음)
   모바일 앱 스킴(nmap://)은 네이버 공식 문서에 명시된 방식이지만,
   PC 웹 주소는 네이버가 "공식 지원하지 않는다"고 답변한 비공식 형식이라 언젠가 바뀔 수 있다.
   그때 이 두 함수만 고치면 되도록 여기에 모아둔다. */
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

/* ── 안내 문구 ────────────────────────────────────────────────── */
var toastTimer = null;
function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2400);
}

/* ── 우리집 위치 ──────────────────────────────────────────────
   좌표는 브라우저에만 저장한다. 서버에 올리지 않으니 로그인도 필요 없고,
   집 주소를 우리가 보관하지도 않는다. 대신 기기마다 따로 저장되고,
   브라우저 데이터를 지우면 사라진다. */
var HOME_KEY = 'schoolmap.home';
var homeMarker = null;
var pickingHome = false;

function loadHome() {
    try {
        var v = JSON.parse(localStorage.getItem(HOME_KEY));
        if (v && isFinite(v.lat) && isFinite(v.lng)) homePosition = v;
    } catch (e) { /* 저장소를 못 쓰는 브라우저면 그냥 없는 것으로 둔다 */ }
}

function saveHome() {
    try {
        if (homePosition) localStorage.setItem(HOME_KEY, JSON.stringify(homePosition));
        else localStorage.removeItem(HOME_KEY);
    } catch (e) {}
}

/* 직선거리(하버사인). 소요시간으로 환산하지 않는다 —
   도로 우회·신호·정체를 반영하지 못해 틀린 값을 정확한 척 보여주게 된다. */
function distanceKm(a, b) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    var la1 = a.lat * toRad, la2 = b.lat * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
}

function distanceTo(data) {
    if (!homePosition) return null;
    return distanceKm(homePosition, { lat: data['latitude'], lng: data['longitude'] });
}

var HOME_ICON = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 36 44">' +
    '<path d="M6.76 28.68A15.5 15.5 0 1 1 29.24 28.68L18 40.5Z" fill="#3E3A34" ' +
        'stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"/>' +
    '<path d="M11.5 18.2 18 12.5l6.5 5.7V25a.8.8 0 0 1-.8.8h-11a.8.8 0 0 1-.8-.8z" ' +
        'fill="none" stroke="#ffffff" stroke-width="2.1" stroke-linejoin="round"/></svg>');

function renderHome() {
    if (!homePosition) {
        if (homeMarker) { homeMarker.setMap(null); homeMarker = null; }
        return;
    }
    var pos = new naver.maps.LatLng(homePosition.lat, homePosition.lng);
    if (homeMarker) {
        homeMarker.setPosition(pos);
    } else {
        homeMarker = new naver.maps.Marker({
            position: pos, map: map, zIndex: 300, title: '우리집',
            icon: {
                url: HOME_ICON,
                size: new naver.maps.Size(40, 48),
                scaledSize: new naver.maps.Size(40, 48),
                anchor: new naver.maps.Point(20, 46)
            }
        });
    }
}

/* 집을 찍으려면 시트를 닫아야 하는데, 닫으면 보던 학교가 해제된다.
   집만 바꾸려던 것이지 보던 것을 그만두려던 게 아니므로, 찍기 전에
   무엇을 보고 있었는지 붙잡아뒀다가 끝나면 그리로 돌아간다. */
var pickReturnEntry = null;

function startPickHome() {
    pickingHome = true;
    pickReturnEntry = selectedEntry;      // closeSheet가 지우기 전에 붙잡는다
    document.body.classList.add('picking');
    document.getElementById('pickbar').classList.add('show');
    closePanels();
    closeSheet();
    clearRoute();                         // 집이 바뀌면 이 경로는 의미가 없다
}

function cancelPickHome() {
    pickingHome = false;
    document.body.classList.remove('picking');
    document.getElementById('pickbar').classList.remove('show');

    var back = pickReturnEntry;
    pickReturnEntry = null;
    // 취소했으면 원래 경로가 그대로, 새로 찍었으면 새 집 기준으로 다시 계산된다.
    if (back) selectSchool(back);
}

function setHome(coord) {
    homePosition = { lat: coord.lat(), lng: coord.lng() };
    saveHome();
    renderHome();
    updateHomeUI();
    cancelPickHome();
}

function updateHomeUI() {
    document.getElementById('homeBtn').classList.toggle('set', !!homePosition);
}

/* ── 자동차 소요시간 ──────────────────────────────────────────
   학교를 열 때 그 학교 하나만 물어본다. 233곳을 한꺼번에 계산하지 않는다.
   같은 집·같은 학교는 다시 묻지 않도록 기억해둔다. */
var commuteCache = {};
var commuteSeq = 0;

function homeKey() {
    return homePosition ? homePosition.lat.toFixed(5) + ',' + homePosition.lng.toFixed(5) : '';
}

/* 경로선은 두 겹으로 그린다. 흰 선을 밑에 깔아야 도로 위에서도 경계가 보인다.
   지도 앱들이 쓰는 방식이고, 한 겹만 그리면 비슷한 색 도로에 묻힌다. */
var routeLines = [];

function clearRoute() {
    routeLines.forEach(function(l) { l.setMap(null); });
    routeLines = [];
}

function drawRoute(path) {
    clearRoute();
    if (!path || path.length < 2) return;

    // 경계선과 달리 아주 조금만 솎아낸다. 경계선은 넓은 구역의 테두리라
    // 22m쯤 어긋나도 안 보이지만, 경로선은 도로 위에 얹혀 있어야 해서
    // 그만큼 어긋나면 길을 벗어나 보인다. 여기서는 3m 기준으로 잡는다.
    // 어차피 한 경로는 점이 수백 개뿐이라 채움도 없어 가볍다.
    var pts = simplifyRing(path, 0.00003).map(function(c) {
        return new naver.maps.LatLng(c[1], c[0]);
    });

    // 더 굵게 하지는 않는다. 유턴처럼 같은 길을 왕복하는 구간에서는 가는 길과
    // 오는 길이 몇 픽셀 차이로 나란히 놓이는데, 선이 두꺼울수록 둘이 하나로
    // 뭉쳐 보인다. 굵기로는 왕복을 드러낼 수 없고 오히려 덮어버린다.
    [{ color: '#ffffff', weight: 11, z: 60 },
     { color: '#B84A22', weight: 6.5, z: 61 }].forEach(function(s) {
        routeLines.push(new naver.maps.Polyline({
            map: map, path: pts, zIndex: s.z,
            strokeColor: s.color, strokeWeight: s.weight,
            strokeOpacity: 0.95, strokeLineCap: 'round', strokeLineJoin: 'round'
        }));
    });
}

function showCommute(v) {
    var main = document.getElementById('sCommute');
    var note = document.getElementById('sCommuteNote');

    if (!v) {
        // 키가 아직 없거나 경로를 못 찾은 경우다. 실패를 알리기보다 원래 쓰던
        // 안내로 돌아간다. 사용자는 길찾기로 확인하면 되고, 놀랄 이유가 없다.
        main.textContent = '우리집에서 출발';
        note.textContent = '길찾기를 누르면 우리집이 출발지로 채워집니다.';
    } else {
        main.textContent = '지금 출발하면 ' + v.minutes + '분 · ' + v.km.toFixed(1) + 'km';
        // 통행료는 있을 때만 적는다. 없는 경로에까지 '0원'을 띄우면 잔소리가 된다.
        note.textContent = (v.toll ? '통행료 ' + v.toll.toLocaleString('ko-KR') + '원 · ' : '') +
                           '실시간 교통 기준이라 시간대에 따라 달라집니다.';
    }
}

function fetchCommute(entry) {
    var s = entry.rawData;
    var key = homeKey() + '|' + s['school_name'];

    if (commuteCache[key] !== undefined) {
        commuteSeq++;                     // 늦게 도착할 이전 응답을 무시시킨다
        showCommute(commuteCache[key]);
        drawRoute(commuteCache[key] && commuteCache[key].path);
        return;
    }

    var seq = ++commuteSeq;
    clearRoute();
    document.getElementById('sCommute').textContent = '소요시간 확인 중…';
    document.getElementById('sCommuteNote').textContent = '우리집에서 자동차로';

    fetch('/api/commute?slat=' + homePosition.lat + '&slng=' + homePosition.lng +
          '&dlat=' + s['latitude'] + '&dlng=' + s['longitude'])
        .then(function(r) { return r.json(); })
        .then(function(d) {
            // 기다리는 사이 다른 학교를 열었으면 그 화면을 덮어쓰지 않는다.
            if (seq !== commuteSeq) return;
            var v = (d && d.ok) ? { minutes: d.minutes, km: d.km, toll: d.toll, path: d.path } : null;
            commuteCache[key] = v;
            showCommute(v);
            drawRoute(v && v.path);
        })
        .catch(function() {
            if (seq === commuteSeq) showCommute(null);
        });
}

function clearHome() {
    homePosition = null;
    saveHome();
    renderHome();
    clearRoute();
    updateHomeUI();
    if (selectedEntry) fillSheet(selectedEntry);
    toast('우리집 위치를 지웠어요. 다시 누르면 정할 수 있어요.');
}

/* ── 시트 ─────────────────────────────────────────────────────
   단계를 두지 않는다. 열면 크게 열리고 닫는 것만 있다.
   끌기는 손잡이·제목에서만 받고, 내용 영역은 브라우저에 맡겨야 스크롤이 부드럽다. */
var sheet = document.getElementById('sheet');
var scrim = document.getElementById('scrim');
var sheetScroll = sheet.querySelector('.sheet-scroll');
var sheetTop = sheet.querySelector('.sheet-top');
var sheetOpen = false, dragY = 0, sheetH = 0;

function isWide() { return window.matchMedia('(min-width: 880px)').matches; }
function measureSheet() { sheetH = sheet.offsetHeight; }
measureSheet();

function settleSheet(open, animate) {
    sheetOpen = open;
    sheet.classList.toggle('animate', animate !== false);
    if (isWide()) {
        sheet.style.transform = open ? 'translateX(0)' : 'translateX(calc(-100% - 32px))';
    } else {
        // 닫은 위치를 픽셀로 굳히면 안 된다. 폰에서 주소창이 숨겨지면 화면이 커지고
        // 시트도 함께 커지는데 내려둔 거리는 그대로라 아래에 띠가 남는다.
        sheet.style.transform = open ? 'translateY(0)' : 'translateY(100%)';
        dragY = open ? 0 : sheet.offsetHeight;
    }
    scrim.classList.toggle('show', open);
    sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!open) sheetScroll.scrollTop = 0;
    else sheetOpenedAt = Date.now();
}

/* 폰에서는 지도를 한 번 누르면 브라우저가 클릭 신호를 조금 늦게 한 번 더 보낸다.
   그 사이 시트가 열려 어두운 막이 화면을 덮으면, 늦게 도착한 클릭이 막에 떨어져
   방금 연 시트를 그대로 닫아버린다. (집을 찍으면 경로만 남고 시트가 사라지던 증상)
   시트를 띄운 바로 그 손짓이 뒤늦게 도착한 것이니 닫으라는 뜻일 리가 없다.

   '바깥을 눌러 닫기'에만 건다. X 버튼과 손잡이 끌기는 그대로여서,
   이 유예 때문에 시트를 못 닫는 상황은 생기지 않는다. */
var sheetOpenedAt = 0;

function closeSheetByTap() {
    if (Date.now() - sheetOpenedAt < 350) return;
    closeSheet();
    clearRoute();
}

window.addEventListener('resize', function() { measureSheet(); settleSheet(sheetOpen, false); });

function openSheet() {
    measureSheet();
    if (!sheetOpen) {
        // 닫힌 자리에서 출발해야 올라오는 것처럼 보인다. 애니메이션 없이 먼저 세워둔다.
        sheet.classList.remove('animate');
        sheet.style.transform = 'translateY(100%)';
        void sheet.offsetHeight;
    }
    // 다음 프레임에 열어야 시작 위치가 반영된 뒤 애니메이션이 걸린다.
    // 다만 화면이 안 그려지는 상황에서는 프레임이 오지 않으므로 시간으로도 한 번 더 건다.
    var fired = false;
    var go = function() {
        if (fired) return;
        fired = true;
        settleSheet(true, true);
    };
    requestAnimationFrame(go);
    setTimeout(go, 60);
}

function closeSheet() {
    settleSheet(false, true);
    if (selectedEntry) {
        var e = selectedEntry;
        selectedEntry = null;
        e.marker.setIcon(pinIcon(e.rawData['grade_class'], e.rawData['class_total'], false));
        e.marker.setZIndex(50);
    }
}

document.getElementById('closeBtn').addEventListener('click', closeSheet);
scrim.addEventListener('click', closeSheetByTap);

/* 끌어서 닫기 */
var drag = null;

sheetTop.addEventListener('pointerdown', function(e) {
    if (isWide() || e.target.closest('#closeBtn')) return;
    drag = { y0: e.clientY, last: e.clientY, t: e.timeStamp, v: 0, moved: false };
    sheet.classList.remove('animate');
    sheetTop.setPointerCapture(e.pointerId);
});

sheetTop.addEventListener('pointermove', function(e) {
    if (!drag) return;
    var dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 3) drag.moved = true;

    var dt = e.timeStamp - drag.t;
    if (dt > 0) { drag.v = (e.clientY - drag.last) / dt; drag.last = e.clientY; drag.t = e.timeStamp; }

    dragY = dy < 0 ? dy * 0.22 : dy;   // 위로는 저항을 걸어 끝을 알린다
    sheet.style.transform = 'translateY(' + dragY + 'px)';
    e.preventDefault();
});

function endDrag() {
    if (!drag) return;
    var v = drag.v, moved = drag.moved;
    drag = null;
    if (!moved) return;
    if (dragY > sheetH * 0.28 || v > 0.5) closeSheet();
    else settleSheet(true, true);
}
sheetTop.addEventListener('pointerup', endDrag);
sheetTop.addEventListener('pointercancel', endDrag);

/* ── 시트 내용 ────────────────────────────────────────────────── */
function fillSheet(entry) {
    var s = entry.rawData;
    var name = String(s['school_name']);

    document.getElementById('sName').textContent = name.replace(/\((국립|사립)\)/, '');
    document.getElementById('sAddr').textContent = String(s['address'] || '').trim();

    var badges = [];
    if (has(s['district'])) badges.push({ t: s['district'] + '교육지원청', c: '' });
    if (has(s['grade_class'])) badges.push({ t: s['grade_class'] + '급지', c: 'key' });
    if (name.indexOf('(국립)') > -1) badges.push({ t: '국립', c: '' });
    if (name.indexOf('(사립)') > -1) badges.push({ t: '사립', c: '' });
    if (has(s['research_topic'])) badges.push({ t: '연구학교', c: 'warm' });
    if (has(s['ib_stage'])) badges.push({ t: 'IB ' + String(s['ib_stage']).trim() + '학교', c: 'warm' });
    if (has(s['future_total_years']) || has(s['future_year'])) badges.push({ t: '미래학교', c: 'warm' });

    document.getElementById('sBadges').innerHTML = badges.map(function(b) {
        return '<span class="badge ' + b.c + '">' + b.t + '</span>';
    }).join('');

    // 직선거리는 적지 않는다. 대구는 강과 산 때문에 직선거리와 실제 경로가
    // 한쪽으로 크게 어긋나서, 학교를 고르는 근거로 쓸 수 없다.
    if (homePosition) {
        document.getElementById('sSetHome').textContent = '변경';
        fetchCommute(entry);
    } else {
        commuteSeq++;
        document.getElementById('sCommute').textContent = '우리집을 정해두면 편해요';
        document.getElementById('sCommuteNote').textContent =
            '학교까지 자동차로 몇 분인지 바로 볼 수 있어요.';
        document.getElementById('sSetHome').textContent = '설정';
    }

    var total = s['class_total'], reg = s['class_regular'], sp = s['class_special'];
    document.getElementById('sStats').innerHTML =
        '<div class="stat"><div class="k">총 학급</div><div class="v">' + total + '<u>학급</u></div></div>' +
        '<div class="stat"><div class="k">일반 / 특수</div><div class="v">' + reg + '<u> / </u>' + sp + '</div></div>' +
        '<div class="stat"><div class="k">급지</div><div class="v">' + (has(s['grade_class']) ? s['grade_class'] : '—') + '</div></div>';

    function row(k, on, v) {
        return '<div class="row"><div class="k">' + k + '</div>' +
               '<div class="v' + (on ? '' : ' off') + '">' + (on ? v : '해당 없음') + '</div></div>';
    }

    var researchVal = s['research_topic'] +
        (has(s['research_year']) ? '<small>' + s['research_year'] + '/' + s['research_total_years'] + '년차</small>' : '');
    var futureVal = has(s['future_year'])
        ? s['future_year'] + '/' + s['future_total_years'] + '년차'
        : String(s['future_total_years']).trim() + '년';

    document.getElementById('sRows').innerHTML =
        row('연구학교', has(s['research_topic']), researchVal) +
        row('IB학교', has(s['ib_stage']), String(s['ib_stage']).trim() + '학교') +
        row('미래학교', has(s['future_total_years']) || has(s['future_year']), futureVal);

    var lat = s['latitude'], lng = s['longitude'];
    document.getElementById('routeCar').onclick = function() { openNaverRoute('car', lat, lng, name); };
    document.getElementById('routeBus').onclick = function() { openNaverRoute('public', lat, lng, name); };
}

function selectSchool(entry) {
    if (selectedEntry && selectedEntry !== entry) {
        var p = selectedEntry;
        p.marker.setIcon(pinIcon(p.rawData['grade_class'], p.rawData['class_total'], false));
        p.marker.setZIndex(50);
    }
    selectedEntry = entry;
    entry.marker.setIcon(pinIcon(entry.rawData['grade_class'], entry.rawData['class_total'], true));
    entry.marker.setZIndex(200);

    closePanels();
    fillSheet(entry);
    openSheet();
}

/* ── 데이터 불러오기 ───────────────────────────────────────────
   배포(Vercel)에서는 templates/index.html이 루트로 서빙되어 ../data 상대경로가 어긋난다.
   GitHub raw 절대주소를 쓰면 배포와 로컬 양쪽에서 같은 파일을 바라본다.
   데이터를 수정했을 때는 GitHub에도 올려야 배포본에 반영된다. */
var csvUrl = "https://raw.githubusercontent.com/1-Ryu/daegu-school-map/refs/heads/main/data/%EB%8C%80%EA%B5%AC%EC%B4%88%EB%93%B1%ED%95%99%EA%B5%90_%EB%8D%B0%EC%9D%B4%ED%84%B0_%EC%A2%8C%ED%91%9C%EC%99%84%EB%A3%8C.csv";

Papa.parse(csvUrl, {
    download: true,
    header: true,
    dynamicTyping: true,
    complete: function(results) {
        results.data.forEach(function(school) {
            var lat = school['latitude'];
            var lng = school['longitude'];
            var name = school['school_name'];
            if (!lat || !lng || !name) return;

            var marker = new naver.maps.Marker({
                position: new naver.maps.LatLng(lat, lng),
                map: null,
                icon: pinIcon(school['grade_class'], school['class_total'], false),
                zIndex: 50
            });

            var entry = { marker: marker, rawData: school };
            schoolDataMap[name] = entry;
            allEntries.push(entry);

            naver.maps.Event.addListener(marker, 'click', function() {
                if (selectedEntry === entry && sheetOpen) closeSheet();
                else selectSchool(entry);
            });
        });

        visibleEntries = allEntries.slice();
        renderMarkers(true);
    },
    error: function() {
        toast('학교 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
});

/* ── 상단 검색 ────────────────────────────────────────────────── */
var searchInput = document.getElementById('searchInput');
var searchField = document.getElementById('searchfield');
var searchList = document.getElementById('searchlist');
var filterPanel = document.getElementById('filterpanel');

function closePanels() {
    searchList.classList.remove('show');
    filterPanel.classList.remove('show');
    document.getElementById('filterBtn').classList.remove('on');
}

function renderSearchList(q) {
    var hits = allEntries.filter(function(e) {
        return !q || String(e.rawData['school_name']).indexOf(q) > -1;
    }).slice(0, 40);

    searchList.innerHTML = hits.length === 0
        ? '<div class="empty">일치하는 학교가 없습니다</div>'
        : hits.map(function(e) {
              var s = e.rawData;
              return '<button data-name="' + String(s['school_name']).replace(/"/g, '&quot;') + '">' +
                     '<i style="background:' + toneFor(s['grade_class']).b + '"></i>' +
                     String(s['school_name']).replace(/\((국립|사립)\)/, '') +
                     '<em>' + s['class_total'] + '학급</em></button>';
          }).join('');

    filterPanel.classList.remove('show');
    document.getElementById('filterBtn').classList.remove('on');
    searchList.classList.add('show');
}

searchInput.addEventListener('focus', function() { renderSearchList(searchInput.value.trim()); });
searchInput.addEventListener('input', function() {
    searchField.classList.toggle('filled', searchInput.value.length > 0);
    renderSearchList(searchInput.value.trim());
});
document.getElementById('searchClear').addEventListener('click', function() {
    searchInput.value = '';
    searchField.classList.remove('filled');
    closePanels();
});

searchList.addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-name]');
    if (!btn) return;
    var entry = schoolDataMap[btn.dataset.name];
    if (!entry) return;

    closePanels();
    searchInput.blur();

    map.setCenter(entry.marker.getPosition());
    map.setZoom(15);
    // 마커 교체는 미뤄서 처리되므로, 검색은 시트를 열기 전에 즉시 갱신해준다.
    renderMarkers(true);
    selectSchool(entry);
});

document.addEventListener('pointerdown', function(e) {
    if (!e.target.closest('#topbar')) closePanels();
}, true);

/* ── 필터 ─────────────────────────────────────────────────────── */
var DISTRICTS = ['동부', '서부', '남부', '달성', '군위'];

/* 지원청과 급지는 여러 개를 함께 고를 수 있어 목록으로 담는다.
   켜져 있는 것이 곧 '보고 있는 것'이라, 처음에는 모두 켜둔다. */
var DEFAULTS = {
    districts: DISTRICTS.slice(),
    grades: GRADES.slice(),
    minClass: 1,
    research: '미설정',
    ib: '미설정',
    future: '미설정',
    mode: 'and'
};
var filters = JSON.parse(JSON.stringify(DEFAULTS));

/* 항목 이름은 [저장값, 화면표시] 순이다. IB는 칸이 6개라 '지정교/미지정교'를
   그대로 쓰면 폰에서 한 줄에 안 들어간다. 묶음 제목이 이미 'IB학교'라
   '지정/미지정'만으로도 뜻이 통해서 짧게 적는다. */
var CHIP_SETS = {
    fResearch: { key: 'research', items: [['미설정', '전체'], ['지정교', '지정'], ['미지정교', '미지정']] },
    fIb:       { key: 'ib',       items: [['미설정', '전체'], ['지정교', '지정'], ['관심', '관심'],
                                          ['후보', '후보'], ['월드', '월드'], ['미지정교', '미지정']] },
    fFuture:   { key: 'future',   items: [['미설정', '전체'], ['지정교', '지정'], ['미지정교', '미지정']] },
    fMode:     { key: 'mode',     items: [['and', '모두 만족'], ['or', '하나라도']] }
};

function renderChips() {
    Object.keys(CHIP_SETS).forEach(function(id) {
        var set = CHIP_SETS[id];
        document.getElementById(id).innerHTML = set.items.map(function(it) {
            var val = Array.isArray(it) ? it[0] : it;
            var label = Array.isArray(it) ? it[1] : it;
            var on = filters[set.key] === val;
            return '<button class="fchip' + (on ? ' on' : '') + '" data-set="' + id + '" data-val="' + val + '">' + label + '</button>';
        }).join('');
    });

    // 켜진 것이 곧 보고 있는 것이다. 지원청도 여러 개를 함께 고를 수 있다.
    document.getElementById('fDistrict').innerHTML = DISTRICTS.map(function(d) {
        var on = filters.districts.indexOf(d) > -1;
        return '<button class="fchip' + (on ? ' on' : '') + '" data-district="' + d + '">' + d + '</button>';
    }).join('') +
    // 지원청 구역은 학교를 거르는 조건이 아니라 지도에 겹쳐 볼 것을 정하는 스위치다.
    // 지원청별 구분이라는 뜻이 같아 이 줄 끝에 두되, 오른쪽 끝으로 밀어 조건 칩과 구분한다.
    '<button class="fchip bd' + (boundaryOn ? ' on' : '') + '" id="boundaryChip" ' +
    'title="지도에 지원청 경계선 표시">구역</button>';

    // 급지 칩은 색 견본을 함께 보여준다. 이것이 곧 마커 색의 범례다.
    document.getElementById('fGrade').innerHTML = GRADES.map(function(g) {
        var on = filters.grades.indexOf(g) > -1;
        return '<button class="fchip grade' + (on ? ' on' : '') + '" data-grade="' + g + '">' +
               '<i class="sw" style="background:' + toneFor(g).b + '"></i>' + g + '급지</button>';
    }).join('');
}

function activeFilterCount() {
    var n = 0;
    if (filters.districts.length !== DISTRICTS.length) n++;
    if (filters.grades.length !== GRADES.length) n++;
    if (filters.minClass > 1) n++;
    if (filters.research !== '미설정') n++;
    if (filters.ib !== '미설정') n++;
    if (filters.future !== '미설정') n++;
    return n;
}

function updateFilterBadge() {
    var n = activeFilterCount();
    document.getElementById('filterCount').textContent = n;
    document.getElementById('filterCount').style.display = n === 0 ? 'none' : '';
    // 걸린 조건이 없으면 초기화 버튼을 숨겨 검색창에 자리를 내준다.
    document.getElementById('resetBtn').hidden = n === 0;
}

filterPanel.addEventListener('click', function(e) {
    var chip = e.target.closest('.fchip');
    if (!chip) return;

    if (chip.id === 'boundaryChip') { toggleBoundaries(); return; }

    function toggleIn(list, v) {
        var i = list.indexOf(v);
        if (i > -1) list.splice(i, 1);
        else list.push(v);
    }

    if (chip.dataset.grade) {
        toggleIn(filters.grades, chip.dataset.grade);
    } else if (chip.dataset.district) {
        toggleIn(filters.districts, chip.dataset.district);
    } else {
        filters[CHIP_SETS[chip.dataset.set].key] = chip.dataset.val;
    }

    renderChips();
    updateFilterBadge();
    applyFilters();
});

var classRange = document.getElementById('fClass');
classRange.addEventListener('input', function() {
    filters.minClass = parseInt(classRange.value, 10);
    document.getElementById('fClassVal').textContent =
        filters.minClass <= 1 ? '전체' : filters.minClass + '학급';
    updateFilterBadge();
});
classRange.addEventListener('change', applyFilters);


/* 집 버튼은 세 상태를 오간다.
   없음 → 찍기 시작 / 찍는 중 → 취소 / 있음 → 지움
   옮기는 것은 시트의 '변경'으로 한 번에 된다. */
document.getElementById('homeBtn').addEventListener('click', function() {
    if (pickingHome) cancelPickHome();
    else if (homePosition) clearHome();
    else startPickHome();
});
document.getElementById('pickCancel').addEventListener('click', cancelPickHome);
document.getElementById('sSetHome').addEventListener('click', startPickHome);

function applyFilters() {
    var matched = [];

    allEntries.forEach(function(entry) {
        var data = entry.rawData;
        var isMatch = true;

        if (filters.districts.indexOf(String(data['district']).trim()) === -1) isMatch = false;
        if (has(data['grade_class']) && filters.grades.indexOf(String(data['grade_class']).trim()) === -1) isMatch = false;

        var total = parseInt(data['class_total'], 10);
        if (!isNaN(total) && total < filters.minClass) isMatch = false;

        if (isMatch) {
            var activeCount = 0, passCount = 0;

            if (filters.research !== '미설정') {
                activeCount++;
                var hasResearch = has(data['research_topic']);
                if ((filters.research === '지정교' && hasResearch) ||
                    (filters.research === '미지정교' && !hasResearch)) passCount++;
            }

            if (filters.ib !== '미설정') {
                activeCount++;
                var hasIB = has(data['ib_stage']);
                var passIB;
                if (filters.ib === '지정교') passIB = hasIB;
                else if (filters.ib === '미지정교') passIB = !hasIB;
                else passIB = hasIB && String(data['ib_stage']).indexOf(filters.ib) > -1;
                if (passIB) passCount++;
            }

            if (filters.future !== '미설정') {
                activeCount++;
                var hasFuture = has(data['future_total_years']) || has(data['future_year']);
                if ((filters.future === '지정교' && hasFuture) ||
                    (filters.future === '미지정교' && !hasFuture)) passCount++;
            }

            if (activeCount > 0) {
                if (filters.mode === 'and' && passCount < activeCount) isMatch = false;
                if (filters.mode === 'or' && passCount === 0) isMatch = false;
            }
        }

        if (isMatch) matched.push(entry);
    });

    visibleEntries = matched;

    // 걸러진 학교의 시트가 열려 있으면 닫는다.
    if (selectedEntry && matched.indexOf(selectedEntry) === -1) { closeSheet(); clearRoute(); }

    renderMarkers(true);
}

function resetFilters() {
    filters = JSON.parse(JSON.stringify(DEFAULTS));
    classRange.value = 1;
    document.getElementById('fClassVal').textContent = '전체';
    renderChips();
    updateFilterBadge();
    applyFilters();
}

document.getElementById('filterBtn').addEventListener('click', function() {
    var show = !filterPanel.classList.contains('show');
    closePanels();
    if (show) {
        filterPanel.classList.add('show');
        this.classList.add('on');
    }
});
document.getElementById('fApply').addEventListener('click', function() {
    closePanels();
    toast(visibleEntries.length + '개 학교');
});
document.getElementById('fReset').addEventListener('click', resetFilters);
document.getElementById('resetBtn').addEventListener('click', function() {
    resetFilters();
    toast('조건을 모두 해제했습니다.');
});

loadHome();
renderHome();
updateHomeUI();
renderChips();
updateFilterBadge();
settleSheet(false, false);
