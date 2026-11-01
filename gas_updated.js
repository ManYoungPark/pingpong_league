/**
 * Google Apps Script (Code.gs) - 구조 2 (완전 서버형 통계 계산 & 구글 드라이브/시트 캐싱)
 *
 * [역할]
 * 1. 금요일 경기 결과 저장 시(doPost):
 *    - raw_data 시트 및 history_snapshots 시트에 대회 기록 저장
 *    - 저장 직후 구글 서버(Apps Script)가 직접 전체 정규 금요일 대회 통계를 재계산하여
 *      구글 스프레드시트 내 'stats_cache' 시트에 JSON 형태로 분할 저장
 * 2. 웹사이트/대시보드 접속 시(doGet):
 *    - ?action=getStats : 'stats_cache' 시트에 저장된 계산 완료 통계 JSON을 재계산 없이 즉시 반환
 *    - ?action=rebuildStats : 구글 서버에서 강제로 통계를 다시 계산하여 'stats_cache' 갱신 후 반환
 *    - ?action=getList / ?action=getData : 지난 대회 기록 조회
 */

var STATS_SHEET_NAME = 'stats_cache';
var SNAPSHOT_SHEET_NAME = 'history_snapshots';
var RAW_POINT_SHEET_NAME = 'raw_data';
var CHUNK_SIZE = 40000; // 구글 시트 단일 셀 50,000자 제한을 피하기 위한 안전한 분할 크기

/**
 * doGet(e)
 * 클라이언트(index.html / dashboard.js / history_viewer.js)에서 데이터 조회 시 호출
 */
function doGet(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'getList';

        // 1. 대회 목록 조회 (날짜, 대회명) - 기존 Code.gs의 metadata.date 우선 추출 로직 100% 호환
        if (action === 'getList') {
            var sheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
            if (!sheet) return createTextResponse({ success: false, msg: 'No data sheet found' });

            var data = sheet.getDataRange().getValues();
            var list = [];
            for (var i = 1; i < data.length; i++) {
                var dStr = formatSheetDate(data[i][0]);
                var title = String(data[i][1] || '');
                var fullDataJson = data[i][2];
                try {
                    var parsed = JSON.parse(fullDataJson);
                    if (parsed && parsed.metadata && parsed.metadata.date) {
                        dStr = formatSheetDate(parsed.metadata.date);
                    }
                } catch (e) {}
                if (!dStr || dStr.indexOf('__STATS_CACHE_') === 0) continue;
                list.push({ date: dStr, title: title });
            }
            return createTextResponse({ success: true, list: list.reverse() });
        }

        // 2. 특정 날짜의 전체 데이터 조회 - 기존 Code.gs의 metadata.date 매칭 로직 100% 호환
        if (action === 'getData') {
            var targetDate = String(e.parameter.date || '');
            var targetTitle = String(e.parameter.title || '');
            var sheet2 = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
            if (!sheet2) return createTextResponse({ success: false, msg: 'No data sheet found' });

            var data2 = sheet2.getDataRange().getValues();
            for (var j = data2.length - 1; j >= 1; j--) {
                var rowDate = formatSheetDate(data2[j][0]);
                var rowTitle = String(data2[j][1] || '');
                var fullDataJson2 = data2[j][2];
                try {
                    var parsed2 = JSON.parse(fullDataJson2);
                    if (parsed2 && parsed2.metadata && parsed2.metadata.date) {
                        rowDate = formatSheetDate(parsed2.metadata.date);
                    }
                } catch (e) {}
                if (rowDate === targetDate && (!targetTitle || rowTitle === targetTitle)) {
                    return createTextResponse({ success: true, fullData: fullDataJson2 });
                }
            }
            return createTextResponse({ success: false, msg: 'Data not found for: ' + targetDate });
        }

        // 3. 서버에 저장된 사전 계산 통계 조회 (재계산 없이 즉시 반환, 서명 불일치 시 서버에서 자동 재계산)
        if (action === 'getStats') {
            var cachedStats = readStatsCacheFromSheet(ss);
            var currentSig = computeCurrentSignature(ss);
            if (cachedStats && cachedStats.signature === currentSig && cachedStats.tourneyCount > 0) {
                return createTextResponse({
                    success: true,
                    fromServerCache: true,
                    stats: cachedStats
                });
            }
            var rebuilt = rebuildStatsCacheOnServer(ss);
            return createTextResponse({
                success: true,
                fromServerCache: false,
                stats: rebuilt
            });
        }

        // 4. 서버에서 강제 통계 재계산 후 반환 ('🔄 최신 동기화 (재계산)' 버튼용)
        if (action === 'rebuildStats') {
            var forcedStats = rebuildStatsCacheOnServer(ss);
            return createTextResponse({
                success: true,
                fromServerCache: false,
                stats: forcedStats
            });
        }

        return createTextResponse({ success: false, msg: 'Invalid action' });
    } catch (err) {
        return createTextResponse({ success: false, msg: err.toString() });
    }
}

