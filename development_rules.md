# Development Safety Guidelines (개발 안전 가이드라인)

이 문서는 `index.html`과 같은 단일 파일 프로젝트를 수정할 때, 기존 기능의 파손(Regression)을 방지하고 안전하게 작업하기 위한 규칙을 정의합니다.

## 1. 수정 방식 (Edit Strategy)
- **Surgical Edits (부분 수정)**:
  - 함수 전체를 교체(`replace_file_content`로 수백 라인 교체)하는 것을 지양합니다.
  - 변경이 필요한 **최소한의 로직 블록**만 타겟팅하여 수정합니다.
  - *이유*: 전체 교체 시, 제가 인지하지 못한 미세한 수정 사항(User가 직접 고친 공백, 주석, 사소한 스타일 등)이 덮어씌워질 위험이 큽니다.

- **Context Verification (문맥 확인)**:
  - 수정하려는 코드의 **시작과 끝** 라인뿐만 아니라, 그 주변(상위 닫는 괄호 `}`, 인접한 CSS 등)을 반드시 확인합니다.
  - *이유*: 닫는 괄호를 실수로 삭제하거나, 인접한 CSS 규칙을 건드려 스타일이 깨지는 것을 방지합니다.

## 2. 영향 범위 분석 (Impact Analysis)
- **Shared Resources Check**:
  - CSS 클래스(예: `.tm-lines`), 전역 변수, 공통 유틸리티 함수를 수정할 때는 해당 요소를 사용하는 **다른 기능**이 있는지 `grep`으로 검색합니다.
  - *이유*: 랭킹 팝업을 위한 CSS 수정이 토너먼트 대진표의 선 스타일(공유 클래스 사용)에 영향을 주는 사태를 방지합니다.

## 3. 모듈화 제안 (Proactive Modularization)
- **File Separation**:
  - 로직이 복잡해지거나 100라인 이상 추가될 경우, 기존 파일에 구겨 넣기보다는 **새로운 JS/CSS 파일로 분리**하는 것을 최우선으로 제안합니다.
    - 예: `ranking_logic.js`, `ranking_popup.css`
  - *이유*: 파일이 분리되면 기존 `index.html`을 건드릴 확률이 0에 수렴하여 가장 안전합니다.

## 4. 복구 및 검증 (Recovery & Verification)
- **Post-Edit Verification**:
  - 수정 후에는 반드시 관련 없는 기능(예: 랭킹 수정 후 토너먼트 뷰)이 정상인지 체크리스트를 통해 확인합니다.
