/**
 * 🏓 대덕밸리 탁구동호회 - Supabase Realtime 실시간 중계 & 통합 DB 엔진 (supabase_live.js)
 *
 * [핵심 기능]
 * 1. 실시간 경기 진행 공유 (0.1초 WebSocket Push + DB 저장 + GAS 클라우드 백업 폴백)
 *    - ✏️ 진행자 모드 (아이패드/운영진): 조 배정, 점수 입력, 본선 토너먼트 진행 시 자동 실시간 송출
 *    - 👀 관전 모드 (일반 회원 스마트폰): 접속 즉시 현재 진행 중인 대진표/점수 표시 & 실시간 자동 갱신 (읽기 전용 보호)
 * 2. 회원 명단 & 부수 웹 DB 관리 (pingpong_players)
 *    - 코드 수정 없이 웹 화면에서 회원 추가/삭제 및 부수(1~7부, 선수부, 희망부) 즉시 변경 & 전 기기 동기화
 * 3. 역대 대회 기록실(pingpong_tournaments) & 종합 통계(pingpong_stats_cache) 초고속 DB 연동 + 구글 시트 이중 백업
 */

(function () {
    const DEFAULT_SB_URL = "https://lkltfigaylemgsehkkdg.supabase.co";
    const DEFAULT_SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrbHRmaWdheWxlbWdzZWhra2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgwMDM2NzksImV4cCI6MjA3MzU3OTY3OX0.75jPhekoPJfsoeaTPSApbGVhq75ObzdYvYAXT_CBUak";

    const SB_URL = localStorage.getItem("pingpong_sb_url") || DEFAULT_SB_URL;
    const SB_KEY = localStorage.getItem("pingpong_sb_key") || DEFAULT_SB_KEY;

    let sbClient = null;
    let sbChannel = null;
    let sbAvailable = false;
    let localBroadcast = null;

    // 🔐 관리자(진행자) PIN 비밀번호: 1111
    const ADMIN_PIN = "1111";

    // 역할 모드: 'host' (진행자 편집/송출) | 'viewer' (실시간 관전 전용)
    // 안전 원칙: 일반 접속은 무조건 안전한 'viewer'(관전자)가 기본값입니다.
    // PIN(1111) 인증이 완료된 진행자 기기(아이패드 등)만 'host'로 동작합니다.
    const urlParams = new URLSearchParams(window.location.search);
    const reqMode = urlParams.get("mode");
    const reqPin = urlParams.get("pin");
    const savedRole = localStorage.getItem("pingpong_live_role");
    const savedPin = localStorage.getItem("pingpong_admin_token");

    let currentRole = "viewer";
    let pendingHostPrompt = false;

    if (reqMode === "host") {
        if (reqPin === ADMIN_PIN || savedPin === ADMIN_PIN) {
            currentRole = "host";
            localStorage.setItem("pingpong_admin_token", ADMIN_PIN);
            localStorage.setItem("pingpong_live_role", "host");
        } else {
            currentRole = "viewer";
            pendingHostPrompt = true;
        }
    } else if (reqMode === "viewer") {
        currentRole = "viewer";
        localStorage.setItem("pingpong_live_role", "viewer");
    } else {
        // 파라미터 없는 일반 접속: 관리자 토큰(1111)이 저장되어 있고 이전 모드가 host인 경우만 host 유지
        if (savedPin === ADMIN_PIN && savedRole === "host") {
            currentRole = "host";
        } else {
            currentRole = "viewer";
        }
    }
    let lastAppliedTimestamp = 0;
    let isApplyingRemoteState = false;
    let pushDebounceTimer = null;
    let pollTimer = null;
    let currentDbModalTab = "active";
    const CLIENT_ID = "client_" + Math.random().toString(36).slice(2, 10);

    // ------------------------------------------------------------------
    // 1. 스타일 & 상단 LIVE 컨트롤 바 + 회원 관리 모달 주입
    // ------------------------------------------------------------------
    function injectLiveUI() {
        const style = document.createElement("style");
        style.textContent = `
            #live-bar-wrap {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 8px;
                flex-wrap: wrap;
            }
            .live-badge-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 12px;
                border-radius: 999px;
                font-size: 12.5px;
                font-weight: 800;
                cursor: pointer;
                transition: all 0.2s ease;
                border: 1.5px solid transparent;
                user-select: none;
            }
            .live-badge-btn.role-host {
                background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
                color: #1d4ed8;
                border-color: #93c5fd;
                box-shadow: 0 2px 8px rgba(37, 99, 235, 0.12);
            }
            .live-badge-btn.role-viewer {
                background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
                color: #047857;
                border-color: #6ee7b7;
                box-shadow: 0 2px 8px rgba(16, 185, 129, 0.15);
            }
            .live-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                display: inline-block;
            }
            .live-dot.pulse-blue {
                background: #2563eb;
                box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.7);
                animation: livePulseBlue 1.8s infinite;
            }
            .live-dot.pulse-green {
                background: #10b981;
                box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
                animation: livePulseGreen 1.8s infinite;
            }
            @keyframes livePulseBlue {
                0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.6); }
                70% { box-shadow: 0 0 0 7px rgba(37, 99, 235, 0); }
                100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
            }
            @keyframes livePulseGreen {
                0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
                70% { box-shadow: 0 0 0 7px rgba(16, 185, 129, 0); }
                100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
            #live-sync-status {
                font-size: 11.5px;
                font-weight: 700;
                color: #64748b;
                padding: 3px 9px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 999px;
            }
            /* 관전 모드 전용 화면 보호 스타일 */
            body.live-viewer-mode #card-settings,
            body.live-viewer-mode #card-pool,
            body.live-viewer-mode #teams-action-footer,
            body.live-viewer-mode #btn-edit-mode,
            body.live-viewer-mode #btn-export-sheet {
                display: none !important;
            }
            #viewer-notice-banner {
                display: none;
                background: linear-gradient(90deg, #065f46 0%, #047857 100%);
                color: #ffffff;
                padding: 10px 18px;
                border-radius: 12px;
                margin-bottom: 14px;
                font-size: 13.5px;
                font-weight: 700;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                box-shadow: 0 4px 12px rgba(4, 120, 87, 0.18);
            }
            body.live-viewer-mode #viewer-notice-banner {
                display: flex;
            }
            #live-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: rgba(15, 23, 42, 0.92);
                color: #fff;
                padding: 10px 20px;
                border-radius: 999px;
                font-size: 13px;
                font-weight: 700;
                z-index: 20000;
                opacity: 0;
                pointer-events: none;
                transition: all 0.25s ease;
                box-shadow: 0 10px 25px rgba(0,0,0,0.25);
            }
            #live-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        `;
        document.head.appendChild(style);

        // 상단 헤더에 LIVE 배지 주입
        const headerH1 = document.querySelector("header h1");
        if (headerH1) {
            const bar = document.createElement("div");
            bar.id = "live-bar-wrap";
            bar.innerHTML = `
                <button type="button" id="btn-live-role" class="live-badge-btn role-host" title="클릭하여 모드를 전환합니다 (진행자 전환 시 비밀번호 1111 필요)">
                    <span class="live-dot pulse-blue" id="live-dot-ind"></span>
                    <span id="live-role-label">✏️ 진행자 모드 (실시간 송출)</span>
                </button>
                <button type="button" class="btn" id="btn-copy-viewer-url" style="padding:4px 10px; font-size:12px; border-radius:999px; background:#eff6ff; color:#1d4ed8; border-color:#bfdbfe; font-weight:700;" title="일반 회원들이 실시간으로 볼 수 있는 관전 전용 링크를 복사하여 카톡에 보냅니다">
                    📢 카톡 관전 링크 복사
                </button>
                <span id="live-sync-status">📡 연결 준비 중...</span>
                <button type="button" class="btn" id="btn-open-db-players" style="padding:4px 10px; font-size:12px; border-radius:999px;" title="회원 추가/삭제 및 부수(1~7부)를 DB에서 직접 수정합니다">
                    👥 회원·부수 관리
                </button>
                <button type="button" class="btn" id="btn-lock-viewer" style="padding:4px 8px; font-size:11.5px; border-radius:999px; background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1;" title="진행자 권한을 잠그고 일반 관전 모드로 전환합니다">
                    🔒 관전자로 잠금
                </button>
            `;
            headerH1.appendChild(bar);

            document.getElementById("btn-live-role").addEventListener("click", toggleLiveRole);
            document.getElementById("btn-copy-viewer-url").addEventListener("click", copyViewerUrlForKakao);
            document.getElementById("btn-open-db-players").addEventListener("click", openPlayerManagerModal);
            document.getElementById("btn-lock-viewer").addEventListener("click", logoutHostMode);
        }

        // 관전 모드 안내 배너 주입
        const tabMatch = document.getElementById("tab-match");
        if (tabMatch) {
            const banner = document.createElement("div");
            banner.id = "viewer-notice-banner";
            banner.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span>🟢 <b>실시간 관전 모드</b> — 진행자(아이패드)가 입력하는 조 편성·예선 점수·토너먼트 결과가 실시간으로 자동 반영됩니다.</span>
                </div>
                <div style="display:flex; gap:6px; shrink:0;">
                    <button type="button" class="btn" id="btn-viewer-refresh" style="padding:5px 10px; font-size:12px; background:rgba(255,255,255,0.18); color:#fff; border-color:rgba(255,255,255,0.35);">🔄 즉시 새로고침</button>
                    <button type="button" class="btn" id="btn-viewer-to-host" style="padding:5px 10px; font-size:12px; background:#ffffff; color:#065f46; border:none;">✏️ 진행자 모드로 전환</button>
                </div>
            `;
            tabMatch.insertBefore(banner, tabMatch.firstChild);
            document.getElementById("btn-viewer-refresh").addEventListener("click", () => fetchLatestLiveState(true));
            document.getElementById("btn-viewer-to-host").addEventListener("click", () => requestHostMode());
        }

        // 토스트 메시지 엘리먼트
        const toast = document.createElement("div");
        toast.id = "live-toast";
        document.body.appendChild(toast);

        // 회원·부수 DB 관리 모달 주입
        const modalWrap = document.createElement("div");
        modalWrap.id = "dbPlayerModalWrap";
        modalWrap.style.cssText = "display:none; position:fixed; inset:0; background:rgba(15,23,42,0.55); backdrop-filter:blur(4px); z-index:15000; align-items:center; justify-content:center; padding:16px;";
        modalWrap.innerHTML = `
            <div style="background:#fff; width:100%; max-width:680px; border-radius:18px; box-shadow:0 20px 50px rgba(0,0,0,0.25); overflow:hidden; display:flex; flex-direction:column; max-height:86vh;">
                <div style="padding:16px 20px; background:linear-gradient(90deg,#eff6ff,#f8fafc); border-bottom:1px solid #e2e8f0; display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <h3 style="margin:0; font-size:17px; color:#0f172a;">👥 회원 명단 & 부수 DB 관리</h3>
                        <small id="db-player-modal-sub" style="color:#64748b; font-weight:600;">부수를 변경하면 즉시 DB에 저장되어 모든 기기에 반영됩니다.</small>
                    </div>
                    <button type="button" class="btn" id="btn-close-db-players" style="padding:5px 12px;">닫기 ✕</button>
                </div>
                <!-- 탭 전환 (활동 회원 vs 쉬는 회원) -->
                <div style="padding:10px 20px 0; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:8px;">
                    <button type="button" id="db-tab-active" class="db-tab-btn active" style="padding:8px 16px; border-radius:10px 10px 0 0; font-size:13px; font-weight:800; border:1px solid #cbd5e1; border-bottom:none; background:#fff; color:#0f172a; cursor:pointer; display:flex; align-items:center; gap:6px;">
                        <span>🟢 활동 회원</span>
                        <span id="db-count-active" style="padding:2px 7px; border-radius:999px; background:#dcfce7; color:#15803d; font-size:11.5px; font-weight:800;">0</span>
                    </button>
                    <button type="button" id="db-tab-inactive" class="db-tab-btn" style="padding:8px 16px; border-radius:10px 10px 0 0; font-size:13px; font-weight:700; border:1px solid transparent; border-bottom:none; background:transparent; color:#64748b; cursor:pointer; display:flex; align-items:center; gap:6px;">
                        <span>⏸️ 쉬는 회원 (출장/휴면)</span>
                        <span id="db-count-inactive" style="padding:2px 7px; border-radius:999px; background:#f1f5f9; color:#64748b; font-size:11.5px; font-weight:800;">0</span>
                    </button>
                </div>

                <div style="padding:12px 20px; background:#ffffff; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                    <input type="text" id="db-new-player-name" placeholder="신규 회원 이름 입력" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-weight:700; font-size:13px; flex:1; min-width:140px;" />
                    <select id="db-new-player-grade" style="padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-weight:800; font-size:13px;">
                        <option value="선수">선수부</option>
                        <option value="1">1부</option>
                        <option value="2">2부</option>
                        <option value="3">3부</option>
                        <option value="4">4부</option>
                        <option value="5" selected>5부</option>
                        <option value="6">6부</option>
                        <option value="7">7부</option>
                        <option value="희망">희망부</option>
                    </select>
                    <button type="button" class="btn primary" id="btn-add-db-player" style="padding:8px 14px; font-size:13px;">+ 회원 추가</button>
                    <input type="text" id="db-search-player" placeholder="🔍 이름 검색..." style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; width:140px; margin-left:auto;" />
                </div>
                <div id="db-player-list-body" style="padding:14px 20px; overflow-y:auto; flex:1; display:grid; grid-template-columns:repeat(auto-fill, minmax(215px, 1fr)); gap:8px;">
                </div>
            </div>
        `;
        document.body.appendChild(modalWrap);

        // 관전 QR 코드 모달 주입
        const qrModalWrap = document.createElement("div");
        qrModalWrap.id = "qrModalWrap";
        qrModalWrap.style.cssText = "display:none; position:fixed; inset:0; background:rgba(15,23,42,0.65); backdrop-filter:blur(6px); z-index:16000; align-items:center; justify-content:center; padding:16px;";
        qrModalWrap.innerHTML = `
            <div style="background:#fff; width:100%; max-width:420px; border-radius:24px; box-shadow:0 25px 60px rgba(0,0,0,0.3); overflow:hidden; display:flex; flex-direction:column; text-align:center;">
                <div style="padding:16px 20px 14px; background:linear-gradient(135deg, #f0fdf4, #ecfdf5); border-bottom:1px solid #d1fae5; display:flex; align-items:center; justify-content:space-between;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:20px;">📱</span>
                        <h3 style="margin:0; font-size:16.5px; font-weight:900; color:#065f46;">실시간 관전 QR 코드</h3>
                    </div>
                    <button type="button" class="btn" id="btn-close-qr-modal" style="padding:4px 10px; font-size:12.5px; font-weight:800; border-radius:8px; border:1px solid #a7f3d0; background:#fff; color:#047857; cursor:pointer;">닫기 ✕</button>
                </div>
                <div style="padding:22px 20px 20px; display:flex; flex-direction:column; align-items:center; gap:14px;">
                    <div id="qr-code-box" style="background:#ffffff; padding:12px; border-radius:18px; border:2px solid #e2e8f0; box-shadow:0 6px 18px rgba(0,0,0,0.06); display:inline-flex; align-items:center; justify-content:center; min-width:224px; min-height:224px;"></div>
                    <div style="display:inline-flex; align-items:center; gap:6px; background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; padding:6px 14px; border-radius:999px; font-size:12px; font-weight:800;">
                        <span>📷 스마트폰 기본 카메라로 비추면 바로 연결됩니다</span>
                    </div>
                    <div style="width:100%; display:flex; gap:6px; align-items:center;">
                        <input type="text" id="qr-share-url-input" readonly style="flex:1; padding:8px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:12px; background:#f8fafc; color:#334155; font-family:monospace; font-weight:600;" />
                        <button type="button" id="btn-copy-qr-url" class="btn primary" style="padding:8px 14px; font-size:12.5px; font-weight:800; white-space:nowrap; background:#059669; border-color:#059669;">📋 복사</button>
                    </div>
                    <button type="button" id="btn-qr-kakao" style="width:100%; padding:10px; border-radius:12px; background:#fee500; color:#371d1e; font-weight:800; font-size:13px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 2px 6px rgba(0,0,0,0.08);">
                        <span>💬 카카오톡 단톡방에 관전 링크 공유</span>
                    </button>
                    <div style="font-size:11.5px; color:#64748b; line-height:1.5;">
                        💡 진행자가 입력하는 조별 리그 및 토너먼트 경기 결과가 관전자 기기에 <b>실시간 자동 반영</b>됩니다.
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(qrModalWrap);

        const btnHeaderQr = document.getElementById("btn-header-qr");
        if (btnHeaderQr) btnHeaderQr.addEventListener("click", openQrModal);

        const btnDashQr = document.getElementById("btn-dash-qr");
        if (btnDashQr) btnDashQr.addEventListener("click", openQrModal);

        document.getElementById("btn-close-qr-modal")?.addEventListener("click", () => {
            qrModalWrap.style.display = "none";
        });
        qrModalWrap.addEventListener("click", (e) => {
            if (e.target === qrModalWrap) qrModalWrap.style.display = "none";
        });
        document.getElementById("btn-copy-qr-url")?.addEventListener("click", () => {
            const urlInput = document.getElementById("qr-share-url-input");
            if (urlInput && urlInput.value) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(urlInput.value).then(() => {
                        showLiveToast("📋 [관전 링크]가 클립보드에 복사되었습니다!");
                    });
                } else {
                    prompt("관전용 링크입니다:", urlInput.value);
                }
            }
        });
        document.getElementById("btn-qr-kakao")?.addEventListener("click", copyViewerUrlForKakao);


        document.getElementById("btn-close-db-players").addEventListener("click", () => {
            modalWrap.style.display = "none";
        });
        document.getElementById("btn-add-db-player").addEventListener("click", handleAddDbPlayer);
        document.getElementById("db-search-player").addEventListener("input", renderPlayerManagerList);

        const tabActive = document.getElementById("db-tab-active");
        const tabInactive = document.getElementById("db-tab-inactive");
        if (tabActive && tabInactive) {
            tabActive.addEventListener("click", () => {
                currentDbModalTab = "active";
                tabActive.style.background = "#fff";
                tabActive.style.color = "#0f172a";
                tabActive.style.borderColor = "#cbd5e1";
                tabActive.style.borderBottomColor = "transparent";
                tabInactive.style.background = "transparent";
                tabInactive.style.color = "#64748b";
                tabInactive.style.borderColor = "transparent";
                renderPlayerManagerList();
            });
            tabInactive.addEventListener("click", () => {
                currentDbModalTab = "inactive";
                tabInactive.style.background = "#fff";
                tabInactive.style.color = "#0f172a";
                tabInactive.style.borderColor = "#cbd5e1";
                tabInactive.style.borderBottomColor = "transparent";
                tabActive.style.background = "transparent";
                tabActive.style.color = "#64748b";
                tabActive.style.borderColor = "transparent";
                renderPlayerManagerList();
            });
        }

        // 관전 모드일 때 점수 테이블/토너먼트 클릭 차단 인터셉터
        document.addEventListener("click", (e) => {
            if (currentRole !== "viewer") return;
            const blockedTarget = e.target.closest("#teams td, #teams th.rank-cell, .tm-player, .name-chip");
            if (blockedTarget) {
                e.stopPropagation();
                e.preventDefault();
                showLiveToast("👀 현재 [실시간 관전 모드]입니다. 점수를 입력하려면 상단 [✏️ 진행자 모드]로 전환하세요.");
            }
        }, true);

        updateRoleUI();
    }

    function showLiveToast(msg) {
        const t = document.getElementById("live-toast");
        if (!t) return;
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove("show"), 2600);
    }

    function setSyncStatus(text, color = "#64748b") {
        const el = document.getElementById("live-sync-status");
        if (el) {
            el.textContent = text;
            el.style.color = color;
        }
    }

    function toggleLiveRole() {
        if (currentRole === "host") {
            logoutHostMode();
        } else {
            requestHostMode();
        }
    }

    window.requestHostMode = requestHostMode;
    window.logoutHostMode = logoutHostMode;
    window.copyViewerUrlForKakao = copyViewerUrlForKakao;

    function getViewerShareUrl() {
        if (window.location.hostname && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
            const u = new URL(window.location.href);
            u.searchParams.set("mode", "viewer");
            u.searchParams.delete("pin");
            return u.toString();
        }
        return "https://manyoungpark.github.io/pingpong_league/?mode=viewer";
    }

    function openQrModal() {
        const modal = document.getElementById("qrModalWrap");
        if (!modal) return;
        const shareUrl = getViewerShareUrl();
        const input = document.getElementById("qr-share-url-input");
        if (input) input.value = shareUrl;

        const qrBox = document.getElementById("qr-code-box");
        if (qrBox) {
            qrBox.innerHTML = "";
            if (typeof QRCode !== "undefined") {
                try {
                    new QRCode(qrBox, {
                        text: shareUrl,
                        width: 200,
                        height: 200,
                        colorDark: "#0f172a",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.M
                    });
                } catch (e) {
                    console.warn("QRCode local render error:", e);
                    renderQrFallback(qrBox, shareUrl);
                }
            } else {
                renderQrFallback(qrBox, shareUrl);
            }
        }
        modal.style.display = "flex";
    }

    function renderQrFallback(container, text) {
        const enc = encodeURIComponent(text);
        container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${enc}" alt="QR Code" width="200" height="200" style="display:block; border-radius:8px;" />`;
    }

    window.openQrModal = openQrModal;


    // 🔐 PIN 비밀번호(1111) 확인 후 진행자 모드로 승인
    function requestHostMode() {
        if (currentRole === "host") return;
        if (localStorage.getItem("pingpong_admin_token") === ADMIN_PIN) {
            setLiveRole("host");
            return;
        }
        const pin = prompt("👑 경기 진행자(관리자) 비밀번호 4자리를 입력하세요:", "");
        if (pin === null) return; // 사용자가 취소함
        if (pin.trim() === ADMIN_PIN) {
            localStorage.setItem("pingpong_admin_token", ADMIN_PIN);
            setLiveRole("host");
            showLiveToast("👑 진행자(관리자) 권한이 승인되었습니다. 조 편성 및 점수 입력이 가능합니다.");
        } else {
            alert("❌ 비밀번호가 올바르지 않습니다. (실시간 관전 모드가 유지됩니다)");
        }
    }

    // 🔒 진행자 모드 로그아웃 (관전자로 잠금)
    function logoutHostMode() {
        if (confirm("관전자 모드로 전환하시겠습니까?\n(다시 진행자 모드로 바꾸려면 비밀번호 1111이 필요합니다)")) {
            localStorage.removeItem("pingpong_admin_token");
            setLiveRole("viewer");
        }
    }

    // 📢 카톡 단톡방 전송용 관전 링크 복사 함수
    function copyViewerUrlForKakao() {
        const u = new URL(window.location.href);
        u.searchParams.set("mode", "viewer");
        u.searchParams.delete("pin");
        const shareUrl = u.toString();

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl).then(() => {
                showLiveToast("📢 [카톡 공유용 관전 링크]가 복사되었습니다! 단톡방에 붙여넣기 하세요.");
            }).catch(() => {
                prompt("카카오톡으로 공유할 관전용 링크입니다 (복사하여 전송):", shareUrl);
            });
        } else {
            prompt("카카오톡으로 공유할 관전용 링크입니다 (복사하여 전송):", shareUrl);
        }
    }

    function setLiveRole(role) {
        currentRole = role;
        localStorage.setItem("pingpong_live_role", role);
        updateRoleUI();
        if (role === "viewer") {
            showLiveToast("🟢 실시간 관전 모드로 전환되었습니다. 진행자의 화면이 실시간 동기화됩니다.");
            fetchLatestLiveState(true);
        } else {
            showLiveToast("✏️ 경기 진행자 모드로 전환되었습니다. 변경 사항이 실시간 송출됩니다.");
            pushLiveStateNow();
        }
    }

    function updateRoleUI() {
        const btn = document.getElementById("btn-live-role");
        const dot = document.getElementById("live-dot-ind");
        const lbl = document.getElementById("live-role-label");
        const copyBtn = document.getElementById("btn-copy-viewer-url");
        const lockBtn = document.getElementById("btn-lock-viewer");
        const playersBtn = document.getElementById("btn-open-db-players");

        if (!btn || !dot || !lbl) return;

        if (currentRole === "viewer") {
            document.body.classList.add("live-viewer-mode");
            btn.className = "live-badge-btn role-viewer";
            dot.className = "live-dot pulse-green";
            lbl.textContent = "👀 실시간 관전 모드 (자동 갱신)";
            btn.title = "현재 실시간 관전 모드입니다. 클릭 시 진행자 모드로 전환(비밀번호 필요)";
            if (copyBtn) copyBtn.style.display = "none";
            if (lockBtn) lockBtn.style.display = "none";
            if (playersBtn) playersBtn.style.display = "none";
        } else {
            document.body.classList.remove("live-viewer-mode");
            btn.className = "live-badge-btn role-host";
            dot.className = "live-dot pulse-blue";
            lbl.textContent = "✏️ 진행자 모드 (실시간 송출)";
            btn.title = "현재 진행자 모드입니다. 클릭 시 관전자 모드로 전환";
            if (copyBtn) copyBtn.style.display = "inline-flex";
            if (lockBtn) lockBtn.style.display = "inline-flex";
            if (playersBtn) playersBtn.style.display = "inline-flex";
        }
    }

    // ------------------------------------------------------------------
    // 2. 현재 경기 상태 직렬화 & 화면 즉시 복원 (스크롤 유지 스마트 렌더링)
    // ------------------------------------------------------------------
    function buildLivePayload() {
        if (typeof state === "undefined" || typeof resultsByTeam === "undefined") return null;
        const serializeMap = (map) => Array.from(map.entries());
        const serializeDeepMap = (map) => Array.from(map.entries()).map(([k, v]) => [k, Array.from(v.entries())]);

        const dateEl = document.getElementById("datePicker");
        const titleEl = document.getElementById("headerTitle");
        const fmtEl = document.getElementById("matchFormat");
        const tmArea = document.getElementById("tournament-area");
        const tmVisible = tmArea && tmArea.style.display !== "none" && !tmArea.style.cssText.includes("display: none");

        return {
            clientId: CLIENT_ID,
            timestamp: Date.now(),
            date: dateEl ? dateEl.value : new Date().toISOString().slice(0, 10),
            headerTitle: titleEl ? titleEl.value : "금요리그",
            groupsCount: state.groupsCount || 4,
            matchFormat: fmtEl ? fmtEl.value : "bo3",
            playersState: serializeMap(state),
            results: serializeDeepMap(resultsByTeam),
            manualRanks: serializeDeepMap(manualRankByTeam),
            bracketState: serializeMap(bracketState),
            tournamentType: typeof tournamentType !== "undefined" ? tournamentType : "split",
            tournamentVisible: Boolean(tmVisible || bracketState.size > 0)
        };
    }

    function applyLivePayload(payload, forceRender = false) {
        if (!payload || typeof payload !== "object") return false;
        if (!forceRender && payload.timestamp && payload.timestamp <= lastAppliedTimestamp) {
            return false;
        }
        if (payload.clientId && payload.clientId === CLIENT_ID && !forceRender) {
            return false;
        }

        lastAppliedTimestamp = payload.timestamp || Date.now();
        isApplyingRemoteState = true;
        const prevScrollY = window.scrollY;

        try {
            if (payload.date) {
                const dateEl = document.getElementById("datePicker");
                if (dateEl && dateEl.value !== payload.date) dateEl.value = payload.date;
            }
            if (payload.headerTitle) {
                const titleEl = document.getElementById("headerTitle");
                if (titleEl && titleEl.value !== payload.headerTitle) titleEl.value = payload.headerTitle;
            }
            if (payload.groupsCount) state.groupsCount = payload.groupsCount;
            if (payload.matchFormat && typeof matchFormatEl !== "undefined") {
                matchFormatEl.value = payload.matchFormat;
            }

            if (Array.isArray(payload.playersState)) {
                state.clear();
                new Map(payload.playersState).forEach((v, k) => state.set(k, v));
            }
            if (Array.isArray(payload.results)) {
                resultsByTeam.clear();
                new Map(payload.results).forEach((v, k) => resultsByTeam.set(k, new Map(v)));
            }
            if (Array.isArray(payload.manualRanks)) {
                manualRankByTeam.clear();
                new Map(payload.manualRanks).forEach((v, k) => manualRankByTeam.set(k, new Map(v)));
            }
            if (Array.isArray(payload.bracketState)) {
                bracketState.clear();
                new Map(payload.bracketState).forEach((v, k) => bracketState.set(k, v));
            }
            if (payload.tournamentType && typeof tournamentType !== "undefined") {
                tournamentType = payload.tournamentType;
            }

            // Ensure all players in INITIAL_NAMES exist in state (defaulting to pool)
            if (typeof INITIAL_NAMES !== "undefined") {
                INITIAL_NAMES.forEach(nm => {
                    if (!state.has(nm) || state.get(nm)?.where !== "team") {
                        if (!state.has(nm)) state.set(nm, { where: "pool" });
                    }
                });
            }

            if (typeof createTeams === "function" && typeof renderAllTeams === "function") {
                createTeams(state.groupsCount);
                renderAllTeams();
            }

            if (typeof renderPool === "function") {
                renderPool();
            }

            const tmArea = document.getElementById("tournament-area");
            const hasBracketData = (payload.bracketState && payload.bracketState.length > 0) || (bracketState && bracketState.size > 0);
            if (payload.tournamentVisible || hasBracketData) {
                if (tmArea) tmArea.style.setProperty("display", "block", "important");
                if (typeof runTournamentGeneration === "function") {
                    setTimeout(() => {
                        try { runTournamentGeneration(true); } catch (_) {}
                    }, 50);
                }
            } else if (tmArea) {
                tmArea.style.setProperty("display", "none", "important");
            }

            const timeStr = new Date(lastAppliedTimestamp).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
            setSyncStatus(`🟢 실시간 반영됨 (${timeStr})`, "#059669");
            window.scrollTo(window.scrollX, prevScrollY);
            return true;
        } catch (err) {
            console.warn("Live state apply error:", err);
            return false;
        } finally {
            setTimeout(() => {
                isApplyingRemoteState = false;
            }, 120);
        }
    }

    // ------------------------------------------------------------------
    // 3. 실시간 송출 (Supabase WebSocket Broadcast + DB Upsert + GAS Fallback)
    // ------------------------------------------------------------------
    function scheduleLivePush() {
        if (isApplyingRemoteState || currentRole !== "host") return;

        const payload = buildLivePayload();
        if (!payload) return;

        // 1) 같은 기기 내 다른 탭(테스트용) 즉시 0.01초 브로드캐스트
        if (localBroadcast) {
            try { localBroadcast.postMessage(payload); } catch (_) {}
        }

        // 2) Supabase WebSocket Broadcast 채널로 접속 중인 전 기기에 0.05초 즉시 푸시
        if (sbChannel && sbAvailable) {
            try {
                sbChannel.send({
                    type: "broadcast",
                    event: "live_update",
                    payload: payload
                });
            } catch (_) {}
        }

        // 3) DB / 클라우드 저장은 400ms 디바운스 처리
        clearTimeout(pushDebounceTimer);
        pushDebounceTimer = setTimeout(() => {
            pushLiveStateNow(payload);
        }, 400);
    }

    async function pushLiveStateNow(customPayload) {
        if (isApplyingRemoteState || currentRole !== "host") return;
        const payload = customPayload || buildLivePayload();
        if (!payload) return;

        const timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        // A. Supabase DB (pingpong_live_state) Upsert
        if (sbClient && sbAvailable) {
            try {
                const { error } = await sbClient
                    .from("live_state")
                    .upsert({
                        id: "current",
                        is_live: true,
                        match_date: payload.date,
                        title: "대덕밸리동호회 " + payload.headerTitle,
                        state_json: payload,
                        updated_at: new Date().toISOString(),
                        updated_by: CLIENT_ID
                    }, { onConflict: "id" });

                if (!error) {
                    setSyncStatus(`⚡ Supabase 실시간 송출됨 (${timeStr})`, "#2563eb");
                    return;
                }
            } catch (e) {
                console.warn("Supabase live upsert fallback:", e);
            }
        }

        // B. Fallback: Google Apps Script (CacheService + live_state 탭)
        if (typeof GAS_URL !== "undefined" && GAS_URL) {
            try {
                await fetch(GAS_URL, {
                    method: "POST",
                    mode: "no-cors",
                    keepalive: true,
                    headers: { "Content-Type": "text/plain" },
                    body: JSON.stringify({
                        action: "saveLive",
                        date: payload.date,
                        liveData: payload
                    })
                });
                setSyncStatus(`☁️ 클라우드 실시간 송출됨 (${timeStr})`, "#2563eb");
            } catch (_) {}
        }
    }

    async function fetchLatestLiveState(forceRender = false) {
        // 1) Supabase DB에서 먼저 조회 (0.05초)
        if (sbClient) {
            try {
                const { data, error } = await sbClient
                    .from("live_state")
                    .select("*")
                    .eq("id", "current")
                    .maybeSingle();

                if (!error && data) {
                    sbAvailable = true;
                    if (data.state_json && Object.keys(data.state_json).length > 0) {
                        applyLivePayload(data.state_json, forceRender);
                        return true;
                    }
                }
            } catch (_) {}
        }

        // 2) Fallback: GAS ?action=getLive 또는 로컬 백업 조회
        if (typeof GAS_URL !== "undefined" && GAS_URL) {
            try {
                const res = await fetch(`${GAS_URL}?action=getLive&_t=${Date.now()}`);
                const json = await res.json();
                if (json && json.success && json.liveData) {
                    const parsed = typeof json.liveData === "string" ? JSON.parse(json.liveData) : json.liveData;
                    applyLivePayload(parsed, forceRender);
                    return true;
                }
            } catch (_) {}
        }

        // 3) 로컬 백업 제거됨 (클라우드 DB 단일 복구)
        return false;
    }

    // ------------------------------------------------------------------
    // 4. 회원 명단 & 부수 DB (pingpong_players) 동기화 및 관리 모달
    // ------------------------------------------------------------------
    async function syncPlayersFromDB() {
        if (!sbClient) return;
        try {
            const { data, error } = await sbClient
                .from("players")
                .select("*")
                .order("sort_order", { ascending: true });

            if (!error && Array.isArray(data) && data.length > 0) {
                sbAvailable = true;
                applyPlayerListToApp(data);
            }
        } catch (_) {}
    }

    function applyPlayerListToApp(playerRows) {
        if (!Array.isArray(playerRows) || playerRows.length === 0) return;

        // 최신 DB 회원 명단을 로컬 캐시에 영구 저장 (오프라인 지원)
        try {
            localStorage.setItem("pingpong_cached_players_v1", JSON.stringify(playerRows));
        } catch (_) {}

        let hasNew = false;
        playerRows.forEach((p, idx) => {
            const g = isNaN(Number(p.grade)) ? String(p.grade) : Number(p.grade);
            const isActive = p.active !== false;
            if (typeof PLAYER_INFO !== "undefined") {
                PLAYER_INFO.set(p.name, { id: p.id || `p${idx + 1}`, name: p.name, grade: g, active: isActive });
            }
            if (isActive) {
                if (typeof INITIAL_NAMES !== "undefined" && !INITIAL_NAMES.includes(p.name)) {
                    INITIAL_NAMES.push(p.name);
                    hasNew = true;
                }
                if (typeof state !== "undefined" && !state.has(p.name)) {
                    state.set(p.name, { where: "pool" });
                }
            } else {
                if (typeof INITIAL_NAMES !== "undefined") {
                    const i = INITIAL_NAMES.indexOf(p.name);
                    if (i !== -1) {
                        INITIAL_NAMES.splice(i, 1);
                        hasNew = true;
                    }
                }
                if (typeof state !== "undefined" && state.has(p.name)) {
                    state.delete(p.name);
                }
            }
        });

        if (hasNew && typeof INITIAL_NAMES !== "undefined") {
            INITIAL_NAMES.sort((a, b) => a.localeCompare(b, "ko"));
            if (typeof saveNames === "function") {
                try { saveNames(); } catch (_) {}
            }
        }

        // UI 리렌더링 (이름 목록 칩 풀 + 조별 대진표)
        if (typeof renderPool === "function") renderPool();
        if (typeof renderAllTeams === "function") renderAllTeams();
    }

    function openPlayerManagerModal() {
        const wrap = document.getElementById("dbPlayerModalWrap");
        if (!wrap) return;
        wrap.style.display = "flex";
        const sub = document.getElementById("db-player-modal-sub");
        if (sub) {
            sub.textContent = sbAvailable
                ? "⚡ Supabase DB 연결됨 — 부수 변경 및 회원 추가 시 전 기기에 즉시 영구 반영됩니다."
                : "💾 로컬 저장소 연결됨 (Supabase 활성화 시 클라우드 DB와 자동 동기화됩니다)";
        }
        renderPlayerManagerList();
    }

    function renderPlayerManagerList() {
        const container = document.getElementById("db-player-list-body");
        if (!container || typeof PLAYER_INFO === "undefined") return;
        const q = (document.getElementById("db-search-player")?.value || "").trim().toLowerCase();

        const allEntries = Array.from(PLAYER_INFO.entries())
            .map(([name, info]) => ({
                name,
                id: info.id,
                grade: String(info.grade),
                active: info.active !== false
            }))
            .sort((a, b) => a.name.localeCompare(b.name, "ko"));

        const activeCount = allEntries.filter(e => e.active).length;
        const inactiveCount = allEntries.filter(e => !e.active).length;

        const countActEl = document.getElementById("db-count-active");
        const countInactEl = document.getElementById("db-count-inactive");
        if (countActEl) countActEl.textContent = activeCount;
        if (countInactEl) countInactEl.textContent = inactiveCount;

        const filtered = allEntries
            .filter(item => (currentDbModalTab === "active" ? item.active : !item.active))
            .filter(item => !q || item.name.toLowerCase().includes(q));

        const grades = ["선수", "1", "2", "3", "4", "5", "6", "7", "희망"];
        if (filtered.length === 0) {
            container.innerHTML = `
                <div style="grid-column:1/-1; text-align:center; padding:32px 16px; color:#94a3b8; font-weight:600; font-size:13.5px;">
                    ${currentDbModalTab === "active" ? "활동 중인 회원이 없습니다." : "쉬는(출장/휴면) 회원이 없습니다."}
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map(item => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border:${item.active ? '1px solid #e2e8f0' : '1px dashed #cbd5e1'}; border-radius:10px; background:${item.active ? '#fff' : '#f8fafc'}; gap:6px;">
                <div style="display:flex; align-items:center; gap:5px; overflow:hidden;">
                    <span style="font-weight:800; font-size:13.5px; color:${item.active ? '#0f172a' : '#64748b'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${!item.active ? 'text-decoration:line-through;' : ''}">${item.name}</span>
                    ${!item.active ? '<span style="font-size:10.5px; padding:1px 5px; border-radius:4px; background:#e2e8f0; color:#475569; font-weight:700; flex-shrink:0;">휴면</span>' : ''}
                </div>
                <div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
                    <select data-pname="${item.name}" class="db-grade-select" style="padding:3px 5px; border:1px solid #cbd5e1; border-radius:6px; font-weight:800; font-size:12px; ${!item.active ? 'color:#64748b;' : ''}">
                        ${grades.map(g => `<option value="${g}" ${String(item.grade) === g ? "selected" : ""}>${g}부</option>`).join("")}
                    </select>
                    ${item.active
                        ? `<button type="button" class="btn-toggle-db-active" data-pname="${item.name}" data-action="rest" title="장기출장/휴면으로 전환 (대진표 명단에서 숨김)" style="padding:3px 6px; border:1px solid #fed7aa; background:#fff7ed; color:#ea580c; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; line-height:1.2;">쉬기 ⏸️</button>`
                        : `<button type="button" class="btn-toggle-db-active" data-pname="${item.name}" data-action="activate" title="활동 회원으로 복귀 (대진표 명단에 다시 표시)" style="padding:3px 7px; border:1px solid #bbf7d0; background:#f0fdf4; color:#15803d; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; line-height:1.2;">복귀 ▶️</button>`
                    }
                    <button type="button" class="btn-delete-db-player" data-pname="${item.name}" title="${item.name} 회원 영구 삭제" style="padding:3px 6px; border:1px solid #fecaca; background:#fff1f2; color:#e11d48; border-radius:6px; font-weight:800; font-size:11px; cursor:pointer; line-height:1.2;">✕</button>
                </div>
            </div>
        `).join("");

        container.querySelectorAll(".db-grade-select").forEach(sel => {
            sel.addEventListener("change", async (e) => {
                const pname = e.target.getAttribute("data-pname");
                const newGrade = e.target.value;
                await updatePlayerGradeInDB(pname, newGrade);
            });
        });

        container.querySelectorAll(".btn-toggle-db-active").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const pname = e.currentTarget.getAttribute("data-pname");
                const action = e.currentTarget.getAttribute("data-action");
                await togglePlayerActiveStatus(pname, action === "activate");
            });
        });

        container.querySelectorAll(".btn-delete-db-player").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const pname = e.currentTarget.getAttribute("data-pname");
                await handleDeleteDbPlayer(pname);
            });
        });
    }

    async function togglePlayerActiveStatus(name, newActive) {
        if (!name) return;
        const msg = newActive
            ? `[${name}] 회원을 '활동 회원'으로 복귀시키시겠습니까?\n\n(게임 대진표 명단에 다시 나타납니다)`
            : `[${name}] 회원을 '쉬는 회원(출장/휴면)'으로 전환하시겠습니까?\n\n(게임 대진표 명단에서 숨겨지며, 복귀 시 언제든 다시 활성화할 수 있습니다)`;
        if (!confirm(msg)) return;

        // 1. 메모리 상태 갱신
        if (typeof PLAYER_INFO !== "undefined") {
            const cur = PLAYER_INFO.get(name) || { id: "p_" + Date.now(), name, grade: 5 };
            PLAYER_INFO.set(name, { ...cur, active: newActive });
        }

        if (typeof INITIAL_NAMES !== "undefined") {
            if (newActive) {
                if (!INITIAL_NAMES.includes(name)) INITIAL_NAMES.push(name);
                INITIAL_NAMES.sort((a, b) => a.localeCompare(b, "ko"));
                if (typeof state !== "undefined" && !state.has(name)) {
                    state.set(name, { where: "pool" });
                }
            } else {
                const i = INITIAL_NAMES.indexOf(name);
                if (i !== -1) INITIAL_NAMES.splice(i, 1);
                if (typeof state !== "undefined" && state.has(name)) {
                    state.delete(name);
                }
            }
            window.INITIAL_NAMES = INITIAL_NAMES;
        }

        // 2. 로컬 캐시 갱신
        if (typeof saveNames === "function") {
            try { saveNames(); } catch (_) {}
        }
        try {
            const listToCache = Array.from(PLAYER_INFO.entries()).map(([nm, info]) => ({
                id: info.id,
                name: nm,
                grade: info.grade,
                active: info.active !== false
            }));
            localStorage.setItem("pingpong_cached_players_v1", JSON.stringify(listToCache));
        } catch (_) {}

        // 3. UI 갱신
        renderPlayerManagerList();
        if (typeof renderPool === "function") renderPool();
        if (typeof renderAllTeams === "function") renderAllTeams();

        // 4. Supabase DB 갱신
        if (sbClient && sbAvailable) {
            try {
                await sbClient.from("players").update({
                    active: newActive,
                    updated_at: new Date().toISOString()
                }).eq("name", name);
            } catch (err) {
                console.warn("DB active toggle failed:", err);
            }
        }

        if (newActive) {
            showLiveToast(`🟢 [${name}] 회원이 활동 회원으로 복귀했습니다! (게임 명단에 표시됨)`);
        } else {
            showLiveToast(`⏸️ [${name}] 회원이 쉬는 회원으로 변경되었습니다. (게임 명단에서 숨김)`);
        }
    }

    async function handleDeleteDbPlayer(name) {
        if (!name) return;
        if (!confirm(`정말 [${name}] 회원을 명단에서 삭제하시겠습니까?\n(삭제 시 모든 기기 및 DB에서 영구 삭제됩니다)`)) {
            return;
        }

        // 1. 메모리 상태에서 삭제
        if (typeof PLAYER_INFO !== "undefined") {
            PLAYER_INFO.delete(name);
        }
        if (typeof INITIAL_NAMES !== "undefined") {
            const idx = INITIAL_NAMES.indexOf(name);
            if (idx !== -1) INITIAL_NAMES.splice(idx, 1);
            window.INITIAL_NAMES = INITIAL_NAMES;
        }
        if (typeof state !== "undefined") {
            state.delete(name);
        }

        // 2. 로컬 캐시 갱신
        if (typeof saveNames === "function") {
            try { saveNames(); } catch (_) {}
        }
        try {
            const listToCache = Array.from(PLAYER_INFO.entries()).map(([nm, info]) => ({
                id: info.id,
                name: nm,
                grade: info.grade
            }));
            localStorage.setItem("pingpong_cached_players_v1", JSON.stringify(listToCache));
        } catch (_) {}

        // 3. UI 갱신
        renderPlayerManagerList();
        if (typeof renderPool === "function") renderPool();
        if (typeof renderAllTeams === "function") renderAllTeams();

        // 4. Supabase DB에서 삭제
        if (sbClient && sbAvailable) {
            try {
                await sbClient.from("players").delete().eq("name", name);
                showLiveToast(`🗑️ [${name}] 회원이 DB에서 완전히 삭제되었습니다.`);
                return;
            } catch (err) {
                console.warn("DB delete failed, trying soft delete:", err);
                try {
                    await sbClient.from("players").update({ active: false }).eq("name", name);
                } catch (_) {}
            }
        }
        showLiveToast(`🗑️ [${name}] 회원이 삭제되었습니다.`);
    }

    async function updatePlayerGradeInDB(name, newGrade) {
        const gVal = isNaN(Number(newGrade)) ? newGrade : Number(newGrade);
        if (typeof PLAYER_INFO !== "undefined") {
            const existing = PLAYER_INFO.get(name) || { id: "p_" + Date.now() };
            PLAYER_INFO.set(name, { ...existing, grade: gVal });
        }
        if (typeof saveNames === "function") {
            try { saveNames(); } catch (_) {}
        }
        if (typeof renderPool === "function") renderPool();
        if (typeof renderAllTeams === "function") renderAllTeams();

        if (sbClient && sbAvailable) {
            try {
                const info = PLAYER_INFO.get(name);
                await sbClient.from("players").upsert({
                    id: info?.id || "p_" + Date.now(),
                    name: name,
                    grade: String(newGrade),
                    active: true,
                    updated_at: new Date().toISOString()
                }, { onConflict: "name" });
                showLiveToast(`✅ [${name}] 회원의 부수가 ${newGrade}부로 DB에 저장되었습니다.`);
                return;
            } catch (_) {}
        }
        showLiveToast(`✅ [${name}] 회원의 부수가 ${newGrade}부로 변경되었습니다.`);
    }

    async function handleAddDbPlayer() {
        const nameInput = document.getElementById("db-new-player-name");
        const gradeSel = document.getElementById("db-new-player-grade");
        const name = (nameInput?.value || "").trim();
        const grade = gradeSel?.value || "5";
        if (!name) {
            alert("회원 이름을 입력해주세요.");
            return;
        }
        const gVal = isNaN(Number(grade)) ? grade : Number(grade);
        const newId = "p" + String(Date.now()).slice(-5);

        if (typeof PLAYER_INFO !== "undefined") {
            PLAYER_INFO.set(name, { id: newId, name: name, grade: gVal });
        }
        if (typeof INITIAL_NAMES !== "undefined" && !INITIAL_NAMES.includes(name)) {
            INITIAL_NAMES.push(name);
            INITIAL_NAMES.sort((a, b) => a.localeCompare(b, "ko"));
        }
        if (typeof state !== "undefined") {
            state.set(name, { where: "pool" });
        }
        if (typeof saveNames === "function") {
            try { saveNames(); } catch (_) {}
        }
        if (typeof renderPool === "function") renderPool();
        if (typeof renderAllTeams === "function") renderAllTeams();

        if (sbClient && sbAvailable) {
            try {
                await sbClient.from("players").upsert({
                    id: newId,
                    name: name,
                    grade: String(grade),
                    sort_order: state.size,
                    active: true,
                    updated_at: new Date().toISOString()
                }, { onConflict: "name" });
            } catch (_) {}
        }
        nameInput.value = "";
        renderPlayerManagerList();
        showLiveToast(`🎉 [${name} (${grade}부)] 회원이 추가되었습니다!`);
    }

    // ------------------------------------------------------------------
    // 5. 기존 함수 후킹 (saveAllData, h_fetchHistoryList, h_loadSpecific, 대시보드 & 결과 저장)
    // ------------------------------------------------------------------
    function hookExistingFunctions() {
        // A. saveAllData 후킹 -> 호출될 때마다 실시간 중계 송출!
        if (typeof window.saveAllData === "function" && !window.saveAllData._sbHooked) {
            const origSaveAllData = window.saveAllData;
            window.saveAllData = function (...args) {
                const res = origSaveAllData.apply(this, args);
                scheduleLivePush();
                return res;
            };
            window.saveAllData._sbHooked = true;
        }

        // B. 기록실 목록 조회 (h_fetchHistoryList) -> Supabase 우선 조회 (0.05초), 실패 시 GAS 폴백
        if (typeof window.h_fetchHistoryList === "function" && !window.h_fetchHistoryList._sbHooked) {
            const origFetchList = window.h_fetchHistoryList;
            window.h_fetchHistoryList = async function (...args) {
                if (sbClient) {
                    try {
                        const { data, error } = await sbClient
                            .from("tournaments")
                            .select("match_date, title")
                            .order("match_date", { ascending: false });

                        if (!error && Array.isArray(data) && data.length > 0) {
                            sbAvailable = true;
                            const select = document.getElementById("h-historySelect");
                            if (select) {
                                h_historyList = data.map(r => ({ date: r.match_date, title: r.title }));
                                select.innerHTML = "";
                                h_historyList.forEach((item, idx) => {
                                    const opt = document.createElement("option");
                                    opt.value = idx;
                                    opt.textContent = `${item.date} - ${item.title}`;
                                    select.appendChild(opt);
                                });
                                if (h_currentIndex === -1 && h_historyList.length > 0) {
                                    h_currentIndex = 0;
                                    select.value = 0;
                                    window.h_loadSpecific(0);
                                }
                                return;
                            }
                        }
                    } catch (_) {}
                }
                return origFetchList.apply(this, args);
            };
            window.h_fetchHistoryList._sbHooked = true;
        }

        // C. 기록실 특정 대회 로드 (h_loadSpecific) -> Supabase 우선 조회 (0.05초), 실패 시 GAS 폴백
        if (typeof window.h_loadSpecific === "function" && !window.h_loadSpecific._sbHooked) {
            const origLoadSpec = window.h_loadSpecific;
            window.h_loadSpecific = async function (idx) {
                if (idx === "") return;
                const index = parseInt(idx);
                const item = typeof h_historyList !== "undefined" ? h_historyList[index] : null;
                if (item && sbClient && sbAvailable) {
                    const overlay = document.getElementById("h-loading-overlay");
                    if (overlay) overlay.style.display = "flex";
                    try {
                        const { data, error } = await sbClient
                            .from("tournaments")
                            .select("full_data")
                            .eq("match_date", item.date)
                            .maybeSingle();

                        if (!error && data && data.full_data) {
                            h_currentIndex = index;
                            const parsed = typeof data.full_data === "string" ? JSON.parse(data.full_data) : data.full_data;
                            h_initViewer(parsed);
                            if (overlay) overlay.style.display = "none";
                            if (typeof h_updateNavButtons === "function") h_updateNavButtons();
                            return;
                        }
                    } catch (_) {
                        if (overlay) overlay.style.display = "none";
                    }
                }
                return origLoadSpec.apply(this, arguments);
            };
            window.h_loadSpecific._sbHooked = true;
        }

        // D. 대회 결과 최종 저장 시 Supabase pingpong_tournaments 에도 동시 저장하도록 fetch 후킹
        const origFetch = window.fetch;
        window.fetch = async function (input, init) {
            if (init && init.method === "POST" && init.body && typeof init.body === "string") {
                try {
                    const bodyObj = JSON.parse(init.body);
                    if (bodyObj && bodyObj.fullData && bodyObj.results && sbClient) {
                        const fullObj = typeof bodyObj.fullData === "string" ? JSON.parse(bodyObj.fullData) : bodyObj.fullData;
                        const meta = fullObj.metadata || {};
                        sbClient.from("tournaments").upsert({
                            match_date: bodyObj.date || meta.date,
                            title: meta.title || "대덕밸리동호회 금요리그",
                            groups_count: Number(meta.groupsCount || 4),
                            match_format: meta.matchFormat || "bo3",
                            results_summary: bodyObj.results,
                            full_data: fullObj,
                            updated_at: new Date().toISOString()
                        }, { onConflict: "match_date" }).then(() => {
                            showLiveToast("⚡ Supabase DB 및 구글 시트에 대회 결과가 이중 저장되었습니다!");
                        }).catch(() => {});
                    }
                } catch (_) {}
            }
            return origFetch.apply(this, arguments);
        };
    }

    // ------------------------------------------------------------------
    // 6. 초기화 & Supabase Realtime 구독 시작
    // ------------------------------------------------------------------
    async function initSupabaseLive() {
        injectLiveUI();
        hookExistingFunctions();

        // 동일 브라우저 탭 간 즉시 동기화 채널 (로컬 멀티탭 테스트 및 즉시 반영용)
        if ("BroadcastChannel" in window) {
            localBroadcast = new BroadcastChannel("pingpong_live_channel");
            localBroadcast.onmessage = (ev) => {
                if (currentRole === "viewer" && ev.data) {
                    applyLivePayload(ev.data, false);
                }
            };
        }

        // Supabase JS SDK 초기화
        if (window.supabase && typeof window.supabase.createClient === "function") {
            try {
                sbClient = window.supabase.createClient(SB_URL, SB_KEY, {
                    db: { schema: "pingpong" },
                    realtime: { params: { eventsPerSecond: 20 } }
                });
                window.pingpongSupabase = sbClient;

                // 1) 초기 연결 및 회원 명단 / 실시간 상태 체크
                const { data, error } = await sbClient
                    .from("live_state")
                    .select("*")
                    .eq("id", "current")
                    .maybeSingle();

                if (!error) {
                    sbAvailable = true;
                    setSyncStatus("⚡ Supabase 실시간 DB 연결됨", "#059669");
                    await syncPlayersFromDB();

                    if (data && data.is_live && data.state_json && Object.keys(data.state_json).length > 0) {
                        const hasLocalActive = typeof resultsByTeam !== "undefined" && resultsByTeam.size > 0;
                        const todayStr = new Date().toISOString().slice(0, 10);
                        const serverDate = data.state_json.date || data.match_date;

                        if (currentRole === "viewer") {
                            applyLivePayload(data.state_json, true);
                        } else if (currentRole === "host") {
                            // 진행자 모드: 브라우저가 꺼졌다가 다시 켜졌을 때 클라우드 DB 상태를 팝업 없이 깔끔하게 자동 복원!
                            if (!hasLocalActive) {
                                applyLivePayload(data.state_json, true);
                                showLiveToast(`⚡ 클라우드 DB의 [${serverDate}] 경기 진행 상태를 자동으로 이어서 복원했습니다.`);
                            }
                        }
                    }
                } else {
                    setSyncStatus("☁️ 클라우드 실시간 연동 모드", "#2563eb");
                }

                // 2) Supabase Realtime (Broadcast + Postgres Changes) 구독
                sbChannel = sbClient
                    .channel("pingpong-live-room", {
                        config: { broadcast: { self: false } }
                    })
                    .on("broadcast", { event: "live_update" }, (msg) => {
                        if (currentRole === "viewer" && msg && msg.payload) {
                            applyLivePayload(msg.payload, false);
                        }
                    })
                    .on(
                        "postgres_changes",
                        { event: "*", schema: "pingpong", table: "live_state" },
                        (chg) => {
                            if (currentRole === "viewer" && chg.new && chg.new.state_json) {
                                applyLivePayload(chg.new.state_json, false);
                            }
                        }
                    )
                    .on(
                        "postgres_changes",
                        { event: "*", schema: "pingpong", table: "players" },
                        () => {
                            syncPlayersFromDB();
                        }
                    )
                    .subscribe((status) => {
                        if (status === "SUBSCRIBED" && sbAvailable) {
                            setSyncStatus("⚡ 0.1초 실시간 중계 연결됨", "#059669");
                        }
                    });
            } catch (e) {
                console.warn("Supabase init warning:", e);
                setSyncStatus("☁️ 클라우드 실시간 모드", "#2563eb");
            }
        }

        // 관전 모드일 때 보조 폴링 (Supabase 미연결 시 또는 모바일 백그라운드 복귀 시 자동 보정)
        if (currentRole === "viewer") {
            fetchLatestLiveState(true);
        }
        pollTimer = setInterval(() => {
            if (document.visibilityState === "visible" && currentRole === "viewer") {
                fetchLatestLiveState(false);
            }
        }, 6000);

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && currentRole === "viewer") {
                fetchLatestLiveState(false);
            }
        });

        // 👑 URL에 ?mode=host 로 접속했으나 PIN 인증이 필요한 경우 프롬프트 실행
        if (pendingHostPrompt) {
            setTimeout(() => {
                requestHostMode();
            }, 600);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initSupabaseLive);
    } else {
        initSupabaseLive();
    }
})();

