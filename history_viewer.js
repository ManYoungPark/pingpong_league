/**
 * history_viewer.js
 * index.html의 렌더링 엔진을 그대로 이식한 고정용(Read-only) 뷰어
 */

// --- 글로벌 상태 (Viewer 전용) ---
const state = new Map();
const resultsByTeam = new Map();
const manualRankByTeam = new Map();
const bracketState = new Map();
const PLAYER_INFO = new Map();
const resizeHandlers = {};

// Default Players (index.html에서 복사)
const DEFAULT_PLAYERS = [
    { id: "p001", name: "박만영", grade: 1 }, { id: "p002", name: "이정우", grade: 5 },
    { id: "p003", name: "김경태", grade: 2 }, { id: "p004", name: "박병재", grade: 1 },
    { id: "p005", name: "안성대", grade: 6 }, { id: "p006", name: "유호성", grade: 2 },
    { id: "p007", name: "조복연", grade: 4 }, { id: "p009", name: "김미경", grade: 7 },
    { id: "p010", name: "김성호", grade: 6 }, { id: "p011", name: "김세중", grade: 6 },
    { id: "p013", name: "김형찬", grade: 1 }, { id: "p014", name: "김홍석", grade: 6 },
    { id: "p015", name: "류계열", grade: 5 }, { id: "p016", name: "박덕례", grade: 6 },
    { id: "p017", name: "박혜란", grade: 6 }, { id: "p018", name: "백낙천", grade: 3 },
    { id: "p019", name: "서상국", grade: 4 }, { id: "p020", name: "송광용", grade: 5 },
    { id: "p022", name: "오장진", grade: 4 }, { id: "p023", name: "윤교찬", grade: 6 },
    { id: "p024", name: "이교탁", grade: 7 }, { id: "p025", name: "이영숙", grade: 4 },
    { id: "p026", name: "임규호", grade: 6 }, { id: "p027", name: "정경자", grade: 5 },
    { id: "p028", name: "정선철", grade: 5 }, { id: "p029", name: "조상배", grade: 5 },
    { id: "p030", name: "최매완", grade: 4 }, { id: "p031", name: "박현신", grade: 6 },
    { id: "p032", name: "홍순관", grade: 6 }, { id: "p033", name: "홍현숙", grade: 7 },
    { id: "p034", name: "박승기", grade: 6 }
];
DEFAULT_PLAYERS.forEach(p => PLAYER_INFO.set(p.name, p));

let matchFormat = "bo3";

// --- 초기화 ---
window.addEventListener("DOMContentLoaded", () => {
    if (window.SAMPLE_HISTORY_DATA) {
        initViewer(window.SAMPLE_HISTORY_DATA);
    }
});

function initViewer(fullData) {
    const { metadata, playersState, resultsByTeam: results, manualRankByTeam: manuals, bracketState: brackets, finalSummary } = fullData;

    matchFormat = metadata.matchFormat || "bo3";
    document.title = `기록 조회: ${metadata.title}`;
    document.getElementById("headerTitle").textContent = metadata.title;
    document.getElementById("headerDate").textContent = metadata.date;

    state.clear();
    new Map(playersState).forEach((v, k) => state.set(k, v));
    resultsByTeam.clear();
    new Map(results).forEach((v, k) => resultsByTeam.set(k, new Map(v)));
    manualRankByTeam.clear();
    new Map(manuals).forEach((v, k) => manualRankByTeam.set(k, new Map(v)));
    bracketState.clear();
    new Map(brackets).forEach((v, k) => bracketState.set(k, v));

    renderHistoryUI();
    if (finalSummary) renderFinalSummary(finalSummary);
}

function renderFinalSummary(data) {
    if (!data) return;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Array.isArray(val) ? val.join(", ") : (val || "-");
    };
    set("sum-u-1", data.upper.winner);
    set("sum-u-2", data.upper.runnerUp);
    set("sum-u-3", data.upper.third);
    set("sum-l-1", data.lower.winner);
    set("sum-l-2", data.lower.runnerUp);
}

