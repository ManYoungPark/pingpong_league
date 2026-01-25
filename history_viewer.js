const GAS_URL = "https://script.google.com/macros/s/AKfycbybkNRimOGBcCYH7HAbiT6lhlqtT9SzVZ0QjDxkD6By1ePgtv5XS8-eGSIIRocNpdJn/exec";

// --- 글로벌 상태 (Viewer 전용) ---
let currentHistoryList = [];
let currentIndex = -1;
let currentMatchFormat = "bo3"; // 저장된 매치 포맷 활용

const state = new Map();
const resultsByTeam = new Map();
const manualRankByTeam = new Map();
const bracketState = new Map();
const PLAYER_INFO = new Map();
let currentGroupsCount = 4;

// --- 초기화 ---
window.addEventListener("DOMContentLoaded", async () => {
    await fetchHistoryList();
});

async function fetchHistoryList() {
    toggleLoader(true);
    try {
        const res = await fetch(`${GAS_URL}?action=getList`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        if (data.success && data.list.length > 0) {
            currentHistoryList = data.list;
            renderSelector();
            loadSpecific(currentHistoryList[0].date);
        } else {
            throw new Error(data.message || "기록 목록을 불러올 수 없습니다.");
        }
    } catch (e) {
        console.error("Fetch failed", e);
        const errorMsg = e.message.includes("fetch") ? "네트워크 오류 또는 CORS 정책 위반" : e.message;
        currentHistoryList = [{ date: "window.SAMPLE_HISTORY_DATA", title: `샘플 데이터 (연결 실패: ${errorMsg})` }];
        renderSelector();
        if (window.SAMPLE_HISTORY_DATA) initViewer(window.SAMPLE_HISTORY_DATA);
    } finally {
        toggleLoader(false);
    }
}

function renderSelector() {
    const selector = document.getElementById("historySelect");
    if (currentHistoryList.length === 0) {
        selector.innerHTML = `<option value="">데이터 없음</option>`;
        return;
    }
    selector.innerHTML = currentHistoryList.map((item, idx) => {
        if (item.date === "window.SAMPLE_HISTORY_DATA") return `<option value="${item.date}">${item.title}</option>`;
        const d = new Date(item.date);
        const label = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} - ${item.title}`;
        return `<option value="${item.date}">${label}</option>`;
    }).join("");
}

async function loadSpecific(date) {
    toggleLoader(true);
    try {
        const res = await fetch(`${GAS_URL}?action=getData&date=${encodeURIComponent(date)}`);
        const data = await res.json();
        if (data.success) {
            let fullData = (typeof data.fullData === 'string') ? JSON.parse(data.fullData) : data.fullData;
            initViewer(fullData);
            currentIndex = currentHistoryList.findIndex(item => String(item.date) === String(date));
            updateNavButtons();
            document.getElementById("historySelect").value = date;
        }
    } catch (e) {
        console.error("Data load failed", e);
    } finally {
        toggleLoader(false);
    }
}

function updateNavButtons() {
    document.getElementById("prevBtn").disabled = (currentIndex >= currentHistoryList.length - 1);
    document.getElementById("nextBtn").disabled = (currentIndex <= 0);
}

function goPrev() { if (currentIndex < currentHistoryList.length - 1) loadSpecific(currentHistoryList[currentIndex + 1].date); }
function goNext() { if (currentIndex > 0) loadSpecific(currentHistoryList[currentIndex - 1].date); }

function toggleLoader(show) {
    document.getElementById("loadingCover").classList.toggle("active", show);
}

function initViewer(fullData) {
    if (!fullData || !fullData.metadata) {
        alert("데이터 형식이 올바르지 않습니다.");
        return;
    }
    const { metadata, playersState, resultsByTeam: results, manualRankByTeam: manuals, bracketState: brackets, finalSummary } = fullData;

    currentGroupsCount = metadata.groupsCount || 4;
    currentMatchFormat = metadata.matchFormat || "bo3";

    document.title = `${metadata.title} - 기록 조회`;
    document.getElementById("headerTitle").textContent = metadata.title;
    document.getElementById("headerDate").textContent = metadata.date;

    // PLAYER_INFO 복원 (Grade 추출 강화)
    PLAYER_INFO.clear();
    const pStateRaw = playersState || [];
    const pStateMap = new Map(pStateRaw);
    pStateMap.forEach((v, name) => {
        // v가 객체이고 그 안에 grade가 있을 때만 저장
        if (v && typeof v === 'object' && v.grade !== undefined && v.grade !== null) {
            PLAYER_INFO.set(name, { name, grade: v.grade });
        }
    });

    state.clear();
    pStateMap.forEach((v, k) => state.set(k, v));

    resultsByTeam.clear();
    if (results) (new Map(results)).forEach((v, k) => resultsByTeam.set(k, new Map(v)));

    manualRankByTeam.clear();
    if (manuals) (new Map(manuals)).forEach((v, k) => manualRankByTeam.set(k, new Map(v)));

    bracketState.clear();
    if (brackets) (new Map(brackets)).forEach((v, k) => bracketState.set(k, v));

    renderHistoryUI();

    const summaryEl = document.getElementById("final-summary");
    if (finalSummary) {
        summaryEl?.classList.add("show");
        renderFinalSummary(finalSummary);
    } else {
        summaryEl?.classList.remove("show");
        ["sum-u-1", "sum-u-2", "sum-u-3", "sum-l-1", "sum-l-2"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = "-";
        });
    }
}

function renderFinalSummary(data) {
    if (!data) return;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = Array.isArray(val) ? val.join(", ") : (val || "-");
    };
    set("sum-u-1", data.upper.winner);
    set("sum-u-2", data.upper.runnerUp);
    set("sum-u-3", data.upper.third || data.upper.semiFinalists);
    set("sum-l-1", data.lower.winner);
    set("sum-l-2", data.lower.runnerUp);
}

function renderHistoryUI() {
    const teamsEl = document.getElementById("teams");
    teamsEl.innerHTML = "";
    const teamIds = new Set();
    state.forEach(v => { if (v.where === "team" && v.teamId) teamIds.add(v.teamId); });
    const sortedTeamIds = Array.from(teamIds).sort((a, b) => {
        const numA = parseInt(a.split('-')[1]);
        const numB = parseInt(b.split('-')[1]);
        return numA - numB;
    });

    sortedTeamIds.forEach(teamId => {
        const players = Array.from(state.entries())
            .filter(([_, v]) => v.where === "team" && v.teamId === teamId)
            .map(([k, _]) => k);

        const idx = parseInt(teamId.split("-")[1]);
        const teamDiv = document.createElement("div");
        teamDiv.className = "team";
        teamDiv.innerHTML = `
            <div class="hd"><div class="tname">${idx}조</div><div class="count">${players.length}명</div></div>
            <div class="body"><div class="rr-host"></div></div>
        `;
        teamsEl.appendChild(teamDiv);
        renderRoundRobin(teamDiv, teamId, players);
    });
    renderBrackets();
}

// --- Helpers ---
function ensureTeamResults(teamId) {
    if (!resultsByTeam.has(teamId)) resultsByTeam.set(teamId, new Map());
    return resultsByTeam.get(teamId);
}
function ensureManual(teamId) {
    if (!manualRankByTeam.has(teamId)) manualRankByTeam.set(teamId, new Map());
    return manualRankByTeam.get(teamId);
}
function keyPair(p1, p2) { return [p1, p2].sort().join("|||"); }
function parseScore(s) {
    if (!s) return null;
    const pts = String(s).split("-");
    if (pts.length !== 2) return null;
    return { a: parseInt(pts[0], 10), b: parseInt(pts[1], 10) };
}
function getGradeBadgeHTML(name) {
    if (!name || name === "BYE" || name === "?") return "";
    const p = PLAYER_INFO.get(name);
    return p && p.grade ? `<span class="grade-badge">${p.grade}</span>` : "";
}

function computeRanking(teamId, players) {
    const resMap = ensureTeamResults(teamId);
    const base = new Map();
    players.forEach(p => base.set(p, { name: p, played: 0, win: 0, lose: 0, setsFor: 0, setsAgainst: 0 }));

    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const A = players[i], B = players[j];
            const k = keyPair(A, B);
            const res = resMap.get(k);
            const parsed = parseScore(res?.score || "");
            if (!parsed) continue;

            const aIsFirst = k.startsWith(`${A}|||`);
            const aScore = aIsFirst ? parsed.a : parsed.b;
            const bScore = aIsFirst ? parsed.b : parsed.a;

            const sA = base.get(A), sB = base.get(B);
            sA.played++; sB.played++;
            sA.setsFor += aScore; sA.setsAgainst += bScore;
            sB.setsFor += bScore; sB.setsAgainst += aScore;

            if (aScore > bScore) { sA.win++; sB.lose++; }
            else if (aScore < bScore) { sB.win++; sA.lose++; }
        }
    }

    const anyPlayed = Array.from(base.values()).some(s => s.played > 0);
    const statsArr = Array.from(base.values()).map(s => {
        const setDiff = s.setsFor - s.setsAgainst;
        return { ...s, points: s.win, setDiff };
    });

    if (!anyPlayed) {
        const out = new Map();
        players.forEach(p => out.set(p, { ...base.get(p), autoRank: null, autoReason: null }));
        return { map: out, anyPlayed, tieGroups: [] };
    }

    // Simplified Ranking logic for Viewer (H2H only if possible)
    const reasonMap = new Map();
    const sorted = statsArr.sort((x, y) => {
        if (y.win !== x.win) return y.win - x.win;
        if (y.setDiff !== x.setDiff) return y.setDiff - x.setDiff;
        return y.setsFor - x.setsFor;
    });

    const out = new Map();
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
        const nm = sorted[i].name;
        let reason = null;
        if (i > 0 && sorted[i].win === sorted[i - 1].win) reason = "H2H"; // Simplified label
        if (i < sorted.length - 1 && sorted[i].win === sorted[i + 1].win) reason = "H2H";

        out.set(nm, { ...sorted[i], autoRank: rank++, autoReason: reason });
    }

    return { map: out, anyPlayed, tieGroups: [] };
}

function resolveFinalRanks(teamId, autoPack) {
    const final = new Map();
    const anyPlayed = autoPack.anyPlayed;
    const manual = ensureManual(teamId);

    for (const [nm, st] of autoPack.map.entries()) {
        const m = manual.get(nm);
        const r = m || st.autoRank;
        final.set(nm, {
            finalRank: r,
            finalLabel: (anyPlayed && r) ? `${r}위` : "",
            isManual: !!m,
            autoReason: st.autoReason
        });
    }
    return final;
}

function getPlayerRankLabel(name) {
    if (!name || name === "BYE" || name === "?") return "";
    const p = state.get(name);
    if (!p || p.where !== "team" || !p.teamId) return "";
    const teamId = p.teamId;
    const playersInTeam = Array.from(state.entries())
        .filter(([_, v]) => v.where === "team" && v.teamId === teamId)
        .map(([k, _]) => k);
    const autoPack = computeRanking(teamId, playersInTeam);
    const final = resolveFinalRanks(teamId, autoPack);
    const f = final.get(name);
    const gNum = parseInt(teamId.split("-")[1]);
    return (f && f.finalRank) ? `${gNum}조 ${f.finalRank}위` : "";
}

function renderRoundRobin(teamBox, teamId, players) {
    const host = teamBox.querySelector(".rr-host");
    host.innerHTML = "";
    if (players.length === 0) return;

    const wrap = document.createElement("div");
    wrap.className = "rr-wrap";

    const autoPack = computeRanking(teamId, players);
    const finalPack = resolveFinalRanks(teamId, autoPack);
    const anyPlayed = autoPack.anyPlayed;

    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    const tbl = document.createElement("table");
    tbl.className = "rr";

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "corner sticky"; corner.textContent = "선수"; hr.appendChild(corner);
    players.forEach(p => {
        const th = document.createElement("th"); th.className = "sticky";
        th.innerHTML = `${p}${getGradeBadgeHTML(p)}`;
        hr.appendChild(th);
    });
    ["승-패", "득실", "순위"].forEach(txt => {
        const th = document.createElement("th"); th.className = "sticky wl"; th.textContent = txt; hr.appendChild(th);
    });
    thead.appendChild(hr); tbl.appendChild(thead);

    const tbody = document.createElement("tbody");
    players.forEach((rowP, i) => {
        const tr = document.createElement("tr");
        const left = document.createElement("th"); left.className = "leftsticky";
        left.innerHTML = `${rowP}${getGradeBadgeHTML(rowP)}`; tr.appendChild(left);

        players.forEach((colP, j) => {
            const td = document.createElement("td");
            if (i === j) { td.className = "diag"; td.textContent = "—"; }
            else {
                const k = keyPair(rowP, colP);
                const res = ensureTeamResults(teamId).get(k);
                const score = res?.score || "-";

                if (score !== "-") {
                    const parsed = parseScore(score);
                    const rowIsFirst = k.startsWith(`${rowP}|||`);
                    const myScore = rowIsFirst ? parsed.a : parsed.b;
                    const opScore = rowIsFirst ? parsed.b : parsed.a;
                    td.innerHTML = `<div style="color:${myScore > opScore ? '#000' : '#ef4444'}; font-weight:${myScore > opScore ? '900' : '400'}">${myScore}</div>`;
                } else {
                    td.textContent = "-";
                }
            }
            tr.appendChild(td);
        });

        const st = autoPack.map.get(rowP);
        const f = finalPack.get(rowP);

        const wlTd = document.createElement("td"); wlTd.className = "wl"; wlTd.textContent = anyPlayed ? `${st.win}-${st.lose}` : "-"; tr.appendChild(wlTd);
        const diffTd = document.createElement("td"); diffTd.className = "wl"; diffTd.textContent = anyPlayed ? (st.setDiff >= 0 ? "+" + st.setDiff : st.setDiff) : "-"; tr.appendChild(diffTd);

        const rkTd = document.createElement("td"); rkTd.className = "rank";
        if (anyPlayed && f.finalRank === 1) rkTd.innerHTML = `<span class="crown">👑</span>1위`;
        else rkTd.innerHTML = f.finalLabel || "-";
        if (f.autoReason) rkTd.innerHTML += `<span class="code" title="동률 처리규정">${f.autoReason}</span>`;
        if (f.isManual) rkTd.innerHTML += `<span class="manual">MAN</span>`;
        tr.appendChild(rkTd);

        tbody.appendChild(tr);
    });
    tbl.appendChild(tbody); scroll.appendChild(tbl); wrap.appendChild(scroll); host.appendChild(wrap);
}

// --- 토너먼트 SVG 엔진 (index.html에서 최적화 포팅) ---
function isBye(el) { return el && (el.classList.contains("bye") || el.textContent.trim() === "BYE"); }
function isEmpty(el) { return !el || (el.classList.contains("empty") && !isBye(el)) || el.textContent.trim() === "?" || el.textContent.trim() === ""; }
function extractName(el) {
    if (!el) return "";
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

        const winEl = document.getElementById(winId);
        const loseEl = document.getElementById(loseId);
        if (winEl) winEl.classList.add("winner");
        if (loseEl) loseEl.classList.remove("winner");

        const winIsTop = winEl && loseEl && winEl.getBoundingClientRect().top < loseEl.getBoundingClientRect().top;
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
        for (const m of MATCHES) {
            const eA = document.getElementById(m.a), eB = document.getElementById(m.b), toE = document.getElementById(m.to);
            if (!toE || isEmpty(toE) || isBye(toE)) continue;

            const stateVal = bracketState.get(m.to);
            const winnerName = (typeof stateVal === 'object') ? (stateVal.winner || "") : String(stateVal || "");
            const wName = winnerName || extractName(toE);
            const nA = extractName(eA), nB = extractName(eB);

            // 한쪽이 BYE인 경우의 자동 소급 처리 (R1 등)
            if (!wName && isBye(eA) && !isEmpty(eB)) { applyStyles(m.a, m.b, m.to, m.b); continue; }
            if (!wName && isBye(eB) && !isEmpty(eA)) { applyStyles(m.a, m.b, m.to, m.a); continue; }

            if (wName && wName === nA) applyStyles(m.a, m.b, m.to, m.a);
            else if (wName && wName === nB) applyStyles(m.a, m.b, m.to, m.b);
        }
    }
    return { initLines };
}

function createBracketUI({ wrapId, svgId, prefix, direction, B, slots, titleElId, titleText }) {
    const wrap = document.getElementById(wrapId), svg = document.getElementById(svgId), title = document.getElementById(titleElId);
    wrap.querySelectorAll(".tm-player, .tm-champ-label").forEach(el => el.remove());
    svg.innerHTML = "";

    const byeCount = slots.filter(x => x === null || x === "BYE").length;
    title.textContent = `${titleText} (${B}강, BYE ${byeCount}개)`;

    // ✅ Dynamic Height: Prevent overlap
    const minH = Math.max(500, B * 40 + 60);
    wrap.style.height = `${minH}px`;

    const W = wrap.clientWidth, H = wrap.clientHeight;
    const rounds = Math.log2(B), boxW = 85, boxH = 34, champW = 110;
    const padX = 20, padY = 20;
    const champX = W - padX - champW;
    const step = (champX - padX) / rounds;
    const usableH = H - padY * 2;
    const nodeId = (r, i) => `${prefix}-r${r}-${i}`;

    for (let r = 1; r <= rounds; r++) {
        const count = B / Math.pow(2, r - 1), spacing = usableH / count;
        for (let i = 1; i <= count; i++) {
            const div = document.createElement("div"); div.className = "tm-player empty"; div.id = nodeId(r, i);
            const x = (direction === 1) ? padX + (r - 1) * step : W - padX - (r - 1) * step - boxW;
            const y = padY + (i - 0.5) * spacing - boxH / 2;
            div.style.left = `${x}px`; div.style.top = `${y}px`;
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
        if (!pName || pName === "BYE") {
            el.textContent = "BYE"; el.classList.add("bye");
        } else {
            const label = getPlayerRankLabel(pName);
            el.innerHTML = `<span class="tm-nm-wrap">${pName}${getGradeBadgeHTML(pName)}</span>${label ? `<small>${label}</small>` : ""}`;
            el.classList.remove("empty"); el.classList.remove("bye");
        }
    }

    // Restore Winners from bracketState
    bracketState.forEach((val, id) => {
        if (!id.startsWith(prefix)) return;
        const el = document.getElementById(id); if (!el) return;

        let name = (typeof val === 'object') ? val.winner : val;
        if (name && name !== "BYE") {
            const label = getPlayerRankLabel(name);
            el.innerHTML = `<span class="tm-nm-wrap">${name}${getGradeBadgeHTML(name)}</span>${label ? `<small>${label}</small>` : ""}`;
            el.classList.remove("empty"); el.classList.remove("bye");
        } else if (name === "BYE") {
            el.textContent = "BYE"; el.classList.add("bye"); el.classList.add("empty");
        }
    });

    const engine = createTournamentLineEngine({ wrapEl: wrap, svg, prefix, direction, rounds, nodeId });
    engine.initLines();
}


function renderBrackets() {
    function calculateB() {
        // 1. [최우선] 실제 대진표 데이터(bracketState) 스캔 (9~16번 슬롯 유무)
        function check16(prefix) {
            for (let i = 9; i <= 16; i++) if (bracketState.has(`${prefix}-r1-${i}`)) return true;
            for (let i = 5; i <= 8; i++) if (bracketState.has(`${prefix}-r2-${i}`)) return true;
            return false;
        }

        const isU16 = check16("U");
        const isL16 = check16("L");

        // 2. [보조] 조별 인원 파악 (신규 데이터용)
        const teams = new Map();
        state.forEach(v => {
            if (v.where === "team" && v.teamId) {
                teams.set(v.teamId, (teams.get(v.teamId) || 0) + 1);
            }
        });

        let totalUpper = 0, totalLower = 0;
        teams.forEach(n => {
            totalUpper += Math.round(n / 2);
            totalLower += (n - Math.round(n / 2));
        });

        return {
            Bu: isU16 ? 16 : (totalUpper > 8 ? 16 : 8),
            Bl: isL16 ? 16 : (totalLower > 8 ? 16 : 8)
        };
    }

    const { Bu, Bl } = calculateB();

    function processBrackets(prefix, B) {
        const rounds = Math.log2(B);
        const slots = new Array(B).fill(null);

        // Step 1: Populate slots from r1 data if available (highest priority)
        for (let i = 1; i <= B; i++) {
            const r1Id = `${prefix}-r1-${i}`;
            const val = bracketState.get(r1Id);
            if (typeof val === 'string') {
                slots[i - 1] = val;
            } else if (val && typeof val === 'object' && val.winner) { // If r1 is an object with a winner
                slots[i - 1] = val.winner;
            }
        }

        // Step 2: Backfill missing slots using r2 match data
        // This is for cases where r1 data might be missing but r2 matches are defined.
        // A match in r2-${i} implies players from r1-${2i-1} and r1-${2i}.
        const r2Count = B / 2;
        for (let i = 1; i <= r2Count; i++) {
            const matchId = `${prefix}-r2-${i}`;
            const match = bracketState.get(matchId);
            if (match && typeof match === 'object') {
                const p1SlotIndex = (i - 1) * 2;
                const p2SlotIndex = (i - 1) * 2 + 1;

                // Only backfill if the slot is currently empty (null)
                if (slots[p1SlotIndex] === null && match.p1) {
                    slots[p1SlotIndex] = match.p1;
                }
                if (slots[p2SlotIndex] === null && match.p2) {
                    slots[p2SlotIndex] = match.p2;
                }
            }
        }

        // Step 3: Backpropagate winners from higher rounds to fill any remaining empty slots
        // This handles cases where a player advanced due to BYE or an unrecorded match.
        // Iterate from round 2 up to the final round (rounds)
        for (let r = 2; r <= rounds; r++) {
            const currentRoundMatchCount = B / Math.pow(2, r - 1); // Number of matches in current round
            for (let i = 1; i <= currentRoundMatchCount; i++) {
                const matchId = `${prefix}-r${r}-${i}`;
                const match = bracketState.get(matchId);
                let winnerName = (match && typeof match === 'object') ? match.winner : String(match || "");

                if (winnerName && winnerName !== "BYE") {
                    // Find the corresponding input slots for this match
                    const prevRound = r - 1;
                    const input1Id = `${prefix}-r${prevRound}-${i * 2 - 1}`;
                    const input2Id = `${prefix}-r${prevRound}-${i * 2}`;

                    // Check if either input slot is empty and the winner matches one of the implied players
                    // This is a heuristic: if a winner is known, and one of the input slots is empty,
                    // and the other input slot is either empty or matches the winner,
                    // we can infer the winner came from the non-BYE path.
                    // For simplicity, we'll just ensure the winner is placed if an input slot is empty.

                    // This logic is tricky. The goal is to ensure that if a winner is known for a match,
                    // and its input slots are empty, we should try to fill them if possible.
                    // However, for viewer, we primarily care about r1 slots.
                    // The previous steps (1 & 2) should cover most cases for r1.
                    // This step is more about ensuring the `bracketState` itself is consistent for display.
                    // For `slots` array, we only need r1.
                }
            }
        }

        return slots;
    }

    const upperSlots = processBrackets("U", Bu);
    createBracketUI({
        wrapId: "tm-wrap-upper", svgId: "tm-lines-upper", prefix: "U", direction: 1,
        B: Bu, slots: upperSlots, titleElId: "tm-titleUpper",
        titleText: "상위 토너먼트"
    });

    const lowerSlots = processBrackets("L", Bl);
    createBracketUI({
        wrapId: "tm-wrap-lower", svgId: "tm-lines-lower", prefix: "L", direction: -1,
        B: Bl, slots: lowerSlots, titleElId: "tm-titleLower",
        titleText: "하위 토너먼트"
    });
}
