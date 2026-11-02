"""
구글 시트(대덕밸리금요리그) + index.html 기본 회원 명단을
Supabase pingpong 스키마 (pingpong.players, pingpong.tournaments, pingpong.stats_cache)로
한 번에 자동 이전(마이그레이션)하는 스크립트입니다. (개별 안전 업서트 버전)
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_SUPABASE_URL = "https://lkltfigaylemgsehkkdg.supabase.co"
DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxrbHRmaWdheWxlbWdzZWhra2RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgwMDM2NzksImV4cCI6MjA3MzU3OTY3OX0.75jPhekoPJfsoeaTPSApbGVhq75ObzdYvYAXT_CBUak"
GAS_URL = "https://script.google.com/macros/s/AKfycbzNkG3ZT9SVvkm5Qxel62eLsYbUHEEB8L2QQMZlY2jN48hKmqELaB8S2mOoL3_qqQOc/exec"


def sb_upsert(sb_url, sb_key, table, row_or_rows, on_conflict):
    url = f"{sb_url.rstrip('/')}/rest/v1/{table}?on_conflict={on_conflict}"
    payload = row_or_rows if isinstance(row_or_rows, list) else [row_or_rows]
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "apikey": sb_key,
            "Authorization": f"Bearer {sb_key}",
            "Accept-Profile": "pingpong",
            "Content-Profile": "pingpong",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


def extract_players_from_index():
    idx_path = Path(__file__).parent / "index.html"
    text = idx_path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{\s*id:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"\s*,\s*grade:\s*("?[^"\s}]+"?)\s*\}'
    )
    players = []
    for i, m in enumerate(pattern.finditer(text), 1):
        pid, name, grade = m.group(1), m.group(2), m.group(3).strip('"')
        players.append(
            {
                "id": pid,
                "name": name,
                "grade": str(grade),
                "sort_order": i,
                "active": True,
            }
        )
    return players


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_SUPABASE_URL)
    parser.add_argument("--key", default=DEFAULT_SUPABASE_KEY)
    args = parser.parse_args()

    print(f"🔗 연결할 Supabase URL: {args.url}")

    # 1. 회원 명단 이전
    players = extract_players_from_index()
    print(f"\n[1/3] 회원 명단 {len(players)}명 Supabase(pingpong.players) 업로드 중...")
    try:
        sb_upsert(args.url, args.key, "players", players, "name")
        print(f"  ✅ 회원 {len(players)}명 이전 완료!")
    except Exception as e:
        print(f"  ❌ 회원 명단 업로드 실패: {e}")
        return

    # 2. 역대 대회 스냅샷 이전 (1건씩 안전하게 업로드)
    print("\n[2/3] 구글 시트에서 역대 대회 목록 조회 중...")
    with urllib.request.urlopen(f"{GAS_URL}?action=getList", timeout=20) as resp:
        list_res = json.loads(resp.read().decode("utf-8"))

    dates = list_res.get("dates") or list_res.get("list") or []
    print(f"  📋 총 {len(dates)}개 대회 발견! 개별 다운로드 및 Supabase 저장 시작...")

    success_count = 0
    for idx, item in enumerate(dates, 1):
        d_str = item["date"] if isinstance(item, dict) else str(item)
        u = f"{GAS_URL}?action=getData&date={urllib.parse.quote(d_str)}"
        try:
            with urllib.request.urlopen(u, timeout=20) as r:
                d_res = json.loads(r.read().decode("utf-8"))
            full_raw = d_res.get("fullData")
            if not full_raw:
                continue
            full_obj = json.loads(full_raw) if isinstance(full_raw, str) else full_raw
            meta = full_obj.get("metadata", {})
            row = {
                "match_date": d_str,
                "title": meta.get("title", "대덕밸리동호회 금요리그"),
                "groups_count": int(meta.get("groupsCount") or 4),
                "match_format": meta.get("matchFormat", "bo3"),
                "full_data": full_obj,
            }
            sb_upsert(args.url, args.key, "tournaments", [row], "match_date")
            success_count += 1
            print(f"    - ({idx}/{len(dates)}) {d_str} 저장 완료 ✅")
        except Exception as err:
            print(f"    - ({idx}/{len(dates)}) {d_str} 저장 중 오류: {err}")

    print(f"  ✅ 총 {success_count}/{len(dates)}개 대회 스냅샷 pingpong.tournaments 이전 완료!")

    # 3. 종합 통계 캐시 이전
    print("\n[3/3] 구글 서버 종합 통계 캐시(stats_cache) 이전 중...")
    try:
        with urllib.request.urlopen(f"{GAS_URL}?action=getStats", timeout=30) as resp:
            stats_res = json.loads(resp.read().decode("utf-8"))

        stats_obj = stats_res.get("stats")
        if stats_obj:
            row = [
                {
                    "id": "main",
                    "signature": stats_obj.get("signature", ""),
                    "tourney_count": stats_obj.get("totalTourneys", 0),
                    "total_matches": stats_obj.get("totalMatches", 0),
                    "stats_json": stats_obj,
                }
            ]
            sb_upsert(args.url, args.key, "stats_cache", row, "id")
            print("  ✅ 종합 통계 캐시(pingpong.stats_cache) 이전 완료!")
    except Exception as e:
        print(f"  ⚠️ 통계 캐시 이전 알림: {e}")

    print("\n🎉 모든 데이터의 Supabase pingpong 스키마 마이그레이션이 완료되었습니다!")


if __name__ == "__main__":
    main()
