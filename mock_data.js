/**
 * mock_data.js
 * 테스트를 위한 가상의 토너먼트 기록 데이터
 */

window.MOCK_DATA = {
    // 1. 대회 요약 정보 (Summary)
    summary: [
        { date: "2025-10-15", winner: "박만영", runnerUp: "김경태", winnerLower: "강희철", runnerUpLower: "김미경", participants: 24, type: "정기모임" },
        { date: "2025-10-22", winner: "이정우", runnerUp: "박병재", winnerLower: "김성호", runnerUpLower: "김세중", participants: 20, type: "번개" },
        { date: "2025-10-29", winner: "김경태", runnerUp: "안성대", winnerLower: "김순동", runnerUpLower: "김영민", participants: 22, type: "정기모임" },
        { date: "2025-11-05", winner: "박만영", runnerUp: "이정우", winnerLower: "김형찬", runnerUpLower: "김홍석", participants: 25, type: "정기모임" },
        { date: "2025-11-12", winner: "유호성", runnerUp: "조복연", winnerLower: "류계열", runnerUpLower: "류성문", participants: 18, type: "번개" },
        { date: "2025-11-19", winner: "박병재", runnerUp: "강희철", winnerLower: "박덕례", runnerUpLower: "박수용", participants: 21, type: "정기모임" },
        { date: "2025-11-26", winner: "안성대", runnerUp: "김미경", winnerLower: "박혜란", runnerUpLower: "백낙천", participants: 23, type: "정기모임" },
        { date: "2025-12-03", winner: "박만영", runnerUp: "김경태", winnerLower: "서상국", runnerUpLower: "송광용", participants: 26, type: "월례대회" },
        { date: "2025-12-10", winner: "이정우", runnerUp: "김성호", winnerLower: "김종탁", runnerUpLower: "오장진", participants: 20, type: "정기모임" },
        { date: "2025-12-17", winner: "김세중", runnerUp: "김순동", winnerLower: "윤교찬", runnerUpLower: "이교탁", participants: 19, type: "번개" },
        { date: "2025-12-24", winner: "박만영", runnerUp: "김영민", winnerLower: "이영숙", runnerUpLower: "임규호", participants: 28, type: "크리스마스 특집" },
        { date: "2025-12-31", winner: "김형찬", runnerUp: "박만영", winnerLower: "정경자", runnerUpLower: "정선철", participants: 30, type: "송년회" },
        { date: "2026-01-07", winner: "홍길동", runnerUp: "이정우", winnerLower: "정진숙", runnerUpLower: "강희철", participants: 22, type: "신년회" },
        { date: "2026-01-14", winner: "박만영", runnerUp: "홍길동", winnerLower: "김미경", runnerUpLower: "김성호", participants: 24, type: "정기모임" }
    ],

    // 2. 상세 경기 기록 (Matches)
    // 구조: [Date, PlayerA, PlayerB, Score, Winner]
    matches: []
};

// 랜덤 경기 데이터 생성기
(function generateMockMatches() {
    const players = [
        "박만영", "이정우", "김경태", "박병재", "안성대", "유호성", "조복연", "강희철",
        "김미경", "김성호", "김세중", "김순동", "김영민", "김형찬", "김홍석", "류계열",
        "류성문", "박덕례", "박수용", "박혜란", "백낙천", "서상국", "송광용", "김종탁",
        "오장진", "윤교찬", "이교탁", "이영숙", "임규호", "정경자", "정선철", "정진숙"
    ];

    const dates = window.MOCK_DATA.summary.map(s => s.date);

    dates.forEach(date => {
        // 각 날짜별로 15~20게임 생성
        const gameCount = 15 + Math.floor(Math.random() * 10);
        for (let i = 0; i < gameCount; i++) {
            // 랜덤 선수 2명 뽑기
            const p1 = players[Math.floor(Math.random() * players.length)];
            let p2 = players[Math.floor(Math.random() * players.length)];
            while (p1 === p2) {
                p2 = players[Math.floor(Math.random() * players.length)];
            }

            // 랜덤 스코어 (2-0, 0-2, 2-1, 1-2)
            const r = Math.random();
            let score, winner;
            if (r < 0.3) { score = "2-0"; winner = p1; }
            else if (r < 0.6) { score = "0-2"; winner = p2; }
            else if (r < 0.8) { score = "2-1"; winner = p1; }
            else { score = "1-2"; winner = p2; }

            window.MOCK_DATA.matches.push({
                date: date,
                p1: p1,
                p2: p2,
                score: score,
                winner: winner
            });
        }
    });
})();