/**
 * doPost(e)
 * 경기 종료 후 '📤 서버에 결과저장' 클릭 시 호출
 */
function doPost(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();

        // 1. 시트 준비
        var pointSheet = ss.getSheetByName(RAW_POINT_SHEET_NAME);
        if (!pointSheet) {
            pointSheet = ss.insertSheet(RAW_POINT_SHEET_NAME);
            pointSheet.appendRow(['날짜', '이름', '구분', '획득점수', '상세결과']);
        }

        var snapshotSheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
        if (!snapshotSheet) {
            snapshotSheet = ss.insertSheet(SNAPSHOT_SHEET_NAME);
            snapshotSheet.appendRow(['날짜', '대회명', '전체데이터JSON']);
        }

        // 2. 데이터 파싱
        var data = JSON.parse(e.postData.contents);
        var date = String(data.date || '');

        // 강제 통계 재계산 요청만 온 경우 처리
        if (data.action === 'rebuildStats') {
            var rebuiltOnly = rebuildStatsCacheOnServer(ss);
            return createTextResponse({ success: true, stats: rebuiltOnly });
        }

        // 기존 Code.gs 로직 100% 유지: 데이터 내부의 진짜 날짜(full.metadata.date)가 있다면 그것을 우선 사용
        var snapshotData = null;
        if (data.fullData) {
            snapshotData = JSON.parse(data.fullData);
            if (snapshotData.metadata && snapshotData.metadata.date) {
                date = String(snapshotData.metadata.date);
            }
        }

        // 3. [개인별 포인트] 저장
        if (data.results && data.results.length > 0) {
            var pointRows = [];
            for (var i = 0; i < data.results.length; i++) {
                var r = data.results[i];
                pointRows.push([date, r.name, r.type, r.points, r.detail]);
            }
            pointSheet.getRange(pointSheet.getLastRow() + 1, 1, pointRows.length, 5).setValues(pointRows);
        }

        // 4. [대회 전체 스냅샷] 저장 (동일 날짜+대회명이 이미 있으면 덮어써서 중복 방지)
        if (data.fullData && snapshotData) {
            var tournamentTitle = (snapshotData.metadata && snapshotData.metadata.title) ? snapshotData.metadata.title : '제목없음';

            var existingRows = snapshotSheet.getDataRange().getValues();
            var updatedExisting = false;
            for (var rIdx = existingRows.length - 1; rIdx >= 1; rIdx--) {
                var existingDate = formatSheetDate(existingRows[rIdx][0]);
                try {
                    var exParsed = JSON.parse(existingRows[rIdx][2]);
                    if (exParsed && exParsed.metadata && exParsed.metadata.date) {
                        existingDate = formatSheetDate(exParsed.metadata.date);
                    }
                } catch (e2) {}
                if (existingDate === date && String(existingRows[rIdx][1] || '') === tournamentTitle) {
                    snapshotSheet.getRange(rIdx + 1, 3).setValue(data.fullData);
                    updatedExisting = true;
                    break;
                }
            }
            if (!updatedExisting) {
                snapshotSheet.appendRow([date, tournamentTitle, data.fullData]);
            }

            // 5. [비동기 백그라운드 트리거] 사용자는 스냅샷 저장 즉시 응답을 받고 화면을 끝낼 수 있도록
            // doPost에서는 통계 계산을 기다리지 않고 즉시 응답을 반환합니다.
            scheduleAsyncStatsRebuild();
        }

        return ContentService.createTextOutput('Success').setMimeType(ContentService.MimeType.TEXT);
    } catch (err) {
        return ContentService.createTextOutput('Error: ' + err.toString()).setMimeType(ContentService.MimeType.TEXT);
    }
}

/**
 * 구글 서버 백그라운드에서 비동기로 통계 재계산을 예약 (사용자 대기시간 0초)
 */
