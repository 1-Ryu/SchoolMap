/* 우리집 → 학교 자동차 소요시간
   ────────────────────────────────────────────────────────────
   네이버 Directions는 Client Secret을 요구한다. 그 값을 브라우저에 두면
   누구나 읽어서 할당량을 태울 수 있고, 애초에 브라우저에서의 직접 호출도
   막혀 있다. 그래서 이 함수가 사이에 서서 대신 물어본다.

   비밀 키는 저장소에 없다. Vercel의 환경 변수에서 읽는다.
   (Settings → Environment Variables → NCP_CLIENT_ID / NCP_CLIENT_SECRET)

   Vercel의 Root Directory가 templates로 잡혀 있어 이 파일이 templates/api/에
   있어야 /api/commute 로 열린다. */

/* NCP가 인증 체계를 개편하면서 서버 API 주소가 갈렸다. 계정이 어느 쪽에
   속하는지 밖에서는 알 수 없어, 되는 곳을 찾을 때까지 차례로 물어본다.
   한 번 성공한 주소는 기억해두고 다음부터는 그곳만 부른다. */
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

    /* Sensitive로 저장한 값은 대시보드에서 다시 볼 수 없어, 무엇이 들어갔는지
       확인할 방법이 없다. 비밀을 드러내지 않고 확인만 할 수 있도록
       Client ID 앞 네 글자와 두 값의 길이만 알려준다.
       (원인을 잡으면 이 부분은 걷어낸다) */
    if (q.check === '1') {
        res.status(200).json({
            idHead: String(id).slice(0, 4),
            idLen: String(id).length,
            secretLen: String(secret).length,
            idHasSpace: /^\s|\s$/.test(id),
            secretHasSpace: /^\s|\s$/.test(secret)
        });
        return;
    }

    // 좌표는 '경도,위도' 순서다. 위도·경도 순으로 넣으면 엉뚱한 곳을 찾는다.
    var query = '?start=' + slng + ',' + slat +
                '&goal=' + dlng + ',' + dlat +
                '&option=traoptimal';

    var hosts = goodEndpoint ? [goodEndpoint] : ENDPOINTS;
    var tried = [];
    var route = null, usedHost = null;

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
                usedHost = hosts[i];
                goodEndpoint = hosts[i];
                break;
            }
            tried.push({
                host: hosts[i].split('/')[2],
                status: r.status,
                raw: raw ? raw.slice(0, 200) : ''
            });
        }

        if (!route) {
            // 왜 실패했는지 알아야 고칠 수 있다. 네이버가 돌려주는 오류 설명에는
            // 비밀 키가 들어 있지 않다. (원인을 잡으면 이 부분은 걷어낸다)
            res.status(200).json({ ok: false, reason: 'no-route', tried: tried });
            return;
        }

        // 같은 출발지·도착지 요청은 10분간 재사용한다. 실시간 교통이라 그보다 오래
        // 묵히면 값이 어긋나고, 짧게 잡으면 무료 할당량을 불필요하게 쓴다.
        res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=600');
        res.status(200).json({
            ok: true,
            minutes: Math.max(1, Math.round(route.summary.duration / 60000)),
            km: Math.round(route.summary.distance / 100) / 10
        });
    } catch (err) {
        res.status(200).json({ ok: false, reason: 'fetch-failed' });
    }
};
