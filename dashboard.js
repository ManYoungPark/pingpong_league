/**
 * dashboard.js
 * 구글 드라이브(GAS) 실데이터 연동 종합 대시보드 & 선수별 심층 분석 (Chart.js)
 */

const DASH_GAS_URL = "https://script.google.com/macros/s/AKfycbzNkG3ZT9SVvkm5Qxel62eLsYbUHEEB8L2QQMZlY2jN48hKmqELaB8S2mOoL3_qqQOc/exec";
const DASH_CACHE_KEY = "ddv_dashboard_snapshots_cache_v2";
const DASH_PRECOMPUTED_KEY = "ddv_precomputed_analytics_v2";

const chartInstances = {};

// 글로벌 분석 상태
let dashAnalytics = null; // { tourneyCount, totalMatches, playersMap, summaryList, allMatches }
let currentPaSort = "points"; // 'points' | 'winrate' | 'attend' | 'name'
let selectedPlayerName = null;
let selectedScoreChartType = "combo"; // 'combo' | 'line' | 'bar' | 'radar'
let selectedOppChartType = "stackedBar"; // 'stackedBar' | 'winRateBar' | 'doughnut' | 'polarArea' | 'bubble'
let dashSyncInProgress = false;

// 화면 표시용 색상 (같은 의미에는 항상 같은 색: 승리=파랑, 패배=빨강, 강조=네이비)
const DX = {
    win: "#1d4ed8",
    lose: "#dc2626",
    accent: "#1e40af",
    accentSoft: "#93b4ea",
    ink: "#0f172a",
    text: "#475569",
    grid: "#e8edf3",
    palette: [
        "#1e40af", "#2563eb", "#60a5fa", "#0f766e", "#14b8a6", "#5eead4",
        "#475569", "#94a3b8", "#7c3aed", "#a78bfa", "#b45309", "#d6a756"
    ]
};

// Chart.js 공통 모양 (이 파일의 차트에만 적용됨 — 다른 화면은 Chart.js를 쓰지 않음)
if (window.Chart) {
    Chart.defaults.font.family = '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Noto Sans KR", sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = DX.text;
    Chart.defaults.borderColor = DX.grid;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.tooltip.padding = 10;
}

// 화면에 이름 등을 넣을 때 사용하는 간단한 이스케이프
function dxEsc(v) {
    return String(v == null ? "" : v)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    renderHistory();

    // 대시보드 QR 배지: 키보드(Enter/Space)로도 열 수 있게 함
    const dashQr = document.getElementById("btn-dash-qr");
    if (dashQr) {
        dashQr.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dashQr.click();
            }
        });
    }
});

/* =========================================
   1. Tab Logic
   ========================================= */
function initTabs() {
    const tabs = document.querySelectorAll(".tab-btn");
    const contents = document.querySelectorAll(".tab-content");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t => t.classList.remove("active"));
            contents.forEach(c => c.classList.remove("active"));

            tab.classList.add("active");
            const targetId = tab.dataset.target;
            document.getElementById(targetId).classList.add("active");

            if (targetId === "tab-history") {
                setTimeout(() => {
                    if (typeof h_renderBrackets === "function") h_renderBrackets();
                }, 30);
                if (typeof h_fetchHistoryList === "function") h_fetchHistoryList();
            }
            if (targetId === "tab-dashboard-view") {
                setTimeout(() => {
                    initOrRenderDashboard();
                }, 20);
            }
        });
    });

    // URL 해시(#dashboard)로 열면 즉시 대시보드 탭 활성화
    if (window.location.hash === "#dashboard" || window.location.search.includes("tab=dashboard")) {
        const dashBtn = Array.from(tabs).find(t => t.dataset.target === "tab-dashboard-view");
        if (dashBtn) dashBtn.click();
    }
}

/* =========================================
   2. Legacy History Fallback
   ========================================= */
