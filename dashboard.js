/**
 * dashboard.js
 * 탭 관리, 기록실 렌더링, 대시보드 통계 로직
 */

const chartInstances = {};

document.addEventListener("DOMContentLoaded", () => {
    initTabs();

    // 초기 렌더링 (History는 숨겨져 있어도 텍스트라 괜찮지만, 차트는 아님)
    renderHistory();
    // renderDashboard(); // ❌ Remove this! Hidden canvas causes Chart.js errors.
});

/* =========================================
   1. Tab Logic
   ========================================= */
function initTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const contents = document.querySelectorAll(".tab-content");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            // Remove active class
            tabs.forEach(t => t.classList.remove("active"));
            contents.forEach(c => c.classList.remove("active"));

            // Add active class
            tab.classList.add("active");
            const targetId = tab.dataset.target;
            document.getElementById(targetId).classList.add("active");

            // Refresh data if needed
            if (targetId === "tab-history") renderHistory();
            if (targetId === "tab-dashboard-view") {
                // ✅ Give browser a moment to calc layout before rendering chart
                setTimeout(() => {
                    renderDashboard();
                }, 10);
            }
        });
    });
}

/* =========================================
   2. History Logic
   ========================================= */
function renderHistory() {
    const listEl = document.getElementById("history-list");
    if (!listEl) return;

    listEl.innerHTML = "";

    // Use Mock Data (Reverse Order: Latest first)
    const data = (window.MOCK_DATA && window.MOCK_DATA.summary) ? [...window.MOCK_DATA.summary].reverse() : [];

    if (data.length === 0) {
        listEl.innerHTML = "<div style='padding:20px; text-align:center; color:#999;'>기록이 없습니다. (데이터 로드 실패)</div>";
        return;
    }

    data.forEach(item => {
        const card = document.createElement("div");
        card.className = "history-card";

        card.innerHTML = `
            <div class="h-date">${item.date} <span class="h-badge">${item.type}</span></div>
            <div class="h-winner">🏆 ${item.winner}</div>
            <div class="h-sub">
                <span>🥈 ${item.runnerUp}</span>
                <span>👥 ${item.participants}명 참가</span>
            </div>
        `;
        listEl.appendChild(card);
    });
}

/* =========================================
   3. Dashboard Logic
   ========================================= */
function renderDashboard() {
    if (!window.MOCK_DATA) return;

    const summary = window.MOCK_DATA.summary;
    const matches = window.MOCK_DATA.matches;

    // A. Basic Stats
    document.getElementById("stat-total-tourneys").textContent = summary.length;
    document.getElementById("stat-total-matches").textContent = matches.length;

    // B. Calculate Rankings
    const winCounts = {};
    const attendCounts = {};
    const playerSet = new Set();
    const appearanceMap = {};

    matches.forEach(m => {
        playerSet.add(m.p1);
        playerSet.add(m.p2);

        if (!appearanceMap[m.p1]) appearanceMap[m.p1] = new Set();
        if (!appearanceMap[m.p2]) appearanceMap[m.p2] = new Set();
        appearanceMap[m.p1].add(m.date);
        appearanceMap[m.p2].add(m.date);
    });

    Object.keys(appearanceMap).forEach(name => {
        attendCounts[name] = appearanceMap[name].size;
    });

    const winLowerCounts = {};
    const runnerLowerCounts = {};

    // Wins (from Summary)
    summary.forEach(s => {
        // Upper
        if (s.winner) winCounts[s.winner] = (winCounts[s.winner] || 0) + 1;

        // Lower (if exists)
        if (s.winnerLower) winLowerCounts[s.winnerLower] = (winLowerCounts[s.winnerLower] || 0) + 1;
        if (s.runnerUpLower) runnerLowerCounts[s.runnerUpLower] = (runnerLowerCounts[s.runnerUpLower] || 0) + 1;
    });

    document.getElementById("stat-total-players").textContent = playerSet.size;

    // Render Rankings with Chart.js
    renderChart("chart-wins", winCounts, "우승 횟수", ["#FFD700", "#C0C0C0", "#CD7F32", "#4bc0c0", "#36a2eb"]);
    renderChart("chart-attendance", attendCounts, "출석 횟수", "#36a2eb");

    // [NEW] Lower Group Charts
    renderChart("chart-wins-lower", winLowerCounts, "하위부 우승", "#4ade80"); // Green-ish
    renderChart("chart-runners-lower", runnerLowerCounts, "하위부 준우승", "#fb923c"); // Orange-ish

    // Init H2H Search
    initH2HSearch(Array.from(playerSet).sort());
}