function scheduleAsyncStatsRebuild() {
    try {
        var triggers = ScriptApp.getProjectTriggers();
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].getHandlerFunction() === 'asyncRebuildStatsTriggerHandler') {
                ScriptApp.deleteTrigger(triggers[i]);
            }
        }
        ScriptApp.newTrigger('asyncRebuildStatsTriggerHandler')
            .timeBased()
            .after(1000)
            .create();
    } catch (e) {
        // 트리거 권한이 없는 경우에도 클라이언트의 keepalive 비동기 호출(?action=rebuildStats)이 백그라운드에서 실행됨
    }
}

function asyncRebuildStatsTriggerHandler() {
    try {
        var triggers = ScriptApp.getProjectTriggers();
        for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].getHandlerFunction() === 'asyncRebuildStatsTriggerHandler') {
                ScriptApp.deleteTrigger(triggers[i]);
            }
        }
    } catch (e) {}
    rebuildStatsCacheOnServer(SpreadsheetApp.getActiveSpreadsheet());
}

function createTextResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function formatSheetDate(val) {
    if (!val) return '';
    if (Object.prototype.toString.call(val) === '[object Date]') {
        return Utilities.formatDate(val, 'Asia/Seoul', 'yyyy-MM-dd');
    }
    var s = String(val).trim();
    if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) {
        return s.slice(0, 10);
    }
    return s;
}

/**
 * 금요일 정규 대회 여부 판별 (테스트/더미/번외경기 제외)
 */
function isDummyOrTestSnapshotServer(dateStr, titleStr, fullData) {
    if (!fullData) return true;
    var date = String((fullData.metadata && fullData.metadata.date) || dateStr || '').slice(0, 10);
    var title = String((fullData.metadata && fullData.metadata.title) || titleStr || '');

    if (!date || date.indexOf('__STATS_CACHE_') === 0) return true;

    // 1. 2026-01-30 첫 정규 금요리그 이전의 초기 테스트 데이터 제외
    if (date < '2026-01-30') return true;

    // 2. 번외경기 / 테스트 / 시뮬레이션 제외
    if (title.indexOf('번외경기') !== -1 || title.indexOf('테스트') !== -1 || title.indexOf('시뮬레이션') !== -1) {
        return true;
    }

    // 3. 금요일(getDay() === 5)이 아닌 기록 제외
    var parts = date.split('-');
    if (parts.length === 3) {
        var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        if (!isNaN(dt.getTime()) && dt.getDay() !== 5) return true;
    }

    // 4. 가나다순 고정 1조 더미 테스트 패턴 제외
    var pStateArr = Array.isArray(fullData.playersState) ? fullData.playersState : [];
    var t1 = [];
    for (var i = 0; i < pStateArr.length; i++) {
        var entry = pStateArr[i];
        if (entry && entry[1] && entry[1].where === 'team' && entry[1].teamId === 'team-1') {
            t1.push(entry[0]);
        }
    }
    if (t1.length === 5 && t1.join(',') === '김경태,김미경,김성호,김세중,김형찬') {
        return true;
    }

    return false;
}

/**
 * 현재 history_snapshots 시트의 정규 금요리그 서명(signature) 계산
 */
function computeCurrentSignature(ss) {
    var sheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
    if (!sheet) return 'v2_0_none';
    var data = sheet.getDataRange().getValues();
    var seen = {};
    var validDates = [];

    for (var i = 1; i < data.length; i++) {
        var dStr = formatSheetDate(data[i][0]);
        var tStr = String(data[i][1] || '');
        var rawJson = data[i][2];
        try {
            var pMeta = (typeof rawJson === 'string') ? JSON.parse(rawJson) : rawJson;
            if (pMeta && pMeta.metadata && pMeta.metadata.date) {
                dStr = formatSheetDate(pMeta.metadata.date);
            }
        } catch (e) {}
        if (!dStr || dStr.indexOf('__STATS_CACHE_') === 0) continue;
        if (dStr < '2026-01-30') continue;
        if (tStr.indexOf('번외경기') !== -1 || tStr.indexOf('테스트') !== -1 || tStr.indexOf('시뮬레이션') !== -1) continue;

        var parts = dStr.split('-');
        if (parts.length === 3) {
            var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            if (!isNaN(dt.getTime()) && dt.getDay() !== 5) continue;
        }
        var key = dStr + '___' + tStr;
        if (!seen[key]) {
            seen[key] = true;
            validDates.push(dStr);
        }
    }
    validDates.sort();
    var latest = validDates.length > 0 ? validDates[validDates.length - 1] : 'none';
    return 'v2_' + validDates.length + '_' + latest;
}