function renderHistory() {
    const listEl = document.getElementById("history-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    const data = (window.MOCK_DATA && window.MOCK_DATA.summary) ? [...window.MOCK_DATA.summary].reverse() : [];
    if (data.length === 0) {
        listEl.innerHTML = "<div style='padding:20px; text-align:center; color:#999;'>기록이 없습니다.</div>";
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
   3. Google Drive Data Sync & Caching
   ========================================= */
// level: false/undefined = 정상, true/"error" = 오류, "warn" = 주의(저장된 통계 표시 중 등)
function setDashSyncStatus(text, isLoading = false, level = false) {
    const box = document.getElementById("dash-sync-status");
    if (!box) return;
    const textEl = document.getElementById("dash-sync-text");
    const timeEl = document.getElementById("dash-sync-time");
    let state = isLoading ? "loading" : "ok";
    if (level === true || level === "error") state = "error";
    else if (level === "warn") state = "warn";
    box.dataset.state = state;
    if (textEl) textEl.textContent = text; else box.textContent = text;
    if (timeEl) timeEl.textContent = (state === "ok" || state === "warn") ? formatDashUpdatedAt(dashAnalytics && dashAnalytics.updatedAt) : "";
}

// 통계 계산본에 실제로 기록된 시각만 표시 (알 수 없으면 표시하지 않음)
function formatDashUpdatedAt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `· 마지막 업데이트 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setDashRefreshBusy(isBusy) {
    const btn = document.getElementById("btn-dash-refresh");
    if (!btn) return;
    btn.disabled = !!isBusy;
    btn.classList.toggle("is-spinning", !!isBusy);
    const label = document.getElementById("btn-dash-refresh-text");
    if (label) label.textContent = isBusy ? "새로고침 중…" : "통계 새로고침";
}

function loadCachedSnapshots() {
    try {
        const base = {};
        // 1. 정적 파일(stats_cache.js)에 내장된 스냅샷 로드
        if (window.PRECOMPUTED_DASH_CACHE && Array.isArray(window.PRECOMPUTED_DASH_CACHE.snapshots)) {
            window.PRECOMPUTED_DASH_CACHE.snapshots.forEach(({ metaItem, fullData }) => {
                if (metaItem?.date && fullData) {
                    const key = `${metaItem.date}___${metaItem.title || ""}`;
                    base[key] = fullData;
                }
            });
        }
        // 2. 로컬스토리지 스냅샷 병합
        const raw = localStorage.getItem(DASH_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) || {};
            Object.assign(base, parsed);
        }
        return base;
    } catch (e) {
        console.warn("Cache read failed", e);
        return {};
    }
}

function saveCachedSnapshots(cacheObj) {
    try {
        localStorage.setItem(DASH_CACHE_KEY, JSON.stringify(cacheObj));
    } catch (e) {
        console.warn("Cache save failed (quota)", e);
    }
}

function serializeDashAnalytics(analytics, signature) {
    if (!analytics || !analytics.playersMap) return null;
    const playersEntries = Array.from(analytics.playersMap.entries()).map(([name, p]) => [
        name,
        {
            ...p,
            opponents: Array.from(p.opponents.entries())
        }
    ]);
    return {
        signature: signature || analytics.signature || "",
        updatedAt: new Date().toISOString(),
        tourneyCount: analytics.tourneyCount || 0,
        totalMatches: analytics.totalMatches || 0,
        summaryList: analytics.summaryList || [],
        allMatches: analytics.allMatches || [],
        playersEntries
    };
}

function deserializeDashAnalytics(serialized) {
    if (!serialized || !Array.isArray(serialized.playersEntries)) return null;
    const playersMap = new Map();
    let needsOppMatchesRebuild = false;

    serialized.playersEntries.forEach(([name, p]) => {
        const oppMap = new Map();
        (Array.isArray(p.opponents) ? p.opponents : []).forEach(([oppName, oppObj]) => {
            if (!Array.isArray(oppObj.matches)) {
                needsOppMatchesRebuild = true;
            }
            oppMap.set(oppName, {
                ...oppObj,
                matches: Array.isArray(oppObj.matches) ? oppObj.matches : []
            });
        });
        playersMap.set(name, {
            ...p,
            grade: getPlayerGrade(name) || p.grade || null,
            opponents: oppMap
        });
    });

    const allMatches = Array.isArray(serialized.allMatches) ? serialized.allMatches : [];
    if (needsOppMatchesRebuild && allMatches.length > 0) {
        allMatches.forEach(m => {
            const parts = String(m.score || "0-0").split("-");
            const s1 = parseInt(parts[0], 10) || 0;
            const s2 = parseInt(parts[1], 10) || 0;
            const p1Win = (m.winner === m.p1);

            const o12 = playersMap.get(m.p1)?.opponents.get(m.p2);
            if (o12) o12.matches.push({ date: m.date, title: m.title || "정기리그", stage: m.stage, myScore: s1, opScore: s2, isWin: p1Win });

            const o21 = playersMap.get(m.p2)?.opponents.get(m.p1);
            if (o21) o21.matches.push({ date: m.date, title: m.title || "정기리그", stage: m.stage, myScore: s2, opScore: s1, isWin: !p1Win });
        });
    }

    return {
        signature: serialized.signature || "",
        updatedAt: serialized.updatedAt || null,
        tourneyCount: serialized.tourneyCount || 0,
        totalMatches: serialized.totalMatches || 0,
        summaryList: serialized.summaryList || [],
        allMatches,
        playersMap
    };
}

function loadPrecomputedAnalytics() {
    // 1. localStorage에 저장된 최신 계산본 확인
    try {
        const raw = localStorage.getItem(DASH_PRECOMPUTED_KEY);
        if (raw) {
            const parsed = deserializeDashAnalytics(JSON.parse(raw));
            if (parsed && parsed.tourneyCount > 0) return parsed;
        }
    } catch (e) {
        console.warn("Precomputed localStorage load failed", e);
    }
    // 2. stats_cache.js 파일에 사전 계산된 통계본이 있으면 즉시 사용 (재계산 0초)
    if (window.PRECOMPUTED_DASH_CACHE && window.PRECOMPUTED_DASH_CACHE.precomputedAnalytics) {
        const parsed = deserializeDashAnalytics(window.PRECOMPUTED_DASH_CACHE.precomputedAnalytics);
        if (parsed && parsed.tourneyCount > 0) return parsed;
    }
    return null;
}

function savePrecomputedAnalyticsLocal(analytics, signature) {
    try {
        const ser = serializeDashAnalytics(analytics, signature);
        if (ser) localStorage.setItem(DASH_PRECOMPUTED_KEY, JSON.stringify(ser));
    } catch (e) {
        console.warn("Precomputed localStorage save failed", e);
    }
}

async function savePrecomputedAnalyticsToDrive(analytics, signature) {
    try {
        const ser = serializeDashAnalytics(analytics, signature);
        if (!ser) return;
        const cacheDateKey = `__STATS_CACHE_${signature}__`;
        const payload = {
            date: cacheDateKey,
            results: [], // raw_data 시트에는 기록하지 않음
            fullData: JSON.stringify({
                __isPrecomputedStats: true,
                metadata: {
                    date: cacheDateKey,
                    title: "대시보드_사전계산_통계캐시"
                },
                precomputedAnalytics: ser
            })
        };
        await fetch(DASH_GAS_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn("Failed to upload precomputed analytics to Drive", e);
    }
}

function downloadStatsCacheJS() {
    const cache = loadCachedSnapshots();
    const snaps = Object.keys(cache)
        .filter(k => !k.startsWith("__STATS_CACHE_"))
        .sort()
        .map(k => ({
            metaItem: { date: k.split("___")[0], title: k.split("___")[1] || "" },
            fullData: cache[k]
        }))
        .filter(({ metaItem, fullData }) => !isDummyOrTestSnapshot(metaItem, fullData));

    const analytics = dashAnalytics || buildAnalyticsFromSnapshots(snaps);
    const latestDate = snaps.length > 0 ? snaps[snaps.length - 1].metaItem.date : "";
    const sig = `v2_${snaps.length}_${latestDate}`;
    const ser = serializeDashAnalytics(analytics, sig);

    const jsContent =
        `// 자동 생성된 사전 계산 캐시 파일 (stats_cache.js)\n` +
        `// 기준일: ${latestDate} (총 ${snaps.length}개 정규 금요리그)\n` +
        `window.PRECOMPUTED_DASH_CACHE = ` +
        JSON.stringify({
            version: 2,
            signature: sig,
            latestDate,
            tourneyCount: snaps.length,
            precomputedAnalytics: ser,
            snapshots: snaps
        }) +
        `;\n`;

    const blob = new Blob([jsContent], { type: "application/javascript;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stats_cache.js";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 목록에서 유효 금요리그만 추려 고유 서명(signature) 생성
function extractValidFridayTourneyList(rawList) {
    const uniqueMap = new Map();
    const remoteCacheKeys = new Set();

    (rawList || []).forEach(item => {
        if (!item || !item.date) return;
        const dStr = String(item.date);
        if (dStr.startsWith("__STATS_CACHE_")) {
            remoteCacheKeys.add(dStr);
            return;
        }
        const tStr = String(item.title || "");
        if (dStr < "2026-01-30") return;
        if (tStr.includes("번외경기") || tStr.includes("테스트") || tStr.includes("시뮬레이션")) return;
        const dt = new Date(dStr + "T00:00:00");
        if (!isNaN(dt.getTime()) && dt.getDay() !== 5) return;

        const key = `${dStr}___${tStr}`;
        uniqueMap.set(key, item);
    });

    const tourneyList = Array.from(uniqueMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const latestDate = tourneyList.length > 0 ? String(tourneyList[tourneyList.length - 1].date) : "none";
    const signature = `v2_${tourneyList.length}_${latestDate}`;
    return { tourneyList, signature, remoteCacheKeys };
}

async function initOrRenderDashboard() {
    if (dashAnalytics) {
        renderAllDashboardViews();
        return;
    }
    // 1. 사전 계산된 통계(stats_cache.js 또는 localStorage)가 있으면 재계산 없이 0.01초 만에 즉시 표시!
    const precomputed = loadPrecomputedAnalytics();
    if (precomputed) {
        dashAnalytics = precomputed;
        renderAllDashboardViews();
        setDashSyncStatus(`저장된 통계를 표시했습니다 · 최신 여부를 확인하는 중 (정규 ${dashAnalytics.tourneyCount}개 대회)`, true);
    }
    // 2. 백그라운드에서 새 대회가 올라왔는지만 가볍게 확인
    await syncDashboardData(false);
}

async function syncDashboardData(forceRefresh = false) {
    if (dashSyncInProgress) return;
    dashSyncInProgress = true;

    setDashRefreshBusy(true);

    try {
        if (forceRefresh) {
            setDashSyncStatus("서버에서 전체 통계를 다시 계산하고 저장하는 중입니다. 잠시만 기다려 주세요…", true);
        } else if (!dashAnalytics) {
            setDashSyncStatus("통계를 불러오는 중입니다…", true);
        }

        // [구조 0 - 초고속 Supabase DB] Supabase pingpong_stats_cache 가 활성화되어 있으면 0.05초 만에 즉시 로드
        if (!forceRefresh && window.pingpongSupabase) {
            try {
                const { data: sbRow, error: sbErr } = await window.pingpongSupabase
                    .from("stats_cache")
                    .select("stats_json, updated_at")
                    .eq("id", "main")
                    .maybeSingle();
                if (!sbErr && sbRow && sbRow.stats_json) {
                    const restoredSb = deserializeDashAnalytics(sbRow.stats_json);
                    if (restoredSb && restoredSb.tourneyCount > 0) {
                        if (!restoredSb.updatedAt && sbRow.updated_at) restoredSb.updatedAt = sbRow.updated_at;
                        dashAnalytics = restoredSb;
                        savePrecomputedAnalyticsLocal(dashAnalytics, dashAnalytics.signature);
                        renderAllDashboardViews();
                        setDashSyncStatus(`통계 업데이트 완료 · 정규 ${dashAnalytics.tourneyCount}개 대회`, false);
                        return;
                    }
                }
            } catch (_) {}
        }

        // [구조 2 - 핵심] 구글 서버(Google Apps Script)에 저장된 통계(getStats) 또는 서버 재계산(rebuildStats) 요청
        try {
            const serverAction = forceRefresh ? "rebuildStats" : "getStats";
            const serverRes = await fetch(`${DASH_GAS_URL}?action=${serverAction}`);
            const serverData = await serverRes.json();

            if (serverData && serverData.success && serverData.stats) {
                const restoredFromServer = deserializeDashAnalytics(serverData.stats);
                if (restoredFromServer && restoredFromServer.tourneyCount > 0) {
                    dashAnalytics = restoredFromServer;
                    savePrecomputedAnalyticsLocal(dashAnalytics, dashAnalytics.signature);
                    if (window.pingpongSupabase) {
                        window.pingpongSupabase.from("stats_cache").upsert({
                            id: "main",
                            signature: dashAnalytics.signature || "",
                            tourney_count: dashAnalytics.tourneyCount || 0,
                            total_matches: dashAnalytics.totalMatches || 0,
                            stats_json: serverData.stats,
                            updated_at: new Date().toISOString()
                        }, { onConflict: "id" }).catch(() => {});
                    }
                    renderAllDashboardViews();
                    const modeLabel = forceRefresh
                        ? "통계 새로고침 완료 (서버에서 다시 계산하고 저장함)"
                        : (serverData.fromServerCache ? "통계 업데이트 완료" : "통계 업데이트 완료 (서버에서 새로 계산함)");
                    setDashSyncStatus(`${modeLabel} · 정규 ${dashAnalytics.tourneyCount}개 대회`, false);
                    return;
                }
            }
        } catch (serverErr) {
            console.warn("Server getStats fallback:", serverErr);
        }

        // [폴백] 아직 구글 시트 Apps Script(gas_updated.js)가 새 버전으로 배포되기 전인 경우에도 완벽히 작동하도록 유지
        const listRes = await fetch(`${DASH_GAS_URL}?action=getList`);
        const listData = await listRes.json();

        if (!listData.success || !Array.isArray(listData.list) || listData.list.length === 0) {
            throw new Error("대회 목록이 비어 있습니다.");
        }

        const { tourneyList, signature, remoteCacheKeys } = extractValidFridayTourneyList(listData.list);
        const expectedCacheRowKey = `__STATS_CACHE_${signature}__`;

        // [폴백 1] 강제 동기화가 아니고, 현재 메모리의 사전 계산 통계가 최신 대회 서명(signature)과 일치하면 재계산/다운로드 없이 즉시 종료!
        if (!forceRefresh && dashAnalytics && dashAnalytics.signature === signature) {
            setDashSyncStatus(`최신 통계입니다 · 정규 ${dashAnalytics.tourneyCount}개 대회`, false);
            return;
        }

        // [핵심 2] 강제 동기화가 아니고, 새 대회가 추가되었는데 구글 드라이브에 이미 계산된 캐시(__STATS_CACHE_...)가 올라와 있다면
        // 다른 사람들은 40개 대회를 다운받거나 재계산하지 않고 그 계산된 결과 1개만 딱 읽어서 바로 표시!
        if (!forceRefresh && remoteCacheKeys.has(expectedCacheRowKey)) {
            setDashSyncStatus("서버에 저장된 최신 통계를 불러오는 중입니다…", true);
            const cacheRes = await fetch(`${DASH_GAS_URL}?action=getData&date=${encodeURIComponent(expectedCacheRowKey)}`);
            const cacheData = await cacheRes.json();
            if (cacheData.success && cacheData.fullData) {
                const parsed = typeof cacheData.fullData === "string" ? JSON.parse(cacheData.fullData) : cacheData.fullData;
                if (parsed && parsed.precomputedAnalytics) {
                    const restored = deserializeDashAnalytics(parsed.precomputedAnalytics);
                    if (restored && restored.tourneyCount > 0) {
                        restored.signature = signature;
                        dashAnalytics = restored;
                        savePrecomputedAnalyticsLocal(dashAnalytics, signature);
                        renderAllDashboardViews();
                        setDashSyncStatus(`통계 업데이트 완료 · 정규 ${dashAnalytics.tourneyCount}개 대회`, false);
                        return;
                    }
                }
            }
        }

        // [핵심 3] 새 대회가 처음 올라왔거나, 관리자가 '🔄 최신 동기화'를 눌렀을 때만 스냅샷을 모아 재계산 수행!
        let cache = forceRefresh ? {} : loadCachedSnapshots();

        const missingItems = tourneyList.filter(item => {
            const key = `${item.date}___${item.title || ""}`;
            if (forceRefresh) return true;
            return !cache[key];
        });

        if (missingItems.length > 0) {
            let completed = 0;
            const totalToFetch = missingItems.length;
            const BATCH_SIZE = 8;

            for (let i = 0; i < missingItems.length; i += BATCH_SIZE) {
                const batch = missingItems.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (item) => {
                    try {
                        const qDate = encodeURIComponent(item.date);
                        const qTitle = encodeURIComponent(item.title || "");
                        const res = await fetch(`${DASH_GAS_URL}?action=getData&date=${qDate}&title=${qTitle}`);
                        const d = await res.json();
                        if (d.success && d.fullData) {
                            const parsed = (typeof d.fullData === "string") ? JSON.parse(d.fullData) : d.fullData;
                            const key = `${item.date}___${item.title || ""}`;
                            cache[key] = parsed;
                        }
                    } catch (err) {
                        console.warn("Snapshot fetch error:", item.date, err);
                    } finally {
                        completed++;
                        setDashSyncStatus(`새 대회 기록을 불러와 다시 계산하는 중입니다… (${completed}/${totalToFetch})`, true);
                    }
                }));
            }

            saveCachedSnapshots(cache);
        }

        // 전체 스냅샷 조립 및 분석 재계산 실행
        const finalSnapshots = [];
        tourneyList.forEach(item => {
            const key = `${item.date}___${item.title || ""}`;
            if (cache[key]) finalSnapshots.push({ metaItem: item, fullData: cache[key] });
        });

        dashAnalytics = buildAnalyticsFromSnapshots(finalSnapshots);
        dashAnalytics.signature = signature;
        dashAnalytics.updatedAt = new Date().toISOString(); // 방금 실제로 계산한 시각

        // 재계산된 결과를 로컬 캐시 및 구글 드라이브에 저장 (다음 접속자들은 재계산 없이 바로 조회!)
        savePrecomputedAnalyticsLocal(dashAnalytics, signature);
        if (!remoteCacheKeys.has(expectedCacheRowKey) || forceRefresh) {
            savePrecomputedAnalyticsToDrive(dashAnalytics, signature);
        }

        renderAllDashboardViews();
        setDashSyncStatus(`통계 새로고침 완료 (다시 계산하고 저장함) · 정규 ${dashAnalytics.tourneyCount}개 대회`, false);

    } catch (err) {
        console.error("Dashboard sync failed, falling back to precomputed or cache:", err);
        if (!dashAnalytics) {
            const pre = loadPrecomputedAnalytics();
            if (pre) {
                dashAnalytics = pre;
                renderAllDashboardViews();
                setDashSyncStatus(`저장된 통계를 표시 중입니다. 서버에 연결하지 못했습니다 · 정규 ${dashAnalytics.tourneyCount}개 대회`, false, "warn");
            } else {
                setDashSyncStatus("통계를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 '통계 새로고침'을 눌러 주세요.", false, "error");
            }
        } else {
            setDashSyncStatus(`저장된 통계를 표시 중입니다. 최신 통계를 확인하지 못했습니다 · 정규 ${dashAnalytics.tourneyCount}개 대회`, false, "warn");
        }
    } finally {
        dashSyncInProgress = false;
        setDashRefreshBusy(false);
    }
}

/* =========================================
   4. Analytics Engine (Snapshots -> Player Stats)
   ========================================= */
function getPlayerGrade(name, snapshotGrades) {
    if (typeof PLAYER_INFO !== "undefined" && PLAYER_INFO.has(name)) {
        const g = PLAYER_INFO.get(name)?.grade;
        if (g) return g;
    }
    if (snapshotGrades && snapshotGrades.has(name)) {
        return snapshotGrades.get(name);
    }
    return null;
}

function ensurePlayerObj(playersMap, name, snapshotGrades) {
    if (!playersMap.has(name)) {
        playersMap.set(name, {
            name,
            grade: getPlayerGrade(name, snapshotGrades),
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
            tourneyHistory: [], // [{ date, title, points, cumulativePoints, detail, dayWin, dayLose }]
            opponents: new Map() // oppName -> { name, coAttend: 0, sameGroup: 0, played: 0, win: 0, lose: 0, setsFor: 0, setsAgainst: 0, matches: [] }
        });
    } else {
        const p = playersMap.get(name);
        if (!p.grade) p.grade = getPlayerGrade(name, snapshotGrades);
    }
    return playersMap.get(name);
}

function ensureOpponentObj(playerObj, oppName) {
    if (!playerObj.opponents.has(oppName)) {
        playerObj.opponents.set(oppName, {
            name: oppName,
            coAttend: 0,
            sameGroup: 0,
            played: 0,
            win: 0,
            lose: 0,
            setsFor: 0,
            setsAgainst: 0,
            matches: [] // [{ date, title, stage, myScore, opScore, isWin }]
        });
    }
    return playerObj.opponents.get(oppName);
}

// 개발 초기 테스트 버튼(가나다순 22명 배정 / SPECIFIC_TEST_DATA / 금요일 외 번외 시뮬레이션)으로 저장된 더미 스냅샷 판별
function isDummyOrTestSnapshot(metaItem, fullData) {
    if (!fullData) return true;
    const date = String(fullData.metadata?.date || metaItem?.date || "");
    const title = String(fullData.metadata?.title || metaItem?.title || "");

    // 1. 금요일(getDay() === 5)이 아닌 날짜의 기록은 테스트 데이터이므로 제외
    if (date) {
        const dt = new Date(date + "T00:00:00");
        if (!isNaN(dt.getTime()) && dt.getDay() !== 5) return true;
    }

    // 2. 2026-01-30 첫 정규 금요리그 이전에 저장된 개발/테스트용 더미 기록(01-02, 01-16) 제외
    if (date && date < "2026-01-30") return true;

    // 3. 번외경기(테스트 시뮬레이션) 제외
    if (title.includes("번외경기") || title.includes("테스트") || title.includes("시뮬레이션")) return true;

    // 4. runAutoTestScenarioMixed 가나다순 고정 1조(['김경태','김미경','김성호','김세중','김형찬']) 더미 패턴 제외
    const pStateArr = Array.isArray(fullData.playersState) ? fullData.playersState : [];
    const t1 = pStateArr
        .filter(([_, val]) => val && typeof val === "object" && val.where === "team" && val.teamId === "team-1")
        .map(([nm]) => nm);
    if (t1.length === 5 && t1.join(",") === "김경태,김미경,김성호,김세중,김형찬") {
        return true;
    }

    return false;
}

function buildAnalyticsFromSnapshots(snapshots) {
    const playersMap = new Map();
    const snapshotGrades = new Map();
    const summaryList = [];
    const allMatches = [];

    // 테스트/더미 스냅샷 제외 후 날짜 오름차순 정렬
    const validSnaps = snapshots.filter(({ metaItem, fullData }) => !isDummyOrTestSnapshot(metaItem, fullData));
    const sortedSnaps = [...validSnaps].sort((a, b) => {
        const da = String(a.fullData?.metadata?.date || a.metaItem?.date || "");
        const db = String(b.fullData?.metadata?.date || b.metaItem?.date || "");
        return da.localeCompare(db);
    });

    sortedSnaps.forEach(({ metaItem, fullData }) => {
        if (!fullData) return;
        const date = String(fullData.metadata?.date || metaItem?.date || "");
        const title = String(fullData.metadata?.title || metaItem?.title || "정기리그");
        const isFull = (fullData.tournamentType === "full");

        // 1. 참가자 및 조 편성 파악
        const attendees = new Set();
        const teamByPlayer = new Map();
        const pStateArr = Array.isArray(fullData.playersState) ? fullData.playersState : [];
        pStateArr.forEach(([nm, val]) => {
            if (!nm || nm === "BYE" || nm === "?") return;
            if (val && typeof val === "object") {
                if (val.grade) snapshotGrades.set(nm, val.grade);
                if (val.where === "team") {
                    attendees.add(nm);
                    if (val.teamId) teamByPlayer.set(nm, val.teamId);
                }
            }
        });

        // 당일 선수별 승패 카운터
        const dayStats = new Map(); // name -> { win: 0, lose: 0 }
        const bumpDay = (nm, isWin) => {
            if (!dayStats.has(nm)) dayStats.set(nm, { win: 0, lose: 0 });
            if (isWin) dayStats.get(nm).win++;
            else dayStats.get(nm).lose++;
        };

        const recordMatchPair = (p1, p2, s1, s2, stage) => {
            if (!p1 || !p2 || p1 === "BYE" || p2 === "BYE" || p1 === "?" || p2 === "?" || p1 === p2) return;
            if (!Number.isFinite(s1) || !Number.isFinite(s2) || (s1 === 0 && s2 === 0)) return;

            attendees.add(p1);
            attendees.add(p2);

            const winner = s1 > s2 ? p1 : (s2 > s1 ? p2 : null);
            if (!winner) return;

            allMatches.push({
                date,
                title,
                stage,
                p1,
                p2,
                score: `${s1}-${s2}`,
                winner
            });

            const obj1 = ensurePlayerObj(playersMap, p1, snapshotGrades);
            const obj2 = ensurePlayerObj(playersMap, p2, snapshotGrades);

            const p1Win = (winner === p1);
            obj1.matchesPlayed++;
            obj2.matchesPlayed++;
            if (p1Win) { obj1.matchesWon++; obj2.matchesLost++; }
            else { obj2.matchesWon++; obj1.matchesLost++; }

            if (stage === "예선") {
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

            // 상대 전적 업데이트
            const opp12 = ensureOpponentObj(obj1, p2);
            opp12.played++;
            if (p1Win) opp12.win++; else opp12.lose++;
            opp12.setsFor += s1; opp12.setsAgainst += s2;
            opp12.matches.push({ date, title, stage, myScore: s1, opScore: s2, isWin: p1Win });

            const opp21 = ensureOpponentObj(obj2, p1);
            opp21.played++;
            if (!p1Win) opp21.win++; else opp21.lose++;
            opp21.setsFor += s2; opp21.setsAgainst += s1;
            opp21.matches.push({ date, title, stage, myScore: s2, opScore: s1, isWin: !p1Win });
        };

        // 2. 예선 리그전 경기 추출 (resultsByTeam)
        const resByTeamArr = Array.isArray(fullData.resultsByTeam) ? fullData.resultsByTeam : [];
        resByTeamArr.forEach(([teamId, pairList]) => {
            if (!Array.isArray(pairList)) return;
            pairList.forEach(([pairKey, resObj]) => {
                if (!pairKey || !resObj || !resObj.score) return;
                const players = String(pairKey).split("|||");
                if (players.length !== 2) return;
                const pts = String(resObj.score).split("-");
                if (pts.length !== 2) return;
                const s1 = parseInt(pts[0], 10);
                const s2 = parseInt(pts[1], 10);
                recordMatchPair(players[0], players[1], s1, s2, "예선");
            });
        });

        // 3. 본선 토너먼트 경기 추출 (bracketState)
        const bStateArr = Array.isArray(fullData.bracketState) ? fullData.bracketState : [];
        bStateArr.forEach(([nodeKey, val]) => {
            if (!nodeKey || !val || typeof val !== "object") return;
            // match object has p1, p2, winner, score
            const p1 = val.p1;
            const p2 = val.p2;
            const winner = val.winner;
            if (!p1 || !p2 || p1 === "BYE" || p2 === "BYE" || !winner || winner === "BYE") return;

            let s1 = 0, s2 = 0;
            if (val.score && String(val.score).includes("-")) {
                const sp = String(val.score).split("-");
                s1 = parseInt(sp[0], 10);
                s2 = parseInt(sp[1], 10);
                // 일부 스냅샷에서 score가 승자 기준인지 p1 기준인지 보정
                if (winner === p1 && s1 < s2) [s1, s2] = [s2, s1];
                if (winner === p2 && s2 < s1) [s1, s2] = [s2, s1];
            } else {
                s1 = (winner === p1) ? 2 : 0;
                s2 = (winner === p2) ? 2 : 0;
            }
            const stageLabel = String(nodeKey).startsWith("L-") ? "본선(하위)" : "본선(상위)";
            recordMatchPair(p1, p2, s1, s2, stageLabel);
        });

        // 4. 동반 출전 (어떤 사람과 같은 대회를 몇 번 함께 나갔는지) 기록
        const attendeeList = Array.from(attendees);
        for (let i = 0; i < attendeeList.length; i++) {
            const A = attendeeList[i];
            const objA = ensurePlayerObj(playersMap, A, snapshotGrades);
            for (let j = i + 1; j < attendeeList.length; j++) {
                const B = attendeeList[j];
                const objB = ensurePlayerObj(playersMap, B, snapshotGrades);

                const oppAB = ensureOpponentObj(objA, B);
                const oppBA = ensureOpponentObj(objB, A);
                oppAB.coAttend++;
                oppBA.coAttend++;

                if (teamByPlayer.get(A) && teamByPlayer.get(A) === teamByPlayer.get(B)) {
                    oppAB.sameGroup++;
                    oppBA.sameGroup++;
                }
            }
        }

        // 5. 대회별 포인트 및 입상 내역 집계 (exportToGoogleSheet 동일 규칙)
        const upper = fullData.finalSummary?.upper || {};
        const lower = fullData.finalSummary?.lower || {};

        const cleanName = (nm) => (nm && nm !== "-" && nm !== "미정" && nm !== "?") ? String(nm).trim() : null;
        const uWinner = cleanName(upper.winner);
        const uRunner = cleanName(upper.runnerUp);
        const uSemis = Array.isArray(upper.semiFinalists)
            ? upper.semiFinalists.map(cleanName).filter(Boolean)
            : (cleanName(upper.third) ? String(upper.third).split(",").map(s => cleanName(s)).filter(Boolean) : []);

        const lWinner = cleanName(lower.winner);
        const lRunner = cleanName(lower.runnerUp);

        [uWinner, uRunner, ...uSemis, lWinner, lRunner].filter(Boolean).forEach(nm => attendees.add(nm));

        summaryList.push({
            date,
            title,
            winner: uWinner,
            runnerUp: uRunner,
            winnerLower: lWinner,
            runnerUpLower: lRunner,
            participants: attendees.size
        });

        const dayPointsMap = new Map(); // name -> { pts, details[] }
        attendees.forEach(nm => {
            dayPointsMap.set(nm, { pts: 2, details: ["참가(+2)"] });
        });

        const addBonus = (nm, bonus, label) => {
            if (!nm) return;
            if (!dayPointsMap.has(nm)) dayPointsMap.set(nm, { pts: 2, details: ["참가(+2)"] });
            const item = dayPointsMap.get(nm);
            item.pts += bonus;
            item.details.push(`${label}(+${bonus})`);
        };

        if (isFull) {
            if (uWinner) { addBonus(uWinner, 6, "전체 우승"); ensurePlayerObj(playersMap, uWinner, snapshotGrades).upperWins++; }
            if (uRunner) { addBonus(uRunner, 5, "전체 준우승"); ensurePlayerObj(playersMap, uRunner, snapshotGrades).upperRunners++; }
            uSemis.forEach(nm => { addBonus(nm, 4, "전체 4강"); ensurePlayerObj(playersMap, nm, snapshotGrades).upperSemis++; });
        } else {
            if (uWinner) { addBonus(uWinner, 5, "상위 우승"); ensurePlayerObj(playersMap, uWinner, snapshotGrades).upperWins++; }
            if (uRunner) { addBonus(uRunner, 4, "상위 준우승"); ensurePlayerObj(playersMap, uRunner, snapshotGrades).upperRunners++; }
            uSemis.forEach(nm => { addBonus(nm, 3, "상위 4강"); ensurePlayerObj(playersMap, nm, snapshotGrades).upperSemis++; });
            if (lWinner) { addBonus(lWinner, 4, "하위 우승"); ensurePlayerObj(playersMap, lWinner, snapshotGrades).lowerWins++; }
            if (lRunner) { addBonus(lRunner, 3, "하위 준우승"); ensurePlayerObj(playersMap, lRunner, snapshotGrades).lowerRunners++; }
        }

        dayPointsMap.forEach((val, nm) => {
            const pObj = ensurePlayerObj(playersMap, nm, snapshotGrades);
            pObj.attendCount++;
            pObj.totalPoints += val.pts;
            const ds = dayStats.get(nm) || { win: 0, lose: 0 };
            pObj.tourneyHistory.push({
                date,
                title,
                points: val.pts,
                cumulativePoints: pObj.totalPoints,
                detail: val.details.join(", "),
                dayWin: ds.win,
                dayLose: ds.lose
            });
        });
    });

    return {
        tourneyCount: sortedSnaps.length,
        totalMatches: allMatches.length,
        playersMap,
        summaryList,
        allMatches
    };
}

// 오프라인 및 캐시 없을 때의 폴백
function buildAnalyticsFromMockData(mock) {
    const playersMap = new Map();
    const summary = mock.summary || [];
    const matches = mock.matches || [];

    matches.forEach(m => {
        const sParts = String(m.score || "2-0").split("-");
        const s1 = parseInt(sParts[0], 10) || 0;
        const s2 = parseInt(sParts[1], 10) || 0;
        const p1 = m.p1, p2 = m.p2;
        const p1Win = (m.winner === p1);

        const o1 = ensurePlayerObj(playersMap, p1);
        const o2 = ensurePlayerObj(playersMap, p2);
        o1.matchesPlayed++; o2.matchesPlayed++;
        if (p1Win) { o1.matchesWon++; o2.matchesLost++; }
        else { o2.matchesWon++; o1.matchesLost++; }
        o1.setsFor += s1; o1.setsAgainst += s2;
        o2.setsFor += s2; o2.setsAgainst += s1;

        const opp12 = ensureOpponentObj(o1, p2);
        opp12.played++; opp12.coAttend++;
        if (p1Win) opp12.win++; else opp12.lose++;
        opp12.setsFor += s1; opp12.setsAgainst += s2;
        opp12.matches.push({ date: m.date, title: "기록", stage: "경기", myScore: s1, opScore: s2, isWin: p1Win });

        const opp21 = ensureOpponentObj(o2, p1);
        opp21.played++; opp21.coAttend++;
        if (!p1Win) opp21.win++; else opp21.lose++;
        opp21.setsFor += s2; opp21.setsAgainst += s1;
        opp21.matches.push({ date: m.date, title: "기록", stage: "경기", myScore: s2, opScore: s1, isWin: !p1Win });
    });

    playersMap.forEach(p => {
        p.attendCount = Math.max(1, Math.round(p.matchesPlayed / 4));
        p.totalPoints = p.attendCount * 2 + p.upperWins * 5;
    });

    return {
        tourneyCount: summary.length,
        totalMatches: matches.length,
        playersMap,
        summaryList: summary,
        allMatches: matches
    };
}

/* =========================================
   5. Render Dashboard Views
   ========================================= */
function renderAllDashboardViews() {
    if (!dashAnalytics) return;

    const { tourneyCount, totalMatches, playersMap } = dashAnalytics;

    // 1. 상단 KPI
    document.getElementById("stat-total-tourneys").innerHTML = `${tourneyCount}<span class="dx-unit">회</span>`;
    document.getElementById("stat-total-matches").innerHTML = `${totalMatches}<span class="dx-unit">경기</span>`;
    document.getElementById("stat-total-players").innerHTML = `${playersMap.size}<span class="dx-unit">명</span>`;
    ["stat-total-tourneys", "stat-total-matches", "stat-total-players"].forEach(id => {
        document.getElementById(id)?.classList.remove("is-empty");
    });

    // 2. 종합 랭킹 차트 4종
    const winCounts = {};
    const attendCounts = {};
    const winLowerCounts = {};
    const runnerLowerCounts = {};

    playersMap.forEach((p, name) => {
        if (p.upperWins > 0) winCounts[name] = p.upperWins;
        if (p.attendCount > 0) attendCounts[name] = p.attendCount;
        if (p.lowerWins > 0) winLowerCounts[name] = p.lowerWins;
        if (p.lowerRunners > 0) runnerLowerCounts[name] = p.lowerRunners;
    });

    renderRankingBarChart("chart-wins", winCounts, "상위/전체 우승 횟수", DX.accent);
    renderRankingBarChart("chart-attendance", attendCounts, "출석 횟수", DX.accent);
    renderRankingBarChart("chart-wins-lower", winLowerCounts, "하위부 우승 횟수", DX.accent);
    renderRankingBarChart("chart-runners-lower", runnerLowerCounts, "하위부 준우승 횟수", DX.accent);

    // 3. 1:1 H2H 셀렉트 초기화
    initH2HSearch(Array.from(playersMap.keys()).sort((a, b) => a.localeCompare(b, "ko")));

    // 4. 선수별 상세 분석 리스트 렌더링
    filterPlayerAnalyticsList();

    // 기본 선택 선수(없으면 누적 점수 1위 선수 자동 선택)
    if (!selectedPlayerName || !playersMap.has(selectedPlayerName)) {
        const topPlayer = Array.from(playersMap.values()).sort((a, b) => b.totalPoints - a.totalPoints)[0];
        if (topPlayer) selectedPlayerName = topPlayer.name;
    }
    if (selectedPlayerName) {
        selectPlayerForAnalytics(selectedPlayerName);
    }
}

function renderRankingBarChart(canvasId, dataMap, label, colors) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const sorted = Object.entries(dataMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const labels = sorted.map(x => x[0]);
    const values = sorted.map(x => x[1]);
    const bgColors = Array.isArray(colors) ? labels.map((_, i) => colors[i] || "#60a5fa") : colors;

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label,
                data: values,
                backgroundColor: bgColors,
                borderRadius: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            },
            onClick: (_, elements) => {
                if (elements && elements.length > 0) {
                    const idx = elements[0].index;
                    const clickedName = labels[idx];
                    if (clickedName) selectPlayerForAnalytics(clickedName);
                }
            }
        }
    });
}

/* =========================================
   6. Player Analytics List & Search
   ========================================= */
function setPlayerAnalyticsSort(sortMode) {
    currentPaSort = sortMode;
    document.querySelectorAll(".dx-seg-btn[data-sort]").forEach(btn => {
        const on = btn.dataset.sort === sortMode;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    filterPlayerAnalyticsList();
}

function renderStyledGradeBadge(grade, isLarge = false) {
    if (!grade) return "";
    const gStr = String(grade).includes("부") || String(grade).includes("희망") ? String(grade) : `${grade}부`;
    return `<span class="dx-grade${isLarge ? " is-lg" : ""}">${dxEsc(gStr)}</span>`;
}

function filterPlayerAnalyticsList() {
    if (!dashAnalytics) return;
    const listEl = document.getElementById("pa-player-list");
    if (!listEl) return;

    const query = (document.getElementById("pa-search-input")?.value || "").trim().toLowerCase();
    const players = Array.from(dashAnalytics.playersMap.values()).filter(p => {
        if (!query) return true;
        const gradeStr = p.grade ? `${p.grade}부` : "";
        return p.name.toLowerCase().includes(query) || gradeStr.includes(query);
    });

    players.sort((a, b) => {
        const wrA = a.matchesPlayed > 0 ? (a.matchesWon / a.matchesPlayed) : 0;
        const wrB = b.matchesPlayed > 0 ? (b.matchesWon / b.matchesPlayed) : 0;
        if (currentPaSort === "points") return (b.totalPoints - a.totalPoints) || (wrB - wrA) || a.name.localeCompare(b.name, "ko");
        if (currentPaSort === "winrate") return (wrB - wrA) || (b.matchesWon - a.matchesWon) || a.name.localeCompare(b.name, "ko");
        if (currentPaSort === "attend") return (b.attendCount - a.attendCount) || (b.totalPoints - a.totalPoints) || a.name.localeCompare(b.name, "ko");
        return a.name.localeCompare(b.name, "ko");
    });

    listEl.innerHTML = "";
    if (players.length === 0) {
        listEl.innerHTML = `<div class="dx-empty">검색 결과가 없습니다.</div>`;
        return;
    }

    players.forEach((p, idx) => {
        const winRate = p.matchesPlayed > 0 ? ((p.matchesWon / p.matchesPlayed) * 100).toFixed(1) : "0.0";
        const isSelected = (p.name === selectedPlayerName);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "dx-prow" + (idx < 3 ? " is-top3" : "") + (isSelected ? " is-selected" : "");
        row.dataset.playerName = p.name;
        row.setAttribute("aria-pressed", isSelected ? "true" : "false");
        row.innerHTML = `
            <span class="dx-rk">${idx + 1}</span>
            <span class="dx-pname"><span class="dx-pname-text">${dxEsc(p.name)}</span>${renderStyledGradeBadge(p.grade, false)}</span>
            <span class="dx-num dx-pts">${p.totalPoints}점</span>
            <span class="dx-num dx-sub">${p.attendCount}회</span>
            <span class="dx-num"><span class="dx-wrpill ${Number(winRate) >= 50 ? "is-good" : "is-low"}">${winRate}%</span></span>
        `;
        row.addEventListener("click", () => {
            selectPlayerForAnalytics(p.name);
            // 모바일에서 선수 선택 시 편의를 위해 목록을 자동으로 접음
            if (window.innerWidth <= 768) {
                const c = document.getElementById("pa-player-list-container");
                const t = document.getElementById("pa-list-toggle-text");
                const tb = document.getElementById("pa-list-toggle-btn");
                if (c && t) { c.style.display = "none"; t.textContent = "선수 목록 펼치기"; }
                if (tb) tb.setAttribute("aria-expanded", "false");
            }
        });
        listEl.appendChild(row);
    });

    // 모바일 상위 선수 퀵 칩 (상위 6명)
    const quickChipsEl = document.getElementById("mobile-quick-player-chips");
    if (quickChipsEl) {
        quickChipsEl.innerHTML = players.slice(0, 6).map((tp, tidx) => {
            const isSel = (tp.name === selectedPlayerName);
            return `<button type="button" class="quick-pchip ${isSel ? "active" : ""}" data-name="${dxEsc(tp.name)}">
                <span>${tidx + 1}</span>
                <span>${dxEsc(tp.name)}</span>
                <span style="font-size:11px; opacity:0.85;">${tp.totalPoints}점</span>
            </button>`;
        }).join("");
        quickChipsEl.querySelectorAll(".quick-pchip").forEach(chip => {
            chip.addEventListener("click", () => selectPlayerForAnalytics(chip.dataset.name));
        });
    }
}

function selectPlayerForAnalytics(name) {
    if (!dashAnalytics || !dashAnalytics.playersMap.has(name)) return;
    selectedPlayerName = name;

    // 목록·퀵 칩 선택 표시 갱신
    document.querySelectorAll("#pa-player-list .dx-prow").forEach(el => {
        const isMe = (el.dataset.playerName === name);
        el.classList.toggle("is-selected", isMe);
        el.setAttribute("aria-pressed", isMe ? "true" : "false");
    });
    document.querySelectorAll("#mobile-quick-player-chips .quick-pchip").forEach(chip => {
        chip.classList.toggle("active", chip.dataset.name === name);
    });

    const p = dashAnalytics.playersMap.get(name);
    renderSelectedPlayerProfile(p);
    renderSelectedPlayerScoreChart(p);
    renderSelectedPlayerOpponentChart(p);

    const detailBox = document.getElementById("pa-opp-match-detail");
    if (detailBox) detailBox.style.display = "none";
    renderSelectedPlayerOpponentTable();
}

/* =========================================
   7. Selected Player Profile & Charts
   ========================================= */
function renderSelectedPlayerProfile(p) {
    const headerEl = document.getElementById("pa-profile-header");
    if (!headerEl) return;

    const totalTourneys = dashAnalytics.tourneyCount || 1;
    const attendRate = ((p.attendCount / totalTourneys) * 100).toFixed(1);
    const avgPts = p.attendCount > 0 ? (p.totalPoints / p.attendCount).toFixed(1) : "0.0";
    const winRate = p.matchesPlayed > 0 ? ((p.matchesWon / p.matchesPlayed) * 100).toFixed(1) : "0.0";
    const setDiff = p.setsFor - p.setsAgainst;
    const setTotal = p.setsFor + p.setsAgainst;
    const setRatio = setTotal > 0 ? ((p.setsFor / setTotal) * 100).toFixed(1) : "0.0";

    // 주요 라이벌 / 최다 동반 출전 / 최고 승률 상대 추출
    const opps = Array.from(p.opponents.values());
    const mostPlayedOpp = [...opps].filter(o => o.played > 0).sort((a, b) => b.played - a.played)[0];
    const mostCoAttendOpp = [...opps].filter(o => o.coAttend > 0).sort((a, b) => b.coAttend - a.coAttend)[0];
    const bestWinOpp = [...opps].filter(o => o.played >= 2).sort((a, b) => (b.win / b.played) - (a.win / a.played) || (b.win - a.win))[0];
    const toughOpp = [...opps].filter(o => o.played >= 2).sort((a, b) => (a.win / a.played) - (b.win / b.played) || (b.lose - a.lose))[0];

    const awards = [];
    if (p.upperWins > 0) awards.push(`<span class="dx-award is-main">상위/전체 우승 <b>${p.upperWins}회</b></span>`);
    if (p.upperRunners > 0) awards.push(`<span class="dx-award">상위 준우승 <b>${p.upperRunners}회</b></span>`);
    if (p.upperSemis > 0) awards.push(`<span class="dx-award">상위 4강 <b>${p.upperSemis}회</b></span>`);
    if (p.lowerWins > 0) awards.push(`<span class="dx-award is-main">하위 우승 <b>${p.lowerWins}회</b></span>`);
    if (p.lowerRunners > 0) awards.push(`<span class="dx-award">하위 준우승 <b>${p.lowerRunners}회</b></span>`);

    const oppText = (o, extra) => o ? `${dxEsc(o.name)} (${extra})` : "-";

    headerEl.innerHTML = `
        <div class="dx-pf-top">
            <div>
                <div class="dx-pf-name">
                    <h4>${dxEsc(p.name)}</h4>
                    ${renderStyledGradeBadge(p.grade, true)}
                </div>
                <div class="dx-pf-meta">
                    정규 금요리그 출석 <b>${p.attendCount}회</b> / ${totalTourneys}회 (출석률 <b>${attendRate}%</b>)
                </div>
            </div>
            <div class="dx-awards">
                ${awards.length > 0 ? awards.join("") : `<span class="dx-award is-none">입상 기록 없음</span>`}
            </div>
        </div>

        <div class="dx-metrics">
            <div class="dx-metric">
                <div class="dx-metric-label">통산 누적 승점</div>
                <div class="dx-metric-val">${p.totalPoints}점</div>
                <div class="dx-metric-note">출석 대회당 평균 <b>${avgPts}점</b></div>
            </div>
            <div class="dx-metric">
                <div class="dx-metric-label">통산 매치 승률</div>
                <div class="dx-metric-val">${winRate}%</div>
                <div class="dx-metric-note">총 ${p.matchesPlayed}경기 중 <b>${p.matchesWon}승 ${p.matchesLost}패</b><br>예선 ${p.groupWon}승 · 본선 ${p.bracketWon}승</div>
            </div>
            <div class="dx-metric">
                <div class="dx-metric-label">통산 세트 득실</div>
                <div class="dx-metric-val ${setDiff >= 0 ? "is-pos" : "is-neg"}">${setDiff >= 0 ? "+" : ""}${setDiff}</div>
                <div class="dx-metric-note">${p.setsFor}득 / ${p.setsAgainst}실 (득실률 <b>${setRatio}%</b>)</div>
            </div>
        </div>

        <dl class="dx-facts">
            <div class="dx-fact"><dt>최다 대결 상대</dt><dd>${oppText(mostPlayedOpp, mostPlayedOpp ? `${mostPlayedOpp.played}전 ${mostPlayedOpp.win}승 ${mostPlayedOpp.lose}패` : "")}</dd></div>
            <div class="dx-fact"><dt>최다 동반 대회</dt><dd>${oppText(mostCoAttendOpp, mostCoAttendOpp ? `${mostCoAttendOpp.coAttend}회` : "")}</dd></div>
            <div class="dx-fact"><dt>강세 상대 (2전 이상 중 승률 최고)</dt><dd class="is-win">${oppText(bestWinOpp, bestWinOpp ? `${Math.round(bestWinOpp.win / bestWinOpp.played * 100)}%` : "")}</dd></div>
            <div class="dx-fact"><dt>열세 상대 (2전 이상 중 승률 최저)</dt><dd class="is-lose">${oppText(toughOpp, toughOpp ? `${Math.round(toughOpp.win / toughOpp.played * 100)}%` : "")}</dd></div>
        </dl>
    `;
}

function changeScoreChartType(ctype) {
    selectedScoreChartType = ctype;
    document.querySelectorAll("#pa-score-chart-types .dx-seg-btn").forEach(btn => {
        const on = btn.dataset.ctype === ctype;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (selectedPlayerName && dashAnalytics?.playersMap.has(selectedPlayerName)) {
        renderSelectedPlayerScoreChart(dashAnalytics.playersMap.get(selectedPlayerName));
    }
}

function changeOppChartType(octype) {
    selectedOppChartType = octype;
    document.querySelectorAll("#pa-opp-chart-types .dx-seg-btn").forEach(btn => {
        const on = btn.dataset.octype === octype;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (selectedPlayerName && dashAnalytics?.playersMap.has(selectedPlayerName)) {
        renderSelectedPlayerOpponentChart(dashAnalytics.playersMap.get(selectedPlayerName));
    }
}

function renderSelectedPlayerScoreChart(p) {
    const canvasId = "chart-player-scores";
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    const hist = p.tourneyHistory || [];
    const labels = hist.map(h => h.date.slice(5)); // MM-DD
    const ptsData = hist.map(h => h.points);
    const cumData = hist.map(h => h.cumulativePoints);
    const dayWins = hist.map(h => h.dayWin);

    if (selectedScoreChartType === "radar") {
        const totalTourneys = dashAnalytics.tourneyCount || 1;
        const attendScore = Math.min(100, Math.round((p.attendCount / totalTourneys) * 100));
        const matchWinScore = p.matchesPlayed > 0 ? Math.round((p.matchesWon / p.matchesPlayed) * 100) : 0;
        const setTotal = p.setsFor + p.setsAgainst;
        const setScore = setTotal > 0 ? Math.round((p.setsFor / setTotal) * 100) : 0;
        const bracketScore = p.bracketPlayed > 0 ? Math.round((p.bracketWon / p.bracketPlayed) * 100) : 0;
        const avgPtsScore = p.attendCount > 0 ? Math.min(100, Math.round(((p.totalPoints / p.attendCount) / 7) * 100)) : 0;
        const podiumCount = p.upperWins + p.upperRunners + p.upperSemis + p.lowerWins + p.lowerRunners;
        const podiumScore = p.attendCount > 0 ? Math.min(100, Math.round((podiumCount / p.attendCount) * 100)) : 0;

        chartInstances[canvasId] = new Chart(ctx, {
            type: "radar",
            data: {
                labels: ["출석 성실도", "통산 매치승률", "세트 득실률", "본선 토너먼트 승률", "입상 비율", "대회당 득점력"],
                datasets: [{
                    label: `${p.name} 능력치 지수 (100점 만점 환산)`,
                    data: [attendScore, matchWinScore, setScore, bracketScore, podiumScore, avgPtsScore],
                    backgroundColor: "rgba(30, 64, 175, 0.14)",
                    borderColor: DX.accent,
                    pointBackgroundColor: DX.accent,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 20 }
                    }
                }
            }
        });
        return;
    }

    if (selectedScoreChartType === "line") {
        chartInstances[canvasId] = new Chart(ctx, {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "누적 승점 (점)",
                        data: cumData,
                        borderColor: DX.accent,
                        backgroundColor: "rgba(30, 64, 175, 0.08)",
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4
                    },
                    {
                        label: "대회별 획득 점수 (점)",
                        data: ptsData,
                        borderColor: "#60a5fa",
                        backgroundColor: "#60a5fa",
                        fill: false,
                        tension: 0.2,
                        pointRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0]?.dataIndex;
                                const h = hist[idx];
                                return h ? `상세: ${h.detail} (당일 ${h.dayWin}승 ${h.dayLose}패)` : "";
                            }
                        }
                    }
                }
            }
        });
        return;
    }

    if (selectedScoreChartType === "bar") {
        chartInstances[canvasId] = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "획득 점수 (점)",
                        data: ptsData,
                        backgroundColor: DX.accentSoft,
                        borderRadius: 4
                    },
                    {
                        label: "당일 승리 수 (승)",
                        data: dayWins,
                        backgroundColor: DX.win,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0]?.dataIndex;
                                const h = hist[idx];
                                return h ? `내역: ${h.detail}` : "";
                            }
                        }
                    }
                }
            }
        });
        return;
    }

    // 기본값: combo (막대 + 누적 꺾은선 복합 차트)
    chartInstances[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    type: "line",
                    label: "누적 승점",
                    data: cumData,
                    borderColor: DX.accent,
                    backgroundColor: "rgba(30, 64, 175, 0.08)",
                    borderWidth: 2.5,
                    pointRadius: 3,
                    tension: 0.25,
                    yAxisID: "y1"
                },
                {
                    type: "bar",
                    label: "대회별 획득 점수",
                    data: ptsData,
                    backgroundColor: DX.accentSoft,
                    borderRadius: 4,
                    yAxisID: "y"
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0]?.dataIndex;
                            const h = hist[idx];
                            return h ? `내역: ${h.detail}\n당일 전적: ${h.dayWin}승 ${h.dayLose}패` : "";
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: "linear",
                    position: "left",
                    beginAtZero: true,
                    max: 9,
                    title: { display: true, text: "대회 획득 점수" }
                },
                y1: {
                    type: "linear",
                    position: "right",
                    beginAtZero: true,
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "누적 승점" }
                }
            }
        }
    });
}

