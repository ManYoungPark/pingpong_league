// 구글 시트 스크립트 (Code.gs)
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('raw_data');
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet('raw_data');
    sheet.appendRow(['날짜', '이름', '구분', '획득점수', '상세결과']); // 헤더 생성
  }
  
  // 데이터 파싱
  var data = JSON.parse(e.postData.contents);
  var date = data.date;
  var rows = [];
  
  // 전송된 결과 목록을 시트에 행으로 추가
  if (data.results && data.results.length > 0) {
    for (var i = 0; i < data.results.length; i++) {
        var r = data.results[i];
        rows.push([date, r.name, r.type, r.points, r.detail]);
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  }
  
  return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}

// doPost 함수 테스트용 (e 객체를 가짜로 만듦)
function testDoPost() {
  // 가상의 요청 데이터 (e)
  var mockEvent = {
    postData: {
      contents: JSON.stringify({
        date: "2024-01-01 (TEST)",
        results: [
          { name: "테스트맨", type: "테스트", points: 99, detail: "직접 실행 테스트" }
        ]
      })
    }
  };
  
  // doPost 실행
  doPost(mockEvent);
}