/**
 * 구글 서버(Apps Script)에서 직접 전체 통계를 계산하고 'stats_cache' 시트에 저장
 */
function rebuildStatsCacheOnServer(ss) {
    if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SNAPSHOT_SHEET_NAME);
    if (!sheet) return null;

    var data = sheet.getDataRange().getValues();
    var uniqueMap = {};
    var uniqueKeys = [];

    for (var i = 1; i < data.length; i++) {
        var dStr = formatSheetDate(data[i][0]);
        var tStr = String(data[i][1] || '');
        var rawJson = data[i][2];
        if (!rawJson) continue;

        try {
            var parsed = (typeof rawJson === 'string') ? JSON.parse(rawJson) : rawJson;
            if (parsed && parsed.metadata && parsed.metadata.date) {
                dStr = formatSheetDate(parsed.metadata.date);
            }
            if (!dStr || dStr.indexOf('__STATS_CACHE_') === 0) continue;
            if (isDummyOrTestSnapshotServer(dStr, tStr, parsed)) continue;
            var key = dStr + '___' + tStr;
            if (!uniqueMap[key]) uniqueKeys.push(key);
            uniqueMap[key] = { date: dStr, title: tStr, fullData: parsed };
        } catch (err) {
            // 손상된 JSON 행 무시
        }
    }

    uniqueKeys.sort();
    var validSnaps = [];
    for (var k = 0; k < uniqueKeys.length; k++) {
        validSnaps.push(uniqueMap[uniqueKeys[k]]);
    }

    var latestDate = validSnaps.length > 0 ? validSnaps[validSnaps.length - 1].date : 'none';
    var signature = 'v2_' + validSnaps.length + '_' + latestDate;

    var playersObj = {};
    var snapshotGrades = {};
    var summaryList = [];
    var allMatches = [];

    function ensurePlayer(nm) {
        if (!playersObj[nm]) {
            playersObj[nm] = {
                name: nm,
                grade: snapshotGrades[nm] || null,
                totalPoints: 0,
                attendCount: 0,
                upperWins: 0,
                upperRunners: 0,
                upperSemis: 0,
                lowerWins: 0,
                lowerRunners: 0,
                matchesPlayed: 0,
                matchesWon: 0,
                matchesLost: 0,
                groupPlayed: 0,
                groupWon: 0,
                bracketPlayed: 0,
                bracketWon: 0,
                setsFor: 0,
                setsAgainst: 0,
                tourneyHistory: [],
                opponentsMap: {}
            };
        } else if (!playersObj[nm].grade && snapshotGrades[nm]) {
            playersObj[nm].grade = snapshotGrades[nm];
        }
        return playersObj[nm];
    }

    function ensureOpp(pObj, oppName) {
        if (!pObj.opponentsMap[oppName]) {
            pObj.opponentsMap[oppName] = {
                name: oppName,
                coAttend: 0,
                sameGroup: 0,
                played: 0,
                win: 0,
                lose: 0,
                setsFor: 0,
                setsAgainst: 0
            };
        }
        return pObj.opponentsMap[oppName];
    }

    for (var sIdx = 0; sIdx < validSnaps.length; sIdx++) {
        var item = validSnaps[sIdx];
        var fullData = item.fullData;
        var date = String((fullData.metadata && fullData.metadata.date) || item.date || '').slice(0, 10);
        var title = String((fullData.metadata && fullData.metadata.title) || item.title || '정기리그');
        var isFull = (fullData.tournamentType === 'full');

        var attendeesSet = {};
        var teamByPlayer = {};
        var pStateArr = Array.isArray(fullData.playersState) ? fullData.playersState : [];

        for (var pIdx = 0; pIdx < pStateArr.length; pIdx++) {
            var pEntry = pStateArr[pIdx];
            var nm = pEntry[0];
            var val = pEntry[1];
            if (!nm || nm === 'BYE' || nm === '?') continue;
            if (val && typeof val === 'object') {
                if (val.grade) snapshotGrades[nm] = val.grade;
                if (val.where === 'team') {
                    attendeesSet[nm] = true;
                    if (val.teamId) teamByPlayer[nm] = val.teamId;
                }
            }
        }

        var dayStats = {};
        function bumpDay(nm, isWin) {
            if (!dayStats[nm]) dayStats[nm] = { win: 0, lose: 0 };
            if (isWin) dayStats[nm].win++;
            else dayStats[nm].lose++;
        }

        function recordMatchPair(p1, p2, s1, s2, stage) {
            if (!p1 || !p2 || p1 === 'BYE' || p2 === 'BYE' || p1 === '?' || p2 === '?' || p1 === p2) return;
            if (isNaN(s1) || isNaN(s2) || (s1 === 0 && s2 === 0)) return;

            attendeesSet[p1] = true;
            attendeesSet[p2] = true;

            var winner = s1 > s2 ? p1 : (s2 > s1 ? p2 : null);
            if (!winner) return;

            allMatches.push({
                date: date,
                stage: stage,
                p1: p1,
                p2: p2,
                score: s1 + '-' + s2,
                winner: winner
            });

            var obj1 = ensurePlayer(p1);
            var obj2 = ensurePlayer(p2);
            var p1Win = (winner === p1);

            obj1.matchesPlayed++;
            obj2.matchesPlayed++;
            if (p1Win) { obj1.matchesWon++; obj2.matchesLost++; }
            else { obj2.matchesWon++; obj1.matchesLost++; }

            if (stage === '예선') {
                obj1.groupPlayed++; obj2.groupPlayed++;
                if (p1Win) obj1.groupWon++; else obj2.groupWon++;
            } else {
                obj1.bracketPlayed++; obj2.bracketPlayed++;
                if (p1Win) obj1.bracketWon++; else obj2.bracketWon++;
            }

            obj1.setsFor += s1; obj1.setsAgainst += s2;
            obj2.setsFor += s2; obj2.setsAgainst += s1;

            bumpDay(p1, p1Win);
            bumpDay(p2, !p1Win);

            var opp12 = ensureOpp(obj1, p2);
            opp12.played++;
            if (p1Win) opp12.win++; else opp12.lose++;
            opp12.setsFor += s1; opp12.setsAgainst += s2;

            var opp21 = ensureOpp(obj2, p1);
            opp21.played++;
            if (!p1Win) opp21.win++; else opp21.lose++;
            opp21.setsFor += s2; opp21.setsAgainst += s1;
        }

        // 예선 리그전
        var resByTeamArr = Array.isArray(fullData.resultsByTeam) ? fullData.resultsByTeam : [];
        for (var tIdx = 0; tIdx < resByTeamArr.length; tIdx++) {
            var pairList = resByTeamArr[tIdx][1];
            if (!Array.isArray(pairList)) continue;
            for (var mIdx = 0; mIdx < pairList.length; mIdx++) {
                var pairKey = pairList[mIdx][0];
                var resObj = pairList[mIdx][1];
                if (!pairKey || !resObj || !resObj.score) continue;
                var players = String(pairKey).split('|||');
                if (players.length !== 2) continue;
                var pts = String(resObj.score).split('-');
                if (pts.length !== 2) continue;
                recordMatchPair(players[0], players[1], parseInt(pts[0], 10), parseInt(pts[1], 10), '예선');
            }
        }

        // 본선 토너먼트
        var bStateArr = Array.isArray(fullData.bracketState) ? fullData.bracketState : [];
        for (var bIdx = 0; bIdx < bStateArr.length; bIdx++) {
            var nodeKey = bStateArr[bIdx][0];
            var bVal = bStateArr[bIdx][1];
            if (!nodeKey || !bVal || typeof bVal !== 'object') continue;
            var bp1 = bVal.p1, bp2 = bVal.p2, bWinner = bVal.winner;
            if (!bp1 || !bp2 || bp1 === 'BYE' || bp2 === 'BYE' || !bWinner || bWinner === 'BYE') continue;

            var bs1 = 0, bs2 = 0;
            if (bVal.score && String(bVal.score).indexOf('-') !== -1) {
                var sp = String(bVal.score).split('-');
                bs1 = parseInt(sp[0], 10);
                bs2 = parseInt(sp[1], 10);
                if (bWinner === bp1 && bs1 < bs2) { var tmp1 = bs1; bs1 = bs2; bs2 = tmp1; }
                if (bWinner === bp2 && bs2 < bs1) { var tmp2 = bs1; bs1 = bs2; bs2 = tmp2; }
            } else {
                bs1 = (bWinner === bp1) ? 2 : 0;
                bs2 = (bWinner === bp2) ? 2 : 0;
            }
            var stageLabel = (String(nodeKey).indexOf('L-') === 0) ? '본선(하위)' : '본선(상위)';
            recordMatchPair(bp1, bp2, bs1, bs2, stageLabel);
        }

        // 동반 출전 집계
        var attendeeList = Object.keys(attendeesSet);
        for (var a1 = 0; a1 < attendeeList.length; a1++) {
            var A = attendeeList[a1];
            var objA = ensurePlayer(A);
            for (var a2 = a1 + 1; a2 < attendeeList.length; a2++) {
                var B = attendeeList[a2];
                var objB = ensurePlayer(B);
                var oppAB = ensureOpp(objA, B);
                var oppBA = ensureOpp(objB, A);
                oppAB.coAttend++;
                oppBA.coAttend++;
                if (teamByPlayer[A] && teamByPlayer[A] === teamByPlayer[B]) {
                    oppAB.sameGroup++;
                    oppBA.sameGroup++;
                }
            }
        }

        // 대회 입상 및 포인트 집계
        var upper = (fullData.finalSummary && fullData.finalSummary.upper) ? fullData.finalSummary.upper : {};
        var lower = (fullData.finalSummary && fullData.finalSummary.lower) ? fullData.finalSummary.lower : {};
        function cleanName(nm) {
            return (nm && nm !== '-' && nm !== '미정' && nm !== '?') ? String(nm).trim() : null;
        }
        var uWinner = cleanName(upper.winner);
        var uRunner = cleanName(upper.runnerUp);
        var uSemis = [];
        if (Array.isArray(upper.semiFinalists)) {
            for (var sf = 0; sf < upper.semiFinalists.length; sf++) {
                var cn = cleanName(upper.semiFinalists[sf]);
                if (cn) uSemis.push(cn);
            }
        } else if (cleanName(upper.third)) {
            var thirdParts = String(upper.third).split(',');
            for (var tp = 0; tp < thirdParts.length; tp++) {
                var cn2 = cleanName(thirdParts[tp]);
                if (cn2) uSemis.push(cn2);
            }
        }
        var lWinner = cleanName(lower.winner);
        var lRunner = cleanName(lower.runnerUp);

        var podiumNames = [uWinner, uRunner, lWinner, lRunner].concat(uSemis);
        for (var pn = 0; pn < podiumNames.length; pn++) {
            if (podiumNames[pn]) attendeesSet[podiumNames[pn]] = true;
        }

        var finalAttendeeNames = Object.keys(attendeesSet);
        summaryList.push({
            date: date,
            title: title,
            winner: uWinner,
            runnerUp: uRunner,
            winnerLower: lWinner,
            runnerUpLower: lRunner,
            participants: finalAttendeeNames.length
        });

        var dayPointsMap = {};
        for (var fa = 0; fa < finalAttendeeNames.length; fa++) {
            dayPointsMap[finalAttendeeNames[fa]] = { pts: 2, details: ['참가(+2)'] };
        }
        function addBonus(nm, bonus, label) {
            if (!nm) return;
            if (!dayPointsMap[nm]) dayPointsMap[nm] = { pts: 2, details: ['참가(+2)'] };
            dayPointsMap[nm].pts += bonus;
            dayPointsMap[nm].details.push(label + '(+' + bonus + ')');
        }

        if (isFull) {
            if (uWinner) { addBonus(uWinner, 6, '전체 우승'); ensurePlayer(uWinner).upperWins++; }
            if (uRunner) { addBonus(uRunner, 5, '전체 준우승'); ensurePlayer(uRunner).upperRunners++; }
            for (var us1 = 0; us1 < uSemis.length; us1++) {
                addBonus(uSemis[us1], 4, '전체 4강');
                ensurePlayer(uSemis[us1]).upperSemis++;
            }
        } else {
            if (uWinner) { addBonus(uWinner, 5, '상위 우승'); ensurePlayer(uWinner).upperWins++; }
            if (uRunner) { addBonus(uRunner, 4, '상위 준우승'); ensurePlayer(uRunner).upperRunners++; }
            for (var us2 = 0; us2 < uSemis.length; us2++) {
                addBonus(uSemis[us2], 3, '상위 4강');
                ensurePlayer(uSemis[us2]).upperSemis++;
            }
            if (lWinner) { addBonus(lWinner, 4, '하위 우승'); ensurePlayer(lWinner).lowerWins++; }
            if (lRunner) { addBonus(lRunner, 3, '하위 준우승'); ensurePlayer(lRunner).lowerRunners++; }
        }

        var dpKeys = Object.keys(dayPointsMap);
        for (var dk = 0; dk < dpKeys.length; dk++) {
            var pName = dpKeys[dk];
            var pVal = dayPointsMap[pName];
            var pObj = ensurePlayer(pName);
            pObj.attendCount++;
            pObj.totalPoints += pVal.pts;
            var ds = dayStats[pName] || { win: 0, lose: 0 };
            pObj.tourneyHistory.push({
                date: date,
                points: pVal.pts,
                cumulativePoints: pObj.totalPoints,
                detail: pVal.details.join(', '),
                dayWin: ds.win,
                dayLose: ds.lose
            });
        }
    }

    // 직렬화 가능한 playersEntries 생성
    var playersEntries = [];
    var allPlayerNames = Object.keys(playersObj);
    for (var pi = 0; pi < allPlayerNames.length; pi++) {
        var pNameKey = allPlayerNames[pi];
        var pl = playersObj[pNameKey];
        var oppEntries = [];
        var oppNames = Object.keys(pl.opponentsMap);
        for (var oi = 0; oi < oppNames.length; oi++) {
            var onm = oppNames[oi];
            oppEntries.push([onm, pl.opponentsMap[onm]]);
        }
        playersEntries.push([
            pNameKey,
            {
                name: pl.name,
                grade: pl.grade,
                totalPoints: pl.totalPoints,
                attendCount: pl.attendCount,
                upperWins: pl.upperWins,
                upperRunners: pl.upperRunners,
                upperSemis: pl.upperSemis,
                lowerWins: pl.lowerWins,
                lowerRunners: pl.lowerRunners,
                matchesPlayed: pl.matchesPlayed,
                matchesWon: pl.matchesWon,
                matchesLost: pl.matchesLost,
                groupPlayed: pl.groupPlayed,
                groupWon: pl.groupWon,
                bracketPlayed: pl.bracketPlayed,
                bracketWon: pl.bracketWon,
                setsFor: pl.setsFor,
                setsAgainst: pl.setsAgainst,
                tourneyHistory: pl.tourneyHistory,
                opponents: oppEntries
            }
        ]);
    }

    var statsObj = {
        signature: signature,
        updatedAt: new Date().toISOString(),
        tourneyCount: validSnaps.length,
        totalMatches: allMatches.length,
        summaryList: summaryList,
        allMatches: allMatches,
        playersEntries: playersEntries
    };

    saveStatsCacheToSheet(ss, statsObj);
    return statsObj;
}