function renderSelectedPlayerOpponentChart(p) {
    const canvasId = "chart-player-opponents";
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    // 맞대결 횟수 상위 12명 추출
    const topOpps = Array.from(p.opponents.values())
        .filter(o => o.played > 0)
        .sort((a, b) => (b.played - a.played) || (b.coAttend - a.coAttend))
        .slice(0, 12);

    const labels = topOpps.map(o => o.name);
    const wins = topOpps.map(o => o.win);
    const losses = topOpps.map(o => o.lose);
    const playedArr = topOpps.map(o => o.played);
    const winRates = topOpps.map(o => Math.round((o.win / o.played) * 100));

    const palette = DX.palette;

    const onClickOpponent = (_, elements) => {
        if (elements && elements.length > 0) {
            const idx = elements[0].index;
            const oppName = topOpps[idx]?.name;
            if (oppName) showOpponentMatchDetail(p.name, oppName);
        }
    };

    if (selectedOppChartType === "winRateBar") {
        chartInstances[canvasId] = new Chart(ctx, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: "상대 승률 (%)",
                    data: winRates,
                    backgroundColor: winRates.map(wr => wr >= 50 ? DX.win : DX.lose),
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 12 } } },
                    y: { beginAtZero: true, max: 100, title: { display: true, text: "승률 (%)" } }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            afterLabel: (item) => {
                                const o = topOpps[item.dataIndex];
                                return o ? `전적: ${o.played}전 ${o.win}승 ${o.lose}패 (동반대회 ${o.coAttend}회)` : "";
                            }
                        }
                    }
                },
                onClick: onClickOpponent
            }
        });
        return;
    }

    if (selectedOppChartType === "doughnut" || selectedOppChartType === "polarArea") {
        chartInstances[canvasId] = new Chart(ctx, {
            type: selectedOppChartType,
            data: {
                labels: topOpps.map(o => `${o.name} (${o.played}전)`),
                datasets: [{
                    label: "맞대결 횟수",
                    data: playedArr,
                    backgroundColor: palette
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: window.innerWidth <= 768 ? "bottom" : "right", labels: { boxWidth: 10, font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            afterLabel: (item) => {
                                const o = topOpps[item.dataIndex];
                                const wr = o ? Math.round((o.win / o.played) * 100) : 0;
                                return o ? `승패: ${o.win}승 ${o.lose}패 (승률 ${wr}%) · 동반출전 ${o.coAttend}회` : "";
                            }
                        }
                    }
                },
                onClick: onClickOpponent
            }
        });
        return;
    }

    if (selectedOppChartType === "bubble") {
        chartInstances[canvasId] = new Chart(ctx, {
            type: "bubble",
            data: {
                datasets: topOpps.map((o, i) => ({
                    label: o.name,
                    data: [{
                        x: o.played,
                        y: Math.round((o.win / o.played) * 100),
                        r: Math.max(6, Math.min(22, o.coAttend * 1.5 + 4))
                    }],
                    backgroundColor: palette[i % palette.length] + "cc",
                    borderColor: palette[i % palette.length]
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: "맞대결 경기 수 (전)" }, beginAtZero: true, ticks: { precision: 0 } },
                    y: { title: { display: true, text: "상대 승률 (%)" }, min: 0, max: 105 }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctxItem) => {
                                const o = topOpps[ctxItem.datasetIndex];
                                if (!o) return "";
                                const wr = Math.round((o.win / o.played) * 100);
                                return `${o.name}: ${o.played}전 ${o.win}승 ${o.lose}패 (승률 ${wr}%, 동반대회 ${o.coAttend}회)`;
                            }
                        }
                    }
                }
            }
        });
        return;
    }

    // 기본값: stackedBar (가로 승/패 비교 막대)
    chartInstances[canvasId] = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "승리 (승)",
                    data: wins,
                    backgroundColor: DX.win,
                    borderRadius: 4
                },
                {
                    label: "패배 (패)",
                    data: losses,
                    backgroundColor: DX.lose,
                    borderRadius: 4
                }
            ]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "맞대결 경기 수" } },
                y: {
                    stacked: true,
                    ticks: {
                        autoSkip: false,
                        font: { size: 12 },
                        color: DX.ink
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0]?.dataIndex;
                            const o = topOpps[idx];
                            if (!o) return "";
                            const wr = Math.round((o.win / o.played) * 100);
                            return `상대 승률: ${wr}% (${o.played}전 ${o.win}승 ${o.lose}패)\n함께 참가한 대회: ${o.coAttend}회 (같은 조 ${o.sameGroup}회)`;
                        }
                    }
                }
            },
            onClick: onClickOpponent
        }
    });
}

