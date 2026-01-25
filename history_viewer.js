const GAS_URL = "https://script.google.com/macros/s/AKfycbybkNRimOGBcCYH7HAbiT6lhlqtT9SzVZ0QjDxkD6By1ePgtv5XS8-eGSIIRocNpdJn/exec";

// --- 글로벌 상태 (Viewer 전용) ---
let currentHistoryList = [];
let currentIndex = -1;

const state = new Map();
const resultsByTeam = new Map();
const manualRankByTeam = new Map();
const bracketState = new Map();
const PLAYER_INFO = new Map();
let currentGroupsCount = 4; // 글로벌 상태 추가

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
        // 사용자에게 구체적인 오류 원인 힌트 제공
        const errorMsg = e.message.includes("fetch") ? "네트워크 오류 또는 CORS 정책 위반" : e.message;
        console.log("상세 오류:", errorMsg);

        // Fallback: 샘플 데이터 로드
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
        if (item.date === "window.SAMPLE_HISTORY_DATA") {
            return `<option value="${item.date}">${item.title}</option>`;
        }
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
            console.log("Fetched raw fullData:", data.fullData);
            let fullData;
            if (typeof data.fullData === 'string') {
                fullData = JSON.parse(data.fullData);
            } else {
                fullData = data.fullData;
            }
            initViewer(fullData);
            currentIndex = currentHistoryList.findIndex(item => String(item.date) === String(date));
            updateNavButtons();
            document.getElementById("historySelect").value = date;
        } else {
            console.error("Server returned success:false", data.msg);
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
        console.error("Invalid fullData structure", fullData);
        alert("데이터 형식이 올바르지 않습니다.");
        return;
    }
    const { metadata, playersState, resultsByTeam: results, manualRankByTeam: manuals, bracketState: brackets, finalSummary } = fullData;

    currentGroupsCount = metadata.groupsCount || 4; // 그룹 수 저장

    document.title = `${metadata.title} - 기록 조회`;
    document.getElementById("headerTitle").textContent = metadata.title;
    document.getElementById("headerDate").textContent = metadata.date;

    // PLAYER_INFO 복원
    PLAYER_INFO.clear();
    const pStateRaw = playersState || [];
    const pStateMap = new Map(pStateRaw);
    pStateMap.forEach((v, name) => {
        if (v.grade) PLAYER_INFO.set(name, { name, grade: v.grade });
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
    if (finalSummary) renderFinalSummary(finalSummary);
    else {
        // finalSummary가 없을 경우 초기화
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

    // 지원: third 또는 semiFinalists 속성 모두 대응
    const upper3rd = data.upper.third || data.upper.semiFinalists;
    set("sum-u-3", upper3rd);

    set("sum-l-1", data.lower.winner);
    set("sum-l-2", data.lower.runnerUp);

    const lower3rd = data.lower.third || data.lower.semiFinalists;
    if (document.getElementById("sum-l-3")) set("sum-l-3", lower3rd);
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

function getPlayerRankLabel(name) {
    const p = state.get(name);
    if (!p || p.where !== "team" || !p.teamId) return "";
    const teamId = p.teamId;
    const playersInTeam = Array.from(state.entries())
        .filter(([_, v]) => v.where === "team" && v.teamId === teamId)
        .map(([k, _]) => k);
    const autoPack = computeRanking(teamId, playersInTeam);
    const final = resolveFinalRanks(teamId, autoPack);
    const f = final.get(name);
    const gNum = parseInt(teamId.split("-")[1]) + 1;
    return f && f.finalRank !== 999 ? `${gNum}조 ${f.finalRank}위` : "";
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
            const eA = document.getElementById(m.a), eB = document.getElementById(m.b), toE = document.getElementById(m.to);
            if (!toE) return;

            // 만약 어느 한쪽이 BYE라면 해당 경로는 즉시 소급 적용 (lose 스타일)
            if (isBye(eA)) applyStyles(m.a, m.b, m.to, m.b); // b가 승자라고 가정하거나 적어도 a는 lose
            if (isBye(eB)) applyStyles(m.a, m.b, m.to, m.a);

            if (isEmpty(toE)) return;
            const wName = extractName(toE), nA = extractName(eA), nB = extractName(eB);
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

    const byeCount = slots.filter(x => x === null).length;
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
        if (!pName) {
            el.textContent = "BYE";
            el.classList.add("bye");
        } else {
            const label = getPlayerRankLabel(pName);
            el.innerHTML = `<span class="tm-nm-wrap">${pName}${getGradeBadgeHTML(pName)}</span>${label ? `<small>${label}</small>` : ""}`;
            el.classList.remove("empty");
            el.classList.remove("bye");
        }
    }

    // Restore Winners from bracketState
    bracketState.forEach((val, id) => {
        if (!id.startsWith(prefix)) return;
        const el = document.getElementById(id);
        if (!el) return;

        let name = "";
        if (typeof val === 'string') {
            name = val;
        } else if (val && val.winner) {
            name = val.winner;
        }

        if (name && name !== "BYE") {
            const label = getPlayerRankLabel(name);
            el.innerHTML = `<span class="tm-nm-wrap">${name}${getGradeBadgeHTML(name)}</span>${label ? `<small>${label}</small>` : ""}`;
            el.classList.remove("empty");
            el.classList.remove("bye");
        } else if (name === "BYE") {
            el.textContent = "BYE";
            el.classList.add("bye");
            el.classList.add("empty");
        }
    });

    createTournamentLineEngine({ wrapEl: wrap, svg, prefix, direction, rounds, nodeId }).initLines();
}


function renderBrackets() {
    function nextPow2(n) { if (n <= 1) return 1; let p = 1; while (p < n) p *= 2; return Math.max(p, 2); }

    function calculateB() {
        // 1. [최우선] 실제 대진표 데이터(bracketState) 스캔 (9~16번 슬롯 유무)
        function check16(prefix) {
            for (let i = 9; i <= 16; i++) if (bracketState.has(`${prefix}-r1-${i}`)) return true;
            for (let i = 5; i <= 8; i++) if (bracketState.has(`${prefix}-r2-${i}`)) return true;
            const winner = bracketState.get(`${prefix}-winner`);
            if (winner && typeof winner === 'object' && (winner.p1 || winner.p2)) {
                // 상위 라운드에서 9~16번 시드 출신이 있는지 확인 (r4-2, r3-3/4 등)
                // (이 부분은 복잡하므로 r1, r2 체크로 충분할 수 있음)
            }
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
        // 1. Implied Winners Backfilling (r5/r4 -> r3 -> r2)
        // 상위 라운드의 p1, p2를 하위 라운드 승자로 채움
        const rounds = Math.log2(B);
        const totalRounds = rounds + 1;
        for (let r = totalRounds; r >= 2; r--) {
            const currentRoundCount = Math.pow(2, totalRounds - r);
            for (let i = 1; i <= currentRoundCount; i++) {
                const matchId = (r === totalRounds) ? `${prefix}-winner` : `${prefix}-r${r}-${i}`;
                const match = bracketState.get(matchId);
                if (match && typeof match === 'object' && (match.p1 || match.p2)) {
                    const p1Id = `${prefix}-r${r - 1}-${i * 2 - 1}`;
                    const p2Id = `${prefix}-r${r - 1}-${i * 2}`;
                    if (match.p1 && !bracketState.has(p1Id)) bracketState.set(p1Id, match.p1);
                    if (match.p2 && !bracketState.has(p2Id)) bracketState.set(p2Id, match.p2);
                }
            }
        }

        // 2. r1 Slots Reconstruction (r2 매치 데이터 기반)
        const slots = new Array(B).fill(null);
        const r2Count = B / 2;
        for (let i = 1; i <= r2Count; i++) {
            const match = bracketState.get(`${prefix}-r2-${i}`);
            if (match && typeof match === 'object') {
                slots[(i - 1) * 2] = match.p1 || null;
                slots[(i - 1) * 2 + 1] = match.p2 || null;
            }
        }
        // 만약 r1 데이터가 직접 있으면 덮어쓰기
        for (let i = 1; i <= B; i++) {
            const val = bracketState.get(`${prefix}-r1-${i}`);
            if (typeof val === 'string') slots[i - 1] = val;
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
        wrapId: "tm-wrap-lower", svgId: "tm-lines-lower", prefix: "L", direction: 0,
        B: Bl, slots: lowerSlots, titleElId: "tm-titleLower",
        titleText: "하위 토너먼트"
    });
}