function renderHistoryUI() {
    const teamsEl = document.getElementById("teams");
    teamsEl.innerHTML = "";

    // 조 개수 파악
    const teamIds = new Set();
    state.forEach(v => { if (v.where === "team") teamIds.add(v.teamId); });
    const sortedTeamIds = Array.from(teamIds).sort();

    sortedTeamIds.forEach(teamId => {
        const players = Array.from(state.entries())
            .filter(([_, v]) => v.where === "team" && v.teamId === teamId)
            .map(([k, _]) => k);

        const idx = parseInt(teamId.split("-")[1]) + 1;
        const teamDiv = document.createElement("div");
        teamDiv.className = "team";
        teamDiv.innerHTML = `
            <div class="hd"><div class="tname">${idx}조</div></div>
            <div class="body"><div class="rr-host"></div></div>
        `;
        teamsEl.appendChild(teamDiv);
        renderRoundRobin(teamDiv, teamId, players);
    });

    // 토너먼트 렌더링 (SVG)
    renderBrackets();
}

// --- Ranking 로직 (index.html에서 포팅) ---
function keyPair(p1, p2) { return [p1, p2].sort().join("|||"); }
function parseScore(s) {
    if (!s) return null;
    const pts = s.split("-");
    if (pts.length !== 2) return null;
    return { a: parseInt(pts[0], 10), b: parseInt(pts[1], 10) };
}
function getGradeBadgeHTML(name) {
    const p = PLAYER_INFO.get(name);
    return p && p.grade ? `<span class="grade-badge">${p.grade}</span>` : "";
}

function computeRanking(teamId, players) {
    const resMap = resultsByTeam.get(teamId) || new Map();
    const map = new Map();
    players.forEach(p => map.set(p, { name: p, played: 0, win: 0, lose: 0, setsFor: 0, setsAgainst: 0 }));

    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const p1 = players[i], p2 = players[j];
            const k = keyPair(p1, p2);
            const res = resMap.get(k);
            if (!res || !res.score) continue;
            const p = parseScore(res.score);
            if (!p) continue;
            const s1 = map.get(p1), s2 = map.get(p2);
            s1.played++; s2.played++;
            const p1First = k.startsWith(p1 + "|||");
            const p1S = p1First ? p.a : p.b, p2S = p1First ? p.b : p.a;
            s1.setsFor += p1S; s1.setsAgainst += p2S;
            s2.setsFor += p2S; s2.setsAgainst += p1S;
            if (p1S > p2S) { s1.win++; s2.lose++; } else { s2.win++; s1.lose++; }
        }
    }
    const anyPlayed = Array.from(map.values()).some(s => s.played > 0);
    const ranked = players.slice().sort((a, b) => {
        const sA = map.get(a), sB = map.get(b);
        if (sA.win !== sB.win) return sB.win - sA.win;
        const diffA = sA.setsFor - sA.setsAgainst, diffB = sB.setsFor - sB.setsAgainst;
        if (diffA !== diffB) return diffB - diffA;
        return sB.setsFor - sA.setsFor;
    });
    ranked.forEach((p, i) => { map.get(p).rank = anyPlayed ? i + 1 : 999; });
    return { map, anyPlayed };
}

function resolveFinalRanks(teamId, autoPack) {
    const manuals = manualRankByTeam.get(teamId) || new Map();
    const final = new Map();
    autoPack.map.forEach((st, nm) => {
        const m = manuals.get(nm);
        const r = m || st.rank;
        final.set(nm, { finalRank: r, finalLabel: r === 999 ? "" : `${r}위`, isManual: !!m });
    });
    return final;
}