/* =========================================
   8. Opponent Table & Match History Detail
   ========================================= */
function renderSelectedPlayerOpponentTable() {
    if (!dashAnalytics || !selectedPlayerName) return;
    const p = dashAnalytics.playersMap.get(selectedPlayerName);
    if (!p) return;

    const tbody = document.getElementById("pa-opp-tbody");
    if (!tbody) return;
    const mobileCardsEl = document.getElementById("pa-opp-cards-mobile");

    const filterTxt = (document.getElementById("pa-opp-search")?.value || "").trim().toLowerCase();
    const opps = Array.from(p.opponents.values()).filter(o => {
        if (o.played === 0 && o.coAttend === 0) return false;
        if (!filterTxt) return true;
        return o.name.toLowerCase().includes(filterTxt);
    });

    // 맞대결 많은 순 -> 동반출전 많은 순
    opps.sort((a, b) => (b.played - a.played) || (b.coAttend - a.coAttend) || a.name.localeCompare(b.name, "ko"));

    tbody.innerHTML = "";
    if (opps.length === 0) {
        const emptyMsg = filterTxt ? "조건에 맞는 상대 기록이 없습니다." : "표시할 상대 기록이 없습니다.";
        tbody.innerHTML = `<tr><td colspan="6" class="is-msg">${emptyMsg}</td></tr>`;
        if (mobileCardsEl) mobileCardsEl.innerHTML = `<div class="dx-empty">${emptyMsg}</div>`;
        return;
    }

    const diffClass = (d) => d > 0 ? "dx-pos" : (d < 0 ? "dx-neg" : "dx-zero");
    const diffText = (d) => `${d > 0 ? "+" : ""}${d}`;

    opps.forEach(o => {
        const oppGrade = dashAnalytics.playersMap.get(o.name)?.grade;
        const gradeBadge = oppGrade ? renderStyledGradeBadge(oppGrade) : "";
        const wr = o.played > 0 ? Math.round((o.win / o.played) * 100) : null;
        const sDiff = o.setsFor - o.setsAgainst;

        const tr = document.createElement("tr");
        tr.tabIndex = 0;
        tr.title = `${o.name} 맞대결 기록 보기`;

        const wrHtml = (wr !== null)
            ? `<span class="dx-wr"><span class="dx-wr-track"><span class="dx-wr-fill ${wr < 50 ? "is-low" : ""}" style="width:${wr}%; display:block;"></span></span><span class="dx-wr-num">${wr}%</span></span>`
            : `<span class="dx-zero">대결 없음</span>`;

        tr.innerHTML = `
            <td><span class="dx-oname">${dxEsc(o.name)}${gradeBadge}</span></td>
            <td><b>${o.coAttend}회</b> <span class="dx-zero">(같은 조 ${o.sameGroup}회)</span></td>
            <td>${o.played}전</td>
            <td><span class="dx-w">${o.win}승</span> <span class="dx-zero">-</span> <span class="dx-l">${o.lose}패</span></td>
            <td>${o.played > 0 ? `<span class="${diffClass(sDiff)}">${diffText(sDiff)}</span> <span class="dx-zero">(${o.setsFor}/${o.setsAgainst})</span>` : `<span class="dx-zero">-</span>`}</td>
            <td>${wrHtml}</td>
        `;
        tr.addEventListener("click", () => showOpponentMatchDetail(p.name, o.name));
        tr.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showOpponentMatchDetail(p.name, o.name);
            }
        });
        tbody.appendChild(tr);
    });

    // 모바일 전용 카드형 렌더링
    if (mobileCardsEl) {
        const myName = p.name;
        mobileCardsEl.innerHTML = opps.map(o => {
            const oppGrade = dashAnalytics.playersMap.get(o.name)?.grade;
            const gradeBadge = oppGrade ? renderStyledGradeBadge(oppGrade) : "";
            const wr = o.played > 0 ? Math.round((o.win / o.played) * 100) : null;
            const sDiff = o.setsFor - o.setsAgainst;
            return `
                <button type="button" class="opp-card-item" data-opp="${dxEsc(o.name)}">
                    <span class="dx-oc-top">
                        <span class="dx-oname">${dxEsc(o.name)}${gradeBadge}</span>
                        <span class="dx-oc-rec">
                            <span class="dx-w">${o.win}승</span><span class="dx-zero">-</span><span class="dx-l">${o.lose}패</span>
                            <span class="dx-wr-num">${wr !== null ? `${wr}%` : "대결 없음"}</span>
                        </span>
                    </span>
                    <span class="dx-oc-bot">
                        <span>함께 참가 ${o.coAttend}회 (같은 조 ${o.sameGroup}회)</span>
                        <span>세트 득실 <b class="${diffClass(sDiff)}">${diffText(sDiff)}</b></span>
                    </span>
                </button>
            `;
        }).join("");
        mobileCardsEl.onclick = (e) => {
            const card = e.target.closest(".opp-card-item");
            if (card) showOpponentMatchDetail(myName, card.dataset.opp);
        };
    }
}

