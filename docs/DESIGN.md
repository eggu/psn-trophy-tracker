아래 문서를 그대로 작업자/Codex에 전달하면 됩니다.

# PSN Trophy Tracker — 설계 및 구현 지시서

## 1. 프로젝트 목적

PlayStation Network의 사용자 `eggu_` 트로피 데이터를 **PSN에서 직접 수집**하여 다음 두 용도로 제공하는 시스템을 구축한다.

1. 사용자가 브라우저에서 확인할 수 있는 트로피 대시보드
2. ChatGPT를 포함한 AI Agent가 직접 조회할 수 있는 읽기 전용 HTTP API

PSNProfiles, TrueTrophies 등의 제3자 트로피 사이트를 데이터 소스로 사용하지 않는다.

우선순위는 다음과 같다.

1. 무료 플랜 내 운영
2. 안정적인 원격 자동 수집
3. AI Agent가 호출하기 쉬운 API
4. 수집 장애 시 기존 데이터 보존
5. 인증정보의 안전한 관리
6. 유지보수가 단순한 구조
7. 이후 다른 PSN 계정이나 기능으로 확장 가능할 것

---

# 2. 목표 아키텍처

기본 구성은 다음을 우선 채택한다.

```text
PlayStation Network
        │
        │ PSN API
        ▼
GitHub Actions
Collector
        │
        ├─ Full Sync
        ├─ Incremental Sync
        └─ Snapshot 생성
        │
        ▼
Canonical Data
 ├─ current.json
 └─ history/*
        │
        ├────────────────────┐
        ▼                    ▼
Cloudflare Pages       Cloudflare Worker
Dashboard              REST API
                             │
                       /api/v1/*
                             │
                  ChatGPT / AI Agent
```

역할을 명확히 분리한다.

### Collector

GitHub Actions에서 실행한다.

PSN과 통신하는 유일한 구성요소로 한다.

### Canonical Data

Collector가 정상적으로 수집 및 검증한 데이터를 저장한다.

`current.json`을 현재 상태의 Single Source of Truth로 취급한다.

### Dashboard

Canonical Data를 읽어서 사람이 보기 좋은 화면을 제공한다.

Dashboard에서 PSN API를 직접 호출하지 않는다.

### Agent API

Canonical Data를 읽어서 AI Agent가 사용하기 좋은 JSON을 반환한다.

Agent 요청 때문에 PSN API가 호출되어서는 안 된다.

---

# 3. 기술 스택

우선 다음 구성을 검토 및 채택한다.

### Collector

- TypeScript
- Node.js
- `psn-api` 또는 동등한 PSN API client
- GitHub Actions

참고 구현:

`achievements-app/psn-api`

단, 라이브러리를 무조건 신뢰하지 말고 실제 현재 PSN API와 정상 동작하는지 구현 시작 시 검증한다.

### Hosting

우선:

- Cloudflare Pages
- Cloudflare Workers

무료 플랜 내 운영을 목표로 한다.

### Repository

GitHub repository 하나에서 관리하는 것을 기본으로 한다.

예:

```text
/
├─ collector/
├─ dashboard/
├─ worker/
├─ data/
│  ├─ current.json
│  └─ history/
├─ schemas/
├─ tests/
├─ docs/
└─ .github/
   └─ workflows/
```

필요하면 구현 과정에서 구조를 조정할 수 있으나 역할 분리는 유지한다.

---

# 4. PSN 인증

PSN 인증정보를 코드 또는 공개 데이터에 포함하지 않는다.

초기 인증에는 NPSSO 등을 사용할 수 있다.

예:

```text
GitHub Actions Secrets

PSN_NPSSO
```

NPSSO는 비밀번호에 준하는 secret으로 취급한다.

금지:

```text
data/*.json
.env.example 실제 값
Git history
Cloudflare Pages public files
API response
console log
error response
```

등에 NPSSO/access token/refresh token을 노출하지 않는다.

가능하면 다음 구조를 사용한다.

```text
NPSSO
 ↓
Access Token / Refresh Token
 ↓
PSN API
```

장기 운영 시 NPSSO 재발급이 얼마나 자주 필요한지도 확인한다.

인증 만료 시:

- 기존 `current.json` 삭제 금지
- Dashboard 정상 제공
- API 정상 제공
- 데이터가 stale 상태임을 표시
- GitHub Actions 실행은 실패로 표시