function renderRoundRobin(teamBox, teamId, players) {
    const host = teamBox.querySelector(".rr-host");
    const autoPack = computeRanking(teamId, players);
    const finalPack = resolveFinalRanks(teamId, autoPack);
    const anyPlayed = autoPack.anyPlayed;

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const tbl = document.createElement("table");
    tbl.className = "rr";

    let headHtml = `<thead><tr><th>선수</th>` + players.map(p => `<th>${p}${getGradeBadgeHTML(p)}</th>`).join("") + `<th>승-패</th><th>득실</th><th>순위</th></tr></thead>`;
    tbl.innerHTML = headHtml;

    const tbody = document.createElement("tbody");
    players.forEach((rowP, i) => {
        const tr = document.createElement("tr");
        let rowHtml = `<td>${rowP}${getGradeBadgeHTML(rowP)}</td>`;
        players.forEach((colP, j) => {
            if (i === j) rowHtml += `<td class="diag">—</td>`;
            else {
                const k = keyPair(rowP, colP);
                const res = (resultsByTeam.get(teamId) || new Map()).get(k);
                const score = res ? res.score : "-";
                rowHtml += `<td>${score}</td>`;
            }
        });
        const st = autoPack.map.get(rowP);
        const f = finalPack.get(rowP);
        rowHtml += `<td class="wl">${st.win}-${st.lose}</td>`;
        rowHtml += `<td class="wl">${st.setsFor - st.setsAgainst}</td>`;
        rowHtml += `<td class="rank">${f.finalLabel}${f.isManual ? ' <span class="grade-badge">MAN</span>' : ''}</td>`;
        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    scroll.appendChild(tbl);
    host.appendChild(scroll);
}

// --- 토너먼트 SVG 엔진 (index.html에서 최적화 포팅) ---
function isBye(el) { return el && (el.classList.contains("bye") || el.textContent.trim() === "BYE"); }
function isEmpty(el) { return !el || (el.classList.contains("empty") && !isBye(el)) || el.textContent.trim() === "?" || el.textContent.trim() === ""; }
function extractName(el) {
    const wrap = el.querySelector(".tm-nm-wrap");
    if (wrap) {
        for (let i = 0; i < wrap.childNodes.length; i++) if (wrap.childNodes[i].nodeType === 3) return wrap.childNodes[i].textContent.trim();
        return wrap.innerText.trim();
    }
    return el.innerText.split('\n')[0].trim();
}

function createTournamentLineEngine({ wrapEl, svg, prefix, direction, rounds, nodeId }) {
    const MATCHES = [];
    for (let r = 1; r <= rounds; r++) {
        const count = Math.pow(2, rounds - r + 1);
        if (r === rounds) MATCHES.push({ a: nodeId(r, 1), b: nodeId(r, 2), to: `${prefix}-winner` });
        else for (let i = 1; i <= count; i += 2) MATCHES.push({ a: nodeId(r, i), b: nodeId(r, i + 1), to: nodeId(r + 1, Math.ceil(i / 2)) });
    }

    function mkPath(d, from, to, seg) {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", d);
        p.dataset.from = from; p.dataset.to = to; p.dataset.seg = seg;
        return p;
    }

    function drawBracketLine(id1, id2, toId) {
        const e1 = document.getElementById(id1), e2 = document.getElementById(id2), et = document.getElementById(toId);
        if (!e1 || !e2 || !et) return;
        const wr = wrapEl.getBoundingClientRect(), r1 = e1.getBoundingClientRect(), r2 = e2.getBoundingClientRect(), rt = et.getBoundingClientRect();
        const x1 = (direction === 1 ? r1.right : r1.left) - wr.left, y1 = (r1.top + r1.height / 2) - wr.top;
        const x2 = (direction === 1 ? r2.right : r2.left) - wr.left, y2 = (r2.top + r2.height / 2) - wr.top;
        const xt = (direction === 1 ? rt.left : rt.right) - wr.left, yt = (rt.top + rt.height / 2) - wr.top;
        const topY = Math.min(y1, y2), botY = Math.max(y1, y2), joinY = Math.max(topY, Math.min(yt, botY));
        const maxX = direction === 1 ? Math.max(x1, x2) : Math.min(x1, x2);
        const joinX = (maxX + xt) / 2;

        svg.appendChild(mkPath(`M ${x1} ${y1} H ${joinX}`, id1, toId, 'in'));
        svg.appendChild(mkPath(`M ${x2} ${y2} H ${joinX}`, id2, toId, 'in'));
        svg.appendChild(mkPath(`M ${joinX} ${topY} V ${joinY}`, `${id1}&${id2}`, toId, 'vTop'));
        svg.appendChild(mkPath(`M ${joinX} ${joinY} V ${botY}`, `${id1}&${id2}`, toId, 'vBot'));
        svg.appendChild(mkPath(`M ${joinX} ${joinY} H ${xt}`, `${id1}&${id2}`, toId, 'hOut'));
    }

    function applyStyles(a, b, to, winId) {
        const loseId = (winId === a) ? b : a;
        const winIn = svg.querySelector(`path[data-seg="in"][data-from="${winId}"][data-to="${to}"]`);
        const loseIn = svg.querySelector(`path[data-seg="in"][data-from="${loseId}"][data-to="${to}"]`);
        if (winIn) winIn.classList.add("win");
        if (loseIn) loseIn.classList.add("lose");
        document.getElementById(winId)?.classList.add("winner");

        const winIsTop = document.getElementById(winId).getBoundingClientRect().top < document.getElementById(loseId).getBoundingClientRect().top;
        const vT = svg.querySelector(`path[data-seg="vTop"][data-to="${to}"]`), vB = svg.querySelector(`path[data-seg="vBot"][data-to="${to}"]`), hO = svg.querySelector(`path[data-seg="hOut"][data-to="${to}"]`);
        if (hO) hO.classList.add("win");
        if (winIsTop) { if (vT) vT.classList.add("win"); if (vB) vB.classList.add("lose"); }
        else { if (vB) vB.classList.add("win"); if (vT) vT.classList.add("lose"); }
    }

    function initLines() {
        svg.innerHTML = "";
        const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
        svg.setAttribute("width", w); svg.setAttribute("height", h);
        for (const m of MATCHES) drawBracketLine(m.a, m.b, m.to);
        // Restore Highlights
        MATCHES.forEach(m => {
            const toE = document.getElementById(m.to);
            if (!toE || isEmpty(toE)) return;
            const wName = extractName(toE), nA = extractName(document.getElementById(m.a)), nB = extractName(document.getElementById(m.b));
            if (wName === nA) applyStyles(m.a, m.b, m.to, m.a);
            else if (wName === nB) applyStyles(m.a, m.b, m.to, m.b);
        });
    }
    return { initLines };
}

function createBracketUI({ wrapId, svgId, prefix, direction, B, slots, titleElId, titleText }) {
    const wrap = document.getElementById(wrapId), svg = document.getElementById(svgId), title = document.getElementById(titleElId);
    wrap.querySelectorAll(".tm-player, .tm-champ-label").forEach(el => el.remove());
    svg.innerHTML = "";
    title.textContent = `${titleText} (${B}강)`;
    const rounds = Math.log2(B), boxW = 85, boxH = 34, champW = 110;
    const W = wrap.clientWidth, step = (W - 40 - champW) / rounds;
    const nodeId = (r, i) => `${prefix}-r${r}-${i}`;

    for (let r = 1; r <= rounds; r++) {
        const count = B / Math.pow(2, r - 1), spacing = (wrap.clientHeight - 40) / count;
        for (let i = 1; i <= count; i++) {
            const div = document.createElement("div"); div.className = "tm-player empty"; div.id = nodeId(r, i);
            const x = (direction === 1) ? 20 + (r - 1) * step : W - 20 - (r - 1) * step - boxW;
            div.style.left = `${x}px`; div.style.top = `${20 + (i - 0.5) * spacing - boxH / 2}px`;
            wrap.appendChild(div);
        }
    }
    const champ = document.createElement("div"); champ.className = "tm-champ-label";
    champ.style.top = `${wrap.clientHeight / 2 - 55}px`; champ.style.left = (direction === 1) ? `${W - 20 - champW}px` : `20px`;
    champ.innerHTML = `<div class="label">CHAMPION</div><div id="${prefix}-winner" class="tm-player empty tm-winner-box" style="position:static">?</div>`;
    wrap.appendChild(champ);

    // Initial Slots
    for (let i = 1; i <= B; i++) {
        const el = document.getElementById(nodeId(1, i)), pName = slots[i - 1];
        if (!pName) { el.textContent = "BYE"; el.classList.add("bye"); }
        else { el.innerHTML = `<span class="tm-nm-wrap">${pName}${getGradeBadgeHTML(pName)}</span>`; el.classList.remove("empty"); }
    }

    // Restore Winners from bracketState
    bracketState.forEach((name, id) => {
        if (!id.startsWith(prefix)) return;
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = `<span class="tm-nm-wrap">${name}${getGradeBadgeHTML(name)}</span>`;
        el.classList.remove("empty");
    });

    createTournamentLineEngine({ wrapEl: wrap, svg, prefix, direction, rounds, nodeId }).initLines();
}

function renderBrackets() {
    // 상위 토너먼트 (스크린샷 기반 16강)
    const upperSlots = [
        "김형찬", null, "박혜란", "김미경", "박덕례", "오장진", "이교탁", null,
        "백낙천", null, "김성호", "송광용", "윤교찬", "박병재", "박만영", null
    ];
    createBracketUI({
        wrapId: "tm-wrap-upper", svgId: "tm-lines-upper", prefix: "U", direction: 1,
        B: 16, slots: upperSlots, titleElId: "tm-titleUpper", titleText: "상위 토너먼트"
    });

    // 하위 토너먼트 (스크린샷 기반 16강)
    const lowerSlots = [
        "김경태", null, "박현신", "박승기", "이영숙", null, "안성대", null,
        "김세중", "유호성", "서상국", "김홍석", null, "류계열", "조복연", null
    ];
    createBracketUI({
        wrapId: "tm-wrap-lower", svgId: "tm-lines-lower", prefix: "L", direction: 0,
        B: 16, slots: lowerSlots, titleElId: "tm-titleLower", titleText: "하위 토너먼트"
    });
}
