# PSN Trophy Tracker

PlayStation Network 사용자(`eggu_`)의 트로피 데이터를 PSN 공식 API를 통해 직접 수집하고, **브라우저 대시보드** 및 **AI Agent (ChatGPT 등) 전용 REST API**로 제공하는 프로젝트입니다.

---

## 1. 아키텍처 개요

- **Collector (`collector/`)**: GitHub Actions에서 6시간마다 실행되어 PSN API로부터 프로필, 게임 및 트로피 정보를 안전하게 수집 및 검증하고 `data/current.json` 및 `data/history/`에 저장합니다.
- **Canonical Data (`data/`)**: 단일 진실 공급원(SSOT) 역할을 하며, 검증에 통과된 스냅샷만 원자적으로 반영됩니다.
- **Dashboard (`dashboard/`)**: Cloudflare Pages 정적 호스팅을 통해 모바일 및 데스크톱 반응형 대시보드를 제공합니다.
- **Agent API (`worker/`)**: Cloudflare Workers 기반의 고속 Edge REST API (`/api/v1/*`)를 제공하여 ChatGPT/AI Agent가 토큰을 절약하며 읽기 전용으로 질의할 수 있습니다.

---

## 2. Agent API 엔드포인트 사양 (`/api/v1`)

| Method | Endpoint | 설명 |
|---|---|---|
| `GET` | `/api/v1/status` | 동기화 상태, 데이터 신선도(`fresh` / `stale`) 및 경과 시간 반환 |
| `GET` | `/api/v1/profile` | PSN 레벨, 프로필 요약 및 등급별 트로피 총합 |
| `GET` | `/api/v1/games` | 게임 목록 (지원 쿼리: `platform`, `completed`, `sort`, `limit`, `offset`) |
| `GET` | `/api/v1/games/{id}` | 특정 게임 단건 진행 상황 상세 |
| `GET` | `/api/v1/games/{id}/trophies` | 게임의 트로피 목록 (지원 쿼리: `earned`, `grade`, `hidden`) |
| `GET` | `/api/v1/trophies/recent` | 최근 획득 트로피 목록 (지원 쿼리: `limit`, `since`) |
| `GET` | `/api/v1/changes` | 최근 동기화 간 변경 내역 (새로 딴 트로피, 변경된 게임 진행률) |

---

## 3. 로컬 개발 및 실행

### 필수 요구사항
- Node.js 20+

### 테스트 실행
```bash
npm test
```

### 수집기 수동 실행 (로컬)
```bash
export PSN_NPSSO="YOUR_NPSSO_COOKIE"
export PSN_TARGET_ONLINE_ID="eggu_"
npm run collect
```

### 대시보드 로컬 확인
정적 파일 서버(예: `npx serve .`)를 실행한 후 `dashboard/index.html`을 확인합니다.
