# 구현된 설계 및 운영 기준

2026-09-30 P0/P1/P2 수정 기준. 공개 데이터의 최종 상태와 검증 수치는 `VERIFICATION.md`를 참조합니다.

## 데이터 경로

```text
PSN (Actions Secret로 인증)
  → collector/src/index.ts
  → parser.ts + trophies.ts + localization.ts
  → storage.ts 검증/원자 교체
  → data/current.json + data/history/YYYY/MM/*.json
  → GitHub data commit
  → Pages Git build (scripts/build-pages.mjs)
  → dashboard/dist/ 정적 파일 + /functions Pages Functions
  → dashboard/app.js / worker/src/router.ts
```

Collector만 PSN에 접근합니다. Dashboard/API 요청이 PSN 호출을 유발하지 않습니다. Serving은 같은 Pages 배포의 ASSETS binding을 사용하므로 독립 Worker origin에 `/data/current.json`을 요청하는 순환·404 문제가 없습니다.

## Collector

Title 발견 → 명시적인 npServiceName 선택 → 모든 Definition 페이지 → 모든 Earned 페이지 → trophy ID 병합 → 한국어·영어 metadata 또는 cache 결합 → canonical game → snapshot 검증 순서입니다.

PSN API URL은 두 플랫폼 모두 `/api/trophy/v1/`입니다. PS5/legacy 차이는 `npServiceName=trophy2/trophy`입니다. Title 응답 값을 우선 사용합니다. PS4/PS3/Vita에서는 생략하지 않습니다.

원본 trophy ID, grade, earned, earnedAt, groupId는 유지합니다. Trophy title의 `lastUpdatedDateTime`과 개별 `earnedDateTime`은 서로 다른 값이며 임의로 같게 만들지 않습니다.

캐시 재사용에는 version, total, earned, lastUpdated, 상세 수량을 확인합니다. `PSN_FULL_SYNC=true`는 원본 Definition/Earned 재조회만 강제합니다. 두 locale metadata는 version 캐시를 계속 사용합니다.

Snapshot schema는 선택적 localized/cache 필드를 추가한 v1입니다. 기존 snapshot도 읽을 수 있습니다. 상세 0개/중복 ID는 저장 실패, summary/detail 차이는 warning입니다. PSN 응답 error body와 pagination 중간 빈 페이지는 성공으로 취급하지 않습니다. 기존 snapshot을 삭제하지 않습니다.

## Localization

게임: `localized["ko-KR"].name`.

트로피: `localized[locale].name`, `.description`. 두 locale은 ko-KR/en-US입니다. API는 영어 우선 name/description, 원문 originalName/originalDescription, 두 localized 필드를 함께 반환합니다. Dashboard는 한국어 우선입니다.

게임 cache: `localization[locale] = { trophySetVersion, checkedAt, status }`.

PSN Definition과 Trophy Groups에 `Accept-Language: ko-KR` 및 `en-US`를 전달합니다. 반환 version과 trophy ID 집합이 원본과 일치하는지 확인합니다. 한국어가 실제 관찰되는 응답만 available로 저장합니다. PSN은 locale 지원 여부를 명시하지 않으므로 영어만 반환한 경우 fallback이며 한국 발매 여부를 추정하지 않습니다.

새 title/version/ID 변경에서만 재조회합니다. Available/fallback 모두 캐시하지만 network/API 실패는 캐시하지 않습니다. Localization 실패는 이미 정상 수집한 trophy snapshot을 막지 않습니다. 원문은 유지하고 표시 함수만 한국어를 우선합니다.

## History와 changes

History index는 build에서 archive JSON의 timestamp/path만 읽어 생성합니다. API runtime은 current + index + 선택한 history 1개만 읽습니다. 기준 선택은 current 미만 timestamp 중 직전 또는 since 이하 최근 snapshot입니다. Since 이전에 보존 데이터가 없다면 최초 보존 snapshot을 사용하며 실제 `from`을 반환합니다.

빈 과거 상세를 복구한 경우 이전 sync보다 오래된 earnedAt을 신규 획득으로 세지 않습니다. Group/DLC trophy ID는 title 안에서 유일합니다. Invalid since는 400, missing index/snapshot은 503으로 실패를 드러냅니다.

History 자동 pruning은 미구현입니다. 삭제 대신 모든 archive를 보존하고 빌드 시 정적 asset으로 복사합니다. API는 매 요청에 archive 전체를 읽지 않습니다.

## 배포

Pages project `psn-trophy-tracker`, Git repo `eggu/psn-trophy-tracker`, branch `main`.

빌드: `npm run build:dashboard`. 출력: `dashboard/dist`. `wrangler.toml`은 Pages 설정입니다. Data commit에는 `[skip ci]`를 넣지 않아 매 sync가 Pages 배포로 이어집니다. GitHub workflow는 push trigger가 없어 자체 commit으로 sync 루프가 생기지 않습니다. Functions는 `/api/*`에만 적용되며 router는 기존 worker 모듈을 재사용합니다. 독립 Worker는 주 서비스에 필요하지 않습니다.

Cron은 6시간 간격 UTC 00/06/12/18입니다. Actions의 수동 입력 full/diagnose/localization_probe로 전체 수집과 저장 없는 재현을 선택합니다. 인증 만료 시 Secret을 갱신한 뒤 수동 sync로 확인합니다. Token/NPSSO/Authorization header를 로그 또는 공개 데이터에 넣지 않습니다.

## 검증

`npm test`는 먼저 Pages assets를 빌드하고 parser, real PS4 fixture, 양쪽 service 전달, 페이지 병합, 실패 시 이전 데이터 보존, history 기준 선택/최대 조회 수, Korean 원문 보존·version cache·fallback·ID mismatch를 확인합니다.

`npx tsc --noEmit`으로 schemas/collector/worker/functions/tests 타입을 검사합니다. 실제 PSN Full Sync와 외부 HTTP acceptance는 별도 근거이며 단위 테스트 성공으로 대체하지 않습니다.