/**
 * 계산된 통계 JSON을 구글 시트의 'stats_cache' 탭에 분할 저장
 */
function saveStatsCacheToSheet(ss, statsObj) {
    var cacheSheet = ss.getSheetByName(STATS_SHEET_NAME);
    if (!cacheSheet) {
        cacheSheet = ss.insertSheet(STATS_SHEET_NAME);
    } else {
        cacheSheet.clear();
    }

    var jsonStr = JSON.stringify(statsObj);
    var rows = [['signature', 'updatedAt', 'chunkIndex', 'jsonChunk']];
    var chunkIdx = 0;
    for (var pos = 0; pos < jsonStr.length; pos += CHUNK_SIZE) {
        rows.push([
            statsObj.signature,
            statsObj.updatedAt,
            chunkIdx,
            jsonStr.slice(pos, pos + CHUNK_SIZE)
        ]);
        chunkIdx++;
    }

    cacheSheet.getRange(1, 1, rows.length, 4).setValues(rows);
}

/**
 * 구글 시트의 'stats_cache' 탭에서 저장된 통계 JSON을 읽어 반환
 */
function readStatsCacheFromSheet(ss) {
    var cacheSheet = ss.getSheetByName(STATS_SHEET_NAME);
    if (!cacheSheet) return null;

    var data = cacheSheet.getDataRange().getValues();
    if (!data || data.length < 2) return null;

    var chunks = [];
    for (var i = 1; i < data.length; i++) {
        chunks.push(String(data[i][3] || ''));
    }
    var fullJson = chunks.join('');
    if (!fullJson) return null;

    try {
        return JSON.parse(fullJson);
    } catch (e) {
        return null;
    }
}
