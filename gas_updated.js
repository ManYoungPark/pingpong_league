/**
 * doGet(e)
 * 클라이언트(history_viewer)에서 기록 목록이나 특정 데이터를 조회할 때 호출됩니다.
 */
function doGet(e) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = e.parameter.action;

    // 1. 대회 목록 조회 (날짜, 대회명)
    if (action === 'getList') {
        var sheet = ss.getSheetByName('history_snapshots');
        if (!sheet) return createTextResponse({ success: false, msg: 'No data' });

        var data = sheet.getDataRange().getValues();
        var list = [];
        for (var i = 1; i < data.length; i++) { // 헤더 제외
            list.push({ date: data[i][0], title: data[i][1] });
        }
        return createTextResponse({ success: true, list: list.reverse() }); // 최근순
    }

    // 2. 특정 날짜의 전체 데이터 조회
    if (action === 'getData') {
        var date = e.parameter.date;
        var sheet = ss.getSheetByName('history_snapshots');
        if (!sheet) return createTextResponse({ success: false, msg: 'No data' });

        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
            if (String(data[i][0]) === date) {
                return createTextResponse({ success: true, fullData: data[i][2] });
            }
        }
        return createTextResponse({ success: false, msg: 'Data not found' });
    }

    return createTextResponse({ success: false, msg: 'Invalid action' });
}

function createTextResponse(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// 개선된 구글 시트 스크립트 (Code.gs)
function doPost(e) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. 시트 설정
    var pointSheet = ss.getSheetByName('raw_data');
    if (!pointSheet) {
        pointSheet = ss.insertSheet('raw_data');
        pointSheet.appendRow(['날짜', '이름', '구분', '획득점수', '상세결과']);
    }

    var snapshotSheet = ss.getSheetByName('history_snapshots');
    if (!snapshotSheet) {
        snapshotSheet = ss.insertSheet('history_snapshots');
        snapshotSheet.appendRow(['날짜', '대회명', '전체데이터JSON']);
    }

    // 2. 데이터 파싱
    var data = JSON.parse(e.postData.contents);
    var date = data.date;

    // 3. [개인별 포인트] 저장 (기존 로직 유지)
    if (data.results && data.results.length > 0) {
        var pointRows = [];
        for (var i = 0; i < data.results.length; i++) {
            var r = data.results[i];
            pointRows.push([date, r.name, r.type, r.points, r.detail]);
        }
        pointSheet.getRange(pointSheet.getLastRow() + 1, 1, pointRows.length, 5).setValues(pointRows);
    }

    // 4. [대회 전체 스냅샷] 저장 (신규 추가)
    // 경기 날짜별로 딱 한 줄만 기록하여 관리 효율 극대화
    if (data.fullData) {
        var snapshotData = JSON.parse(data.fullData);
        var tournamentTitle = snapshotData.metadata ? snapshotData.metadata.title : "제목없음";
        snapshotSheet.appendRow([date, tournamentTitle, data.fullData]);
    }

    return ContentService.createTextOutput("Success - Total Snapshot Saved").setMimeType(ContentService.MimeType.TEXT);
}

// doPost 함수 테스트용
function testDoPost() {
    var mockEvent = {
        postData: {
            contents: JSON.stringify({
                date: "2024-01-24 (TEST)",
                results: [
                    { name: "테스트맨", type: "우승", points: 10, detail: "테스트" }
                ],
                fullData: JSON.stringify({
                    metadata: { title: "테스트 대회" },
                    playersState: [],
                    resultsByTeam: [],
                    bracketState: []
                })
            })
        }
    };
    doPost(mockEvent);
}