하도록 한다.

---

# 5. 수집 대상

최소 다음 정보를 수집한다.

## Profile

- PSN Online ID
- account ID
- trophy level
- progress
- 전체 트로피 수
- platinum
- gold
- silver
- bronze

가능한 경우:

- avatar
- profile image

## Games

각 게임에 대해:

- PSN title ID
- 이름
- 플랫폼
- 이미지
- trophy set version
- 전체 trophy 개수
- 획득 trophy 개수
- completion percentage
- platinum 획득 여부
- 마지막 trophy 획득 시각

## Trophies

각 trophy에 대해:

- trophy ID
- 이름
- 설명
- grade
  - platinum
  - gold
  - silver
  - bronze
- hidden 여부
- 획득 여부
- 획득 시각
- rarity
- trophy icon
- trophy group

PSN API가 제공하지 않는 정보는 억지로 생성하지 않는다.

---

# 6. 동기화 전략

## 최초 실행

Full Sync를 수행한다.

```text
Profile
 ↓
전체 Trophy Titles
 ↓
각 Title의 Trophy Definition
 ↓
각 Title의 Earned Trophy 상태
 ↓
Canonical Snapshot 생성
```

최초 수집은 API 호출량이 많을 수 있으므로 다음을 고려한다.

- pagination
- rate limiting
- retry
- exponential backoff
- concurrency 제한

PSN API에 과도한 동시 요청을 보내지 않는다.

---

# 7. Incremental Sync

최초 Full Sync 이후에는 매번 모든 데이터를 무조건 다시 받지 않는 방향으로 구현한다.

우선:

```text
현재 title 목록 조회
 ↓
current.json과 비교
 ↓
새 게임 탐지
 ↓
최근 변경된 게임 탐지
 ↓
필요한 trophy 상세만 갱신
```

을 검토한다.

다만 PSN API 특성상 변경된 title을 신뢰성 있게 판별하기 어렵다면 초기 버전에서는 단순하고 안전한 동기화를 우선한다.

**잘못된 증분 동기화보다 정상적인 Full Sync를 우선한다.**

최적화는 실제 API 호출량을 측정한 뒤 진행한다.

---

# 8. 실행 주기

초기값:

```text
6시간마다
```

GitHub Actions cron으로 실행한다.

예:

```text
00:00
06:00
12:00
18:00
```

UTC/KST 차이를 명확히 처리한다.

또한 GitHub Actions에서 `workflow_dispatch`를 지원하여 사용자가 수동 동기화를 실행할 수 있도록 한다.

---

# 9. Snapshot

현재 상태:

```text
data/current.json
```

과 history를 분리한다.

예:

```text
data/history/
  2026/
    09/
      2026-09-30T000000Z.json
      2026-09-30T060000Z.json
```

단, 모든 Full Snapshot을 영구 저장하여 repository 크기가 무한히 증가하지 않도록 한다.

초기 보존 정책 제안:

- 최근 30일: 모든 snapshot
- 이후: 일 단위 snapshot
- 장기: 월 단위 snapshot

실제 데이터 크기를 측정한 뒤 조정한다.

---

# 10. 데이터 무결성

새 snapshot을 바로 `current.json`에 덮어쓰지 않는다.

```text
PSN 수집
 ↓
temporary snapshot
 ↓
schema validation
 ↓
consistency validation
 ↓
성공
 ↓
current.json 교체
```

검증 실패 시 기존 `current.json`을 유지한다.

따라서:

**수집 실패가 데이터 손실로 이어져서는 안 된다.**

---

# 11. 데이터 상태

각 snapshot에는 최소 다음 metadata를 포함한다.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-30T03:00:00Z",
  "lastSuccessfulSync": "2026-09-30T03:00:00Z",
  "source": "playstation-network"
}
```

API에서는 별도의 status 정보도 제공한다.

---

# 12. AI Agent API

API prefix:

```text
/api/v1
```

API는 읽기 전용으로 한다.

최소 endpoint:

```text
GET /api/v1/status

GET /api/v1/profile

GET /api/v1/games

GET /api/v1/games/{id}

GET /api/v1/games/{id}/trophies

GET /api/v1/trophies/recent