function showOpponentMatchDetail(myName, oppName) {
    if (!dashAnalytics) return;
    const p = dashAnalytics.playersMap.get(myName);
    const o = p?.opponents.get(oppName);
    const box = document.getElementById("pa-opp-match-detail");
    if (!box || !o) return;

    const wr = o.played > 0 ? ((o.win / o.played) * 100).toFixed(1) : "0.0";
    const matches = [...o.matches].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    let rowsHtml = "";
    if (matches.length === 0) {
        rowsHtml = `<div class="dx-detail-sum" style="margin-top:8px;">같은 대회에 ${o.coAttend}회 함께 참가했으나 직접 맞대결한 기록은 없습니다.</div>`;
    } else {
        rowsHtml = `<div class="dx-mgrid">` +
            matches.map(m => `
                <div class="dx-mrow">
                    <span class="dx-mdate">${dxEsc(m.date)}${m.stage ? ` <small>(${dxEsc(m.stage)})</small>` : ""}</span>
                    <span class="dx-mres ${m.isWin ? "is-win" : "is-lose"}">${m.isWin ? "승" : "패"} (${m.myScore}:${m.opScore})</span>
                </div>
            `).join("") +
            `</div>`;
    }

    box.style.display = "block";
    box.innerHTML = `
        <div class="dx-detail-hd">
            <div>
                <div class="dx-detail-title">${dxEsc(myName)} vs ${dxEsc(oppName)} 맞대결 기록</div>
                <div class="dx-detail-sum">총 ${o.played}전 ${o.win}승 ${o.lose}패 · 승률 ${wr}% · 함께 참가 ${o.coAttend}회</div>
            </div>
            <button type="button" class="dx-btn" id="pa-opp-detail-close">닫기</button>
        </div>
        ${rowsHtml}
    `;
    document.getElementById("pa-opp-detail-close")?.addEventListener("click", () => {
        box.style.display = "none";
    });
    box.scrollIntoView({ block: "nearest" });
}