function renderChart(canvasId, dataMap, label, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Check context availability
    const ctx = canvas.getContext('2d');

    // Sort Top 10
    const sorted = Object.entries(dataMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const labels = sorted.map(x => x[0]);
    const values = sorted.map(x => x[1]);

    // Color Logic (Array or Single Color)
    let bgColors = [];
    if (Array.isArray(colors)) {
        bgColors = labels.map((_, i) => colors[i] || "#e2e8f0");
    } else {
        bgColors = colors;
    }

    // Destroy existing instance
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: values,
                backgroundColor: bgColors,
                borderRadius: 4,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }
                }
            }
        }
    });
}

/* =========================================
   4. Head-to-Head Logic
   ========================================= */
function initH2HSearch(players) {
    const s1 = document.getElementById("h2h-p1");
    const s2 = document.getElementById("h2h-p2");
    const btn = document.getElementById("btn-h2h-search");

    if (!s1 || !s2 || s1.options.length > 1) return; // Prevent duplicate init

    players.forEach(p => {
        s1.add(new Option(p, p));
        s2.add(new Option(p, p));
    });

    btn.addEventListener("click", () => {
        const p1 = s1.value;
        const p2 = s2.value;
        if (!p1 || !p2) {
            alert("두 선수를 모두 선택해주세요.");
            return;
        }
        if (p1 === p2) {
            alert("서로 다른 선수를 선택해주세요.");
            return;
        }
        showH2HResult(p1, p2);
    });
}

function showH2HResult(p1, p2) {
    if (!window.MOCK_DATA) return;
    const matches = window.MOCK_DATA.matches.filter(m =>
        (m.p1 === p1 && m.p2 === p2) || (m.p1 === p2 && m.p2 === p1)
    );

    const resultEl = document.getElementById("h2h-result");
    const listEl = document.getElementById("h2h-list");

    if (matches.length === 0) {
        resultEl.innerHTML = `<div class="no-data">두 선수 간의 경기 기록이 없습니다.</div>`;
        listEl.innerHTML = "";
        return;
    }

    let win1 = 0;
    let win2 = 0;

    // Sort latest first
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));

    let html = "";
    matches.forEach(m => {
        const isP1Winner = (m.winner === p1);
        if (isP1Winner) win1++; else win2++;

        const p1Score = (m.p1 === p1) ? m.score.split('-')[0] : m.score.split('-')[1];
        const p2Score = (m.p1 === p1) ? m.score.split('-')[1] : m.score.split('-')[0];

        // Format: Date | Winner badge | Score
        html += `
            <div class="match-row">
                <span class="m-date">${m.date}</span>
                <span class="m-res ${isP1Winner ? 'win' : 'lose'}">${isP1Winner ? '승' : '패'}</span>
                <span class="m-score">${p1Score} : ${p2Score}</span>
            </div>
        `;
    });

    resultEl.innerHTML = `
        <div class="h2h-summary">
            <div class="player">
                <span class="name">${p1}</span>
                <span class="score">${win1}승</span>
            </div>
            <div class="vs">VS</div>
            <div class="player">
                <span class="score">${win2}승</span>
                <span class="name">${p2}</span>
            </div>
        </div>
        <div class="h2h-total">총 ${matches.length}전</div>
    `;

    listEl.innerHTML = html;
}