GET /api/v1/changes
```

필요하면 다음도 추가한다.

```text
GET /api/v1/trophies/{id}

GET /api/v1/summary

GET /api/v1/changes?since=<ISO8601>
```

---

# 13. `/status`

예:

```json
{
  "status": "ok",
  "dataStatus": "fresh",
  "lastSuccessfulSync": "2026-09-30T03:00:00Z",
  "lastSyncAttempt": "2026-09-30T03:00:00Z",
  "ageSeconds": 120,
  "schemaVersion": 1
}
```

수집에 실패했지만 이전 데이터가 존재한다면:

```json
{
  "status": "ok",
  "dataStatus": "stale",
  "lastSuccessfulSync": "...",
  "lastSyncAttempt": "...",
  "ageSeconds": 30000
}
```

API 자체 장애와 데이터 freshness를 구분한다.

---

# 14. `/profile`

AI가 전체 현황을 한 번에 파악할 수 있도록 한다.

예:

```json
{
  "onlineId": "eggu_",
  "trophyLevel": 0,
  "progress": 0,
  "trophies": {
    "total": 0,
    "platinum": 0,
    "gold": 0,
    "silver": 0,
    "bronze": 0
  },
  "games": {
    "total": 0,
    "completed": 0
  },
  "lastSuccessfulSync": "..."
}
```

---

# 15. `/games`

기본적으로 전체 game summary를 반환한다.

query parameter를 고려한다.

예:

```text
?completed=true
?platform=PS5
?sort=recent
?limit=20
?offset=0
```

AI Agent가 지나치게 큰 JSON을 받을 필요가 없도록 pagination/filtering을 지원한다.

---

# 16. `/games/{id}`

게임 하나의 진행 상황을 반환한다.

예:

```json
{
  "id": "...",
  "name": "SILENT HILL f",
  "platform": ["PS5"],
  "progress": {
    "earned": 38,
    "total": 43,
    "percentage": 88
  },
  "platinumEarned": false,
  "lastTrophyAt": "...",
  "trophySummary": {
    "platinum": {},
    "gold": {},
    "silver": {},
    "bronze": {}
  }
}
```

---

# 17. `/games/{id}/trophies`

게임별 trophy 목록을 반환한다.

filter를 지원한다.

```text
?earned=true
?earned=false
?grade=gold
?hidden=true
```

AI가

> 사일런트 힐 f에서 안 딴 트로피 알려줘

같은 요청을 처리할 때 전체 데이터를 다시 받을 필요가 없도록 한다.

---

# 18. `/trophies/recent`

최근 획득 trophy를 반환한다.

예:

```text
?limit=10
?since=2026-09-29T00:00:00Z
```

기본값:

```text
limit=20
```

---

# 19. `/changes`

AI Agent 활용에서 특히 중요한 endpoint다.

직전 snapshot 또는 지정 시각 이후 변경점을 계산한다.

예:

```json
{
  "from": "...",
  "to": "...",

  "summaryDelta": {
    "total": 3,
    "platinum": 0,
    "gold": 1,
    "silver": 1,
    "bronze": 1
  },

  "newTrophies": [],

  "changedGames": [
    {
      "id": "...",
      "name": "SILENT HILL f",
      "previous": {
        "earned": 35,
        "total": 43
      },
      "current": {
        "earned": 38,
        "total": 43
      }
    }
  ]
}
```

이 endpoint를 통해 AI가

> 지난번 이후 트로피 현황

을 매우 적은 데이터 전송으로 분석할 수 있어야 한다.

---

# 20. API 응답 원칙

모든 응답은 다음 원칙을 따른다.

- ISO 8601 timestamp
- UTF-8
- stable field naming
- 명시적 schema version
- HTTP status code 준수
- 예측 가능한 error schema

예:

```json
{
  "error": {
    "code": "GAME_NOT_FOUND",
    "message": "Requested game was not found."
  }
}
```

내부 stack trace나 인증정보를 반환하지 않는다.

---

# 21. API 인증

1차 버전에서는 API 데이터가 공개되어도 문제가 없는지 검토한다.

트로피 정보만 제공한다면 public read-only API로 시작할 수 있다.

단:

- PSN token
- NPSSO
- 이메일
- 기타 PSN 계정 개인정보

는 절대 API에 노출하지 않는다.

추후 필요하면:

```text
Authorization: Bearer <API_TOKEN>
```

형태를 지원할 수 있도록 구조적으로 확장 가능하게 한다.

AI Agent 호출 편의성을 고려하여 초기부터 과도한 인증 체계를 만들지는 않는다.

---

# 22. CORS

API는 일반 HTTP client뿐 아니라 필요한 웹 client에서도 사용할 수 있도록 CORS를 명시적으로 설정한다.

Public API라면 필요한 범위에서:

```text
Access-Control-Allow-Origin
```

정책을 정의한다.

무조건적인 wildcard 적용 여부는 실제 Dashboard/API 구조를 보고 결정한다.

---

# 23. Cache

Cloudflare edge caching을 적극 활용한다.

Canonical snapshot이 6시간마다 갱신되므로 대부분의 API 요청에서 PSN 또는 GitHub에 실시간 접근할 필요가 없다.

적절한:

```text
Cache-Control
ETag
Last-Modified
```

사용을 검토한다.

---

# 24. Rate Limit

Public API 악용을 막기 위한 가벼운 rate limit을 고려한다.

그러나 정상적인 ChatGPT/AI Agent 호출이 불편해질 정도로 낮게 설정하지 않는다.

무료 Cloudflare 한도 안에서 운영 가능한 수준으로 설정한다.

---

# 25. Dashboard

Dashboard 최소 화면:

## Overview

- Online ID
- Trophy Level
- Platinum
- Gold
- Silver
- Bronze
- Total trophies
- 등록 게임 수
- 완료 게임 수
- 마지막 동기화 시각

## Recent Activity

최근 획득 trophy를 표시한다.

## Games

게임 목록:

```text
게임
플랫폼
획득 / 전체
완료율
Platinum 여부
마지막 활동
```

## Game Detail

게임 선택 시:

- trophy progress
- grade별 현황
- 획득 trophy
- 미획득 trophy
- 획득 시각
- rarity
- hidden trophy

등을 표시한다.

---

# 26. 모바일 대응

PC뿐 아니라 모바일 브라우저에서도 사용할 수 있도록 responsive UI로 구현한다.

복잡한 시각화보다:

- 빠른 로딩
- 명확한 진행률
- 최근 활동
- 남은 trophy

확인을 우선한다.

---

# 27. 장애 처리

PSN API 장애:

```text
기존 current.json 유지
Dashboard 정상 제공
API 정상 제공
dataStatus = stale
```

인증 만료:

```text
수집 실패
기존 snapshot 유지
Action failure 표시
```

Cloudflare 장애:

Canonical data는 GitHub에 남아 있어야 한다.

GitHub Actions 장애:

마지막 정상 데이터로 서비스가 계속 동작해야 한다.

즉 Collector와 Serving 계층을 분리한다.

---

# 28. Logging

Collector에서 다음을 기록한다.

- sync 시작/종료
- API 요청 성공/실패
- 처리 game 수
- 처리 trophy 수
- snapshot validation 결과
- 전체 수행시간

절대 기록하지 않는 것:

- NPSSO
- access token
- refresh token
- Authorization header

---

# 29. Monitoring

최소한 GitHub Actions 실패 여부를 통해 동기화 장애를 확인할 수 있어야 한다.

Dashboard에도 다음을 표시한다.

```text
Last synced:
Data status:
```

예:

```text
Last synced: 2026-09-30 12:00 KST
Data status: Fresh
```

또는

```text
Last successful sync: 2026-09-29 18:00 KST
Data status: Stale
```

---

# 30. 테스트

최소 다음 테스트를 작성한다.

## Collector

- PSN response parsing
- pagination
- trophy merge
- snapshot 생성
- 이전 snapshot 비교
- malformed response
- network failure

## API

- profile
- games
- game detail
- recent trophies
- changes
- invalid ID
- pagination
- stale snapshot

## Data

JSON Schema 또는 동등한 schema validation을 사용한다.

---

# 31. 배포

목표:

```text
GitHub
 ├─ Actions
 └─ Canonical Data

Cloudflare
 ├─ Pages
 └─ Worker/API
```

가능하면 하나의 Cloudflare domain 아래:

```text
https://<project>.pages.dev/

https://<project>.pages.dev/api/v1/profile
https://<project>.pages
