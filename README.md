# PSN Trophy Tracker

PSN 사용자 `eggu_`의 게임·트로피를 공식 PSN API에서 수집해 대시보드와 읽기 전용 Agent API로 제공합니다.

- Dashboard: https://psn-trophy-tracker.pages.dev/
- Canonical JSON: https://psn-trophy-tracker.pages.dev/data/current.json
- API: https://psn-trophy-tracker.pages.dev/api/v1

## 구성

GitHub Actions Collector → 검증된 `data/current.json` / `data/history/` → Cloudflare Pages 정적 파일 + Pages Functions.

`functions/api/[[path]].ts`는 기존 `worker/src/router.ts`를 재사용합니다. Functions는 `env.ASSETS.fetch()`로 같은 배포의 JSON을 읽습니다. 별도 Worker 배포, KV, PSN 인증정보는 serving 계층에 필요하지 않습니다.

## 실행과 운영

Node.js 22 이상:

```sh
npm ci
npm test
npx tsc --noEmit
npm run build:dashboard
npx wrangler pages dev dashboard/dist
```

Pages Git 연동 빌드 명령은 `npm run build:dashboard`, 출력 폴더는 `dashboard/dist`, production branch는 `main`입니다. `wrangler.toml`도 같은 출력 폴더를 지정합니다. Functions는 저장소 루트의 `functions/`에서 자동 빌드됩니다. `_routes.json`은 `/api/*`만 Functions로 보내고 정적 파일은 직접 제공합니다.

Collector는 UTC 00/06/12/18시(KST 09/15/21/03시)에 실행됩니다. NPSSO는 GitHub Actions Secret `PSN_NPSSO`로만 전달합니다. 로컬 실행은 안전하게 설정한 `PSN_NPSSO` 환경변수가 필요합니다. 인증정보를 코드·로그·JSON에 넣지 않습니다.

```sh
npm run collect
PSN_FULL_SYNC=true npm run collect

gh workflow run sync.yml                     # 증분 sync
gh workflow run sync.yml -f full=true        # 전체 Definition/Earned 재조회
gh workflow run sync.yml -f diagnose=true    # Code Veronica API 재현, 저장 안 함
gh workflow run sync.yml -f localization_probe=true  # 한국어 응답 점검, 저장 안 함
```

Actions는 테스트 → 수집 → 검증 → data commit/push 순서로 실행합니다. Git 연동 Pages가 새 commit을 배포합니다. 데이터 commit에 `[skip ci]`를 붙이지 않습니다(Cloudflare 배포도 건너뛰므로). 진단 응답은 `psn-diagnostics` artifact로 내려받을 수 있습니다. 토큰과 Authorization header는 포함하지 않습니다.

## 수집과 검증

- Title의 `npServiceName`을 두 상세 API에 그대로 전달합니다. 없는 경우 PS5는 `trophy2`, PS4/PS3/Vita는 `trophy`를 사용합니다.
- `all` trophy group을 모든 페이지에 걸쳐 조회해 기본·DLC 트로피를 병합합니다. API error body와 불완전한 pagination을 실패로 처리합니다.
- 변경 없는 title은 상세를 재사용합니다. Version, 전체·획득 수, 마지막 갱신 시각, 상세 완전성을 확인합니다.
- `progress.total > 0`인데 상세가 비었거나 ID가 중복되면 새 snapshot 저장을 거부합니다. Summary와 상세의 전체·등급별 수량 차이는 명시적으로 경고합니다. PSN의 summary/definition 버전 차이 때문에 정상 DLC title 전체 sync를 막지 않기 위한 정책입니다.
- 실패하면 이전 `current.json`을 보존합니다. 수집에 성공한 snapshot만 history에 기록하고 current를 원자적으로 교체합니다.

## 공식 영어·한국어 metadata

`Accept-Language: ko-KR` 및 `en-US`로 trophy definitions와 trophy groups(게임명)를 요청합니다. 기계번역과 외부 출시 DB는 사용하지 않습니다.

원본 `name` / `description`은 유지하고 공식 응답을 `localized["ko-KR"]`, `localized["en-US"]`에 각각 저장합니다. Dashboard는 한국어 우선, 없으면 원문을 표시합니다. API 기본 `name` / `description`은 영어 우선이며 `originalName` / `originalDescription`과 두 localized 필드를 함께 반환합니다. AI가 영어로 탐색하고 사용자에게 한국어로 안내할 수 있습니다. PSN이 영어 요청에도 지역 원문을 반환하는 trophy set은 해당 공식 응답을 그대로 보존하며 번역하지 않습니다.

`localization[locale]`은 trophy set version, 확인 시각, `available` / `fallback` 상태를 기록합니다. 성공한 지원·fallback 결과 모두 version별로 재사용합니다. 새 title, version 변경, trophy ID 변경 시 재조회하며 일시적인 요청 실패는 캐시하지 않아 다음 sync에 재시도합니다. Full Sync도 변경 없는 한국어 캐시는 재사용합니다.

PSN은 지원 locale 목록이나 `Content-Language`를 제공하지 않습니다. `ko-KR` 요청에 반환된 실제 한글을 확인한 경우만 한국어 지원으로 기록합니다. 한글이 관찰되지 않은 응답은 원문 fallback으로 분류합니다. 게임 브랜드명이 영어로 유지되더라도 한국어 트로피가 있으면 해당 공식 응답을 저장합니다.

## Agent API

| GET endpoint | 설명 |
|---|---|
| `/status` | 마지막 성공 sync, fresh/stale(12시간 기준) |
| `/profile` | 계정 트로피·게임 요약 |
| `/games?limit=5` | 목록; platform, completed, sort, limit, offset |
| `/games/{id}` | 게임 요약과 localized metadata |
| `/games/{id}/trophies` | 상세 목록; earned, grade, hidden |
| `/trophies/recent?limit=5` | 최근 획득; limit, since |
| `/changes` | 직전 snapshot 대비 변경 |
| `/changes?since=<ISO8601>` | since 시각 이하에서 가장 최근 snapshot과 비교 |

`/changes`는 빌드 시 생성한 `/data/history/index.json`에서 기준 하나를 선택하고 그 snapshot만 읽습니다. 매 요청에 history 전체를 다운로드하지 않습니다. Current와 같은 timestamp는 비교 기준에서 제외합니다. Since가 보존된 최초 snapshot보다 이르면 최초 snapshot을 기준으로 반환하므로 응답 `from`을 확인하십시오. History가 처음부터 없으면 초기 전체 현황을 반환합니다. Invalid since는 400, JSON 로딩 실패는 503입니다.

과거 빈 상세의 복구는 획득 시각이 기준 sync 이후인 경우만 신규 획득으로 셉니다. API 응답 cache는 browser 60초 / shared 300초입니다. History 보존·정리는 아직 자동화하지 않았습니다.

실제 외부 API를 다시 검증하려면 `node scripts/verify-api.mjs`를 실행합니다. HTTP status, Code Veronica 수량, history 기준, Korean metadata를 검사하고 `docs/p1-acceptance.json`을 갱신합니다.

검증 근거: [P0](docs/P0-VERIFICATION.md), [플랫폼별 영향](docs/p0-impact.json), [실제 API acceptance](docs/p1-acceptance.json), [운영 설계](docs/DESIGN.md).
