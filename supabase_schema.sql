-- =====================================================================
-- 🏓 대덕밸리 탁구동호회 리그전 & 토너먼트 통합 시스템
--    [pingpong 전용 스키마 버전 - 오류 줄 제거 완료]
-- =====================================================================

-- 0. pingpong 전용 스키마 생성 및 권한 부여
CREATE SCHEMA IF NOT EXISTS pingpong;

GRANT USAGE ON SCHEMA pingpong TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pingpong
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA pingpong
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 1. 회원 명단 & 부수 테이블 (pingpong.players)
CREATE TABLE IF NOT EXISTS pingpong.players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    grade TEXT NOT NULL DEFAULT '5',
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. 실시간 경기 중계 상태 테이블 (pingpong.live_state)
CREATE TABLE IF NOT EXISTS pingpong.live_state (
    id TEXT PRIMARY KEY DEFAULT 'current',
    is_live BOOLEAN NOT NULL DEFAULT false,
    match_date TEXT,
    title TEXT,
    state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT DEFAULT 'host'
);

INSERT INTO pingpong.live_state (id, is_live, match_date, title, state_json)
VALUES ('current', false, '', '대덕밸리동호회 금요리그', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- 3. 역대 대회 스냅샷 테이블 (pingpong.tournaments)
CREATE TABLE IF NOT EXISTS pingpong.tournaments (
    match_date TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '대덕밸리동호회 금요리그',
    groups_count INT DEFAULT 4,
    match_format TEXT DEFAULT 'bo3',
    results_summary JSONB DEFAULT '[]'::jsonb,
    full_data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. 종합 통계 캐시 테이블 (pingpong.stats_cache)
CREATE TABLE IF NOT EXISTS pingpong.stats_cache (
    id TEXT PRIMARY KEY DEFAULT 'main',
    signature TEXT,
    tourney_count INT DEFAULT 0,
    total_matches INT DEFAULT 0,
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 생성된 모든 테이블에 권한 부여
GRANT ALL ON ALL TABLES IN SCHEMA pingpong TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA pingpong TO anon, authenticated, service_role;

-- =====================================================================
-- 🔓 RLS (Row Level Security) 정책 설정
-- =====================================================================
ALTER TABLE pingpong.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE pingpong.live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pingpong.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pingpong.stats_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "players_all" ON pingpong.players;
CREATE POLICY "players_all" ON pingpong.players FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "live_state_all" ON pingpong.live_state;
CREATE POLICY "live_state_all" ON pingpong.live_state FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tournaments_all" ON pingpong.tournaments;
CREATE POLICY "tournaments_all" ON pingpong.tournaments FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "stats_cache_all" ON pingpong.stats_cache;
CREATE POLICY "stats_cache_all" ON pingpong.stats_cache FOR ALL USING (true) WITH CHECK (true);

-- =====================================================================
-- ⚡ Supabase Realtime (웹소켓 0.1초 실시간 푸시) 활성화
-- =====================================================================
ALTER TABLE pingpong.live_state REPLICA IDENTITY FULL;
ALTER TABLE pingpong.players REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'pingpong' AND tablename = 'live_state'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE pingpong.live_state;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'pingpong' AND tablename = 'players'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE pingpong.players;
    END IF;
END $$;
