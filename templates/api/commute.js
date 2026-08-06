/* 우리집 → 학교 자동차 소요시간
   ────────────────────────────────────────────────────────────
   네이버 Directions는 Client Secret을 요구한다. 그 값을 브라우저에 두면
   누구나 읽어서 할당량을 태울 수 있고, 애초에 브라우저에서의 직접 호출도
   막혀 있다. 그래서 이 함수가 사이에 서서 대신 물어본다.

   비밀 키는 저장소에 없다. Vercel의 환경 변수에서 읽는다.
   (Settings → Environment Variables → NCP_CLIENT_ID / NCP_CLIENT_SECRET)

   Vercel의 Root Directory가 templates로 잡혀 있어 이 파일이 templates/api/에
   있어야 /api/commute 로 열린다. */

/* 주소가 두 개인 이유 —
   NCP가 인증 체계를 개편하면서 서버 API 주소가 maps.apigw.ntruss.com 으로
   옮겨갔는데, 공식 문서에는 아직 옛 주소(naveropenapi)가 적혀 있다.
   옛 주소로 부르면 키가 멀쩡해도 "A subscription to the API is required"
   라는 엉뚱한 오류가 돌아와서 원인을 찾는 데 한참 걸렸다.
   지금 계정은 새 주소를 쓰지만, 나중에 또 바뀔 수 있으니 차례로 시도한다.
   한 번 성공한 주소는 기억해뒀다가 다음부터는 그곳만 부른다. */
var ENDPOINTS = [
    'https://maps.apigw.ntruss.com/map-direction/v1/driving',
    'https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving'
];
var goodEndpoint = null;

module.exports = async function handler(req, res) {
    var q = req.query || {};
    var slat = Number(q.slat), slng = Number(q.slng);
    var dlat = Number(q.dlat), dlng = Number(q.dlng);

    if (![slat, slng, dlat, dlng].every(isFinite)) {
        res.status(400).json({ ok: false, reason: 'bad-coords' });
        return;
    }

    var id = process.env.NCP_CLIENT_ID;
    var secret = process.env.NCP_CLIENT_SECRET;
    if (!id || !secret) {
        res.status(200).json({ ok: false, reason: 'no-key' });
        return;
    }

    // 좌표는 '경도,위도' 순서다. 위도·경도 순으로 넣으면 엉뚱한 곳을 찾는다.
    var query = '?start=' + slng + ',' + slat +
                '&goal=' + dlng + ',' + dlat +
                '&option=traoptimal';

    var hosts = goodEndpoint ? [goodEndpoint] : ENDPOINTS;
    var tried = [];
    var route = null;

    try {
        for (var i = 0; i < hosts.length; i++) {
            var r = await fetch(hosts[i] + query, {
                headers: {
                    'x-ncp-apigw-api-key-id': id,
                    'x-ncp-apigw-api-key': secret
                }
            });
            var raw = await r.text();
            var data;
            try { data = JSON.parse(raw); } catch (e) { data = null; }

            var found = data && data.route && data.route.traoptimal && data.route.traoptimal[0];
            if (found && found.summary) {
                route = found;
                goodEndpoint = hosts[i];
                break;
            }
            tried.push(hosts[i].split('/')[2] + ':' + r.status);
        }

        if (!route) {
            console.error('Directions 실패:', tried.join(', '));
            res.status(200).json({ ok: false, reason: 'no-route' });
            return;
        }

        // 같은 출발지·도착지 요청은 10분간 재사용한다. 실시간 교통이라 그보다 오래
        // 묵히면 값이 어긋나고, 짧게 잡으면 무료 할당량을 불필요하게 쓴다.
        res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
        res.status(200).json({
            ok: true,
            minutes: Math.max(1, Math.round(route.summary.duration / 60000)),
            km: Math.round(route.summary.distance / 100) / 10,
            // 경로 좌표는 [경도, 위도] 목록이다. 점이 수백 개라 그대로 그리면
            // 무거우므로, 화면에 올릴 때 솎아낸다. (app.js의 simplifyRing)
            path: route.path || []
        });
    } catch (err) {
        res.status(200).json({ ok: false, reason: 'fetch-failed' });
    }
};