/* =========================================
   9. 1:1 Direct Head-to-Head Box
   ========================================= */
function initH2HSearch(players) {
    const s1 = document.getElementById("h2h-p1");
    const s2 = document.getElementById("h2h-p2");
    const btn = document.getElementById("btn-h2h-search");
    if (!s1 || !s2 || !btn) return;

    const prev1 = s1.value;
    const prev2 = s2.value;
    s1.innerHTML = `<option value="">선수 1</option>`;
    s2.innerHTML = `<option value="">선수 2</option>`;

    players.forEach(p => {
        s1.add(new Option(p, p));
        s2.add(new Option(p, p));
    });

    if (prev1 && players.includes(prev1)) s1.value = prev1;
    if (prev2 && players.includes(prev2)) s2.value = prev2;

    btn.onclick = () => {
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
    };
}

function showH2HResult(p1, p2) {
    if (!dashAnalytics) return;
    const matches = dashAnalytics.allMatches.filter(m =>
        (m.p1 === p1 && m.p2 === p2) || (m.p1 === p2 && m.p2 === p1)
    );

    const resultEl = document.getElementById("h2h-result");
    const listEl = document.getElementById("h2h-list");
    const coAttend = dashAnalytics.playersMap.get(p1)?.opponents.get(p2)?.coAttend || 0;

    if (matches.length === 0) {
        resultEl.innerHTML = `<div class="no-data">두 선수 간의 맞대결 기록이 없습니다. (동반 대회 참가: ${coAttend}회)</div>`;
        listEl.innerHTML = "";
        return;
    }

    let win1 = 0;
    let win2 = 0;
    const sorted = [...matches].sort((a, b) => String(b.date).localeCompare(String(a.date)));

    let html = "";
    sorted.forEach(m => {
        const isP1Winner = (m.winner === p1);
        if (isP1Winner) win1++; else win2++;

        const parts = String(m.score).split("-");
        const p1Score = (m.p1 === p1) ? parts[0] : parts[1];
        const p2Score = (m.p1 === p1) ? parts[1] : parts[0];

        html += `
            <div class="match-row">
                <span class="m-date">${m.date} <small style="color:#94a3b8;">(${m.stage || "경기"})</small></span>
                <span class="m-res ${isP1Winner ? 'win' : 'lose'}">${isP1Winner ? p1 + ' 승' : p2 + ' 승'}</span>
                <span class="m-score">${p1Score} : ${p2Score}</span>
            </div>
        `;
    });

    const wr1 = Math.round((win1 / matches.length) * 100);
    resultEl.innerHTML = `
        <div class="h2h-summary">
            <div class="player">
                <span class="name">${p1}</span>
                <span class="score">${win1}승 (${wr1}%)</span>
            </div>
            <div class="vs">VS</div>
            <div class="player">
                <span class="score">${win2}승 (${100 - wr1}%)</span>
                <span class="name">${p2}</span>
            </div>
        </div>
        <div class="h2h-total">총 ${matches.length}전 · 함께 참가한 대회 ${coAttend}회</div>
    `;
    listEl.innerHTML = html;
}


// 📱 모바일 선수 목록 접기/펼치기 토글
function toggleMobilePlayerList() {
    const box = document.getElementById("pa-player-list-container");
    const txt = document.getElementById("pa-list-toggle-text");
    const btn = document.getElementById("pa-list-toggle-btn");
    if (!box || !txt) return;
    const isCollapsed = box.style.display === "none";
    if (isCollapsed) {
        box.style.display = "flex";
        txt.textContent = "선수 목록 접기";
    } else {
        box.style.display = "none";
        txt.textContent = "선수 목록 펼치기";
    }
    if (btn) btn.setAttribute("aria-expanded", isCollapsed ? "true" : "false");
}
