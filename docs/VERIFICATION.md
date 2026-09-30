# PSN Trophy Tracker 수정 완료 보고

검증일: 2026-09-30. 기존 Collector/parser/router/Dashboard를 유지하여 수정했습니다. 최종 상세 HTTP 기록은 [p1-acceptance.json](p1-acceptance.json)에 있습니다.

## P0

근본 원인: title 응답에 있던 `npServiceName: trophy`를 버리고 legacy 요청에 undefined를 전달했습니다. 실제 NPWR12310_00 응답에서 service 생략 시 Definition/Earned 모두 HTTP 404, trophy 지정 시 모두 HTTP 200을 재현했습니다. Definition 호출은 error body를 반환하고 Earned 호출은 예외를 던집니다. 기존 catch가 빈 배열로 fallback하고 schema만 검증하여 잘못된 snapshot을 성공으로 저장했습니다.

[재현 Actions](https://github.com/eggu/psn-trophy-tracker/actions/runs/36669365362), [client API 문서](https://psn-api.achievements.app/api-docs/title-trophies), [상세 원인 기록](P0-VERIFICATION.md).

수정 파일:

- `collector/src/index.ts`: title service 전달, full sync, cache 완전성, 단계 로그, malformed title page 거부.
- `collector/src/parser.ts`: title service 우선 선택, ID 타입 정규화 병합.
- `collector/src/trophies.ts`: all-group pagination 및 error/malformed 응답 거부.
- `collector/src/storage.ts`: 빈 상세/중복 ID 저장 거부, summary/detail 불일치 warning.
- `collector/scripts/diagnose.ts`, `.github/workflows/sync.yml`: 저장 없는 실제 응답 재현 및 Full Sync.
- `tests/collector.test.ts`, `tests/collector-api.test.ts`, `tests/fixtures/veronica-ps4.json`: 실제 PS4 fixture와 PS4/PS5 호출 경로 회귀 검증. 기존 PS5 parser/API tests 유지.

영향받던 게임 수: **77 / 168**. 수정 후 누락: **0**.

| 플랫폼 | 영향 |
|---|---:|
| PS5 | 0 |
| PS4 | 65 |
| PS3 | 12 |
| PS Vita | 1 |

PS4/Vita 공용 타이틀 1개가 중복 집계되어 플랫폼 합은 78입니다. 대표 ID: PS4 NPWR12310_00, PS3 NPWR04712_00, PS4/Vita NPWR16040_00. 전체 ID 목록은 [p0-impact.json](p0-impact.json)에 보존했습니다.

Code: Veronica trophies: **30/30**.

Code: Veronica earned: **9/30**.

| 등급 | 전체 | 획득 |
|---|---:|---:|
| Platinum | 1 | 0 |
| Gold | 5 | 0 |
| Silver | 10 | 3 |
| Bronze | 14 | 6 |
| 합계 | 30 | 9 |

개별 trophy의 마지막 earnedAt `2026-09-29T15:09:01Z`와 title의 lastUpdated `2026-09-29T15:09:05Z`를 각각 그대로 보존했습니다.

Tests: **30 tests passed**, `npx tsc --noEmit` 통과, Pages build 통과. 등급·획득 상태·timestamp·pagination·저장 실패 시 이전 current 보존·DLC count warning·API/history/localization을 검증했습니다. 테스트의 의도적인 불일치 fixture와 optional locale 실패 로그를 실제 수집 장애와 구분합니다.

Full Sync: [Actions 36669641884](https://github.com/eggu/psn-trophy-tracker/actions/runs/36669641884) **success**. 168개 전수 수집, 94.23초, snapshot `2026-09-30T04:38:45.796Z`. 모든 상세 total 및 등급별 earned/total이 summary와 일치합니다. 최종 snapshot에서도 168개 전체 불일치 0, 획득 합계 2455와 profile 합계가 일치합니다.

## P1

Dashboard URL: https://psn-trophy-tracker.pages.dev/

API base URL: https://psn-trophy-tracker.pages.dev/api/v1

| 실제 외부 요청 | HTTP | 결과 |
|---|---:|---|
| `/` | 200 | Dashboard |
| `/data/current.json` | 200 | Canonical snapshot |
| `/api/v1/status` | 200 | fresh / sync timestamp |
| `/api/v1/profile` | 200 | eggu_ profile |
| `/api/v1/games?limit=5` | 200 | total 168, 5개 반환 |
| `/api/v1/trophies/recent?limit=5` | 200 | total 2455, 5개 반환 |
| `/api/v1/games/NPWR12310_00` | 200 | total 30 / earned 9 |
| `/api/v1/games/NPWR12310_00/trophies` | 200 | total 30, 상세 30개 |
| `/api/v1/changes` | 200 | 직전 실제 snapshot 비교 |
| `/api/v1/changes?since=2026-09-30T04:00:00Z` | 200 | 기준 03:59:20.473Z, 신규 획득 0 |
| `/api/v1/changes?since=2026-09-30T04:58:00Z` | 200 | 기준 04:57:33.259Z, 가장 가까운 이전 snapshot 선택 |

Pages Functions가 기존 router를 사용합니다. `env.ASSETS`로 current/index/선택한 과거 snapshot을 읽습니다. `/changes` 요청당 current 1개, timestamp/path index 1개, 과거 snapshot 최대 1개입니다. Runtime에 history 전체를 로딩하지 않습니다. 과거 빈 상세 복구를 신규 획득으로 오인하지 않습니다.

수정 파일: `functions/api/[[path]].ts`, `worker/src/index.ts`, `worker/src/router.ts`, `worker/src/history.ts`, `collector/src/diff.ts`, `scripts/build-pages.mjs`, `wrangler.toml`, `tests/pages.test.ts`, `scripts/verify-api.mjs`.

실제 Pages 빌드 설정을 Orca CLI로 `npm run build:dashboard` / `dashboard/dist`로 변경하고 성공 배포를 확인했습니다. 원래 sync commit의 `[skip ci]`가 Cloudflare 배포도 건너뛰는 문제를 제거했습니다.

P2 한국어 최초 검증 당시 자동 sync [Actions 36671606209](https://github.com/eggu/psn-trophy-tracker/actions/runs/36671606209) → data commit `ed4400b` → [Cloudflare Pages deployment 02097c14](https://dash.cloudflare.com/09350cc1b363d188b748490a00f05e2f/pages/view/psn-trophy-tracker/02097c14-2f73-421e-ac34-bdea8dee2b84) **success**를 확인했습니다. 당시 Production canonical timestamp `2026-09-30T05:05:19.239Z`입니다.

## P2

한국어 metadata 수집 방식: 공식 PSN Definition / Trophy Groups API에 `Accept-Language: ko-KR`를 전달합니다. Trophy 이름·설명은 Definition, 게임명은 Groups 응답을 사용합니다. Version과 trophy ID 집합을 검증하고 원본과 별도 `localized["ko-KR"]`에 저장합니다. 기계번역·외부 출시 DB 없음.

ko-KR 지원 게임 수: **146 / 168**.

fallback 게임 수: **22 / 168**. 요청 실패/미확인 게임: **0**.

PSN은 지원 locale flag나 Content-Language를 반환하지 않습니다. 위 지원 수는 ko-KR 요청에서 실제 한글 metadata가 관찰된 title 수이며, fallback은 해당 응답에 한국어가 관찰되지 않은 경우입니다. 원문 반환을 한국 출시 여부로 해석하지 않습니다.

대표 검증 게임:

- STAR WARS Zero Company → 게임명 **스타워즈 제로 컴퍼니™**, 트로피 **제로 컴퍼니의 전설**, 설명 **다른 모든 트로피를 완료했습니다.**. Orca browser 실제 모달에서 공식 한국어와 53개 상세 표시 확인.
- SILENT HILL f → **둥지를 떠나는 새끼 새에게 영광 있으라**, 설명 **모든 트로피를 획득했다.**. 실제 PSN ko/en 응답 fixture 및 API 검증.
- Clair Obscur: Expedition 33 → **사상 최고의 원정대**, 설명 **모든 트로피를 획득합니다.**. 게임명은 공식 응답의 영문 브랜드명을 유지.
- Code: Veronica → 원문 fallback, Orca 실제 모달에서 **Slayer of Evil**, 상세 30개/earned 9개 확인.

캐시 정책: available/fallback 모두 trophy set version별 캐시. 새 title·version·ID 집합 변경 시 재조회, 실패한 요청은 캐시하지 않고 다음 sync에 재시도. 변경 없는 기존 localization은 Full Sync에서도 재사용.

실제 첫 수집 [Actions 36671019633](https://github.com/eggu/psn-trophy-tracker/actions/runs/36671019633) **success**, 83.97초. 이어 [cache 재사용 Actions 36671323974](https://github.com/eggu/psn-trophy-tracker/actions/runs/36671323974)에서 **168/168 cached**, Collector 1.94초. 최종 자동 sync도 1.54초. 원본 name/description/ID/grade/earned/earnedAt이 P0 Full Sync snapshot과 동일함을 전수 비교했습니다.

수정 파일: `collector/src/localization.ts`, `collector/src/index.ts`, `schemas/index.ts`, `dashboard/app.js`, `collector/scripts/localization-probe.ts`, `tests/localization.test.ts`, `tests/fixtures/silent-hill-f-ko.json`.

README.md, DESIGN.md, docs/DESIGN.md를 실제 Pages 구조·수집·cache·validation·history 동작에 맞게 갱신했습니다. History 자동 pruning은 추가하지 않았으며 기존 archive를 보존합니다.


## 추가: 영어·한국어 동시 저장 및 Agent API

공식 Definition/Groups를 `Accept-Language: en-US`로 추가 요청하고 원본을 변경하지 않은 채 `localized["en-US"]`에 저장했습니다. 한국어·영어 각각 독립적인 version 캐시를 사용합니다. 기존 단일 locale cache는 schema read에서 새 형식으로 변환합니다.

실제 영어 수집 [Actions 36673037998](https://github.com/eggu/psn-trophy-tracker/actions/runs/36673037998) **success**, 89.59초. **168개 게임 / 8413개 트로피**에 en-US 응답 저장. ko-KR은 기존 **146개 지원 / 22개 fallback** 유지, 실패/미확인 0. 영어 요청에도 지역 원문이 반환된 4개 세트는 fallback으로 표시하면서 en-US 요청 응답을 그대로 저장합니다. 따라서 실제 영어 응답은 164개, 지역 언어 fallback은 4개입니다. PSN 공식 응답을 기계번역하지 않습니다.

실제 cache 검증 [Actions 36673262935](https://github.com/eggu/psn-trophy-tracker/actions/runs/36673262935) **success**, 2.04초. 실제 Collector 로그 기준 **ko-KR 168 cached + en-US 168 cached**. 테스트 mock 로그를 수집 집계에 포함하지 않았습니다.

모든 168개 title의 원본 name/description/ID/grade/earned/earnedAt/progress가 P0 Full Sync snapshot과 동일한 것을 전수 비교했습니다. API는 영어 우선 `name`/`description`, `originalName`/`originalDescription`, `localized["en-US"]`/`localized["ko-KR"]`를 함께 제공합니다. 한국어가 없는 22개는 status=fallback이며 한국어를 만들어내지 않습니다. Dashboard는 한국어 우선/원문 fallback을 유지합니다.

SILENT HILL f의 실제 API 예:

```json
{
  "name": "I Still Have Wings",
  "description": "Obtained all trophies.",
  "localized": {
    "en-US": { "name": "I Still Have Wings", "description": "Obtained all trophies." },
    "ko-KR": { "name": "둥지를 떠나는 새끼 새에게 영광 있으라", "description": "모든 트로피를 획득했다." }
  }
}
```

## 추가: pages.dev 외부 접근/CORS

`functions/api/[[path]].ts`와 `_routes.json`의 `/api/*` 범위에서 router를 재사용합니다. 성공/오류 응답 JSON 헤더와 preflight에 `Access-Control-Allow-Origin: *`, methods GET/HEAD/OPTIONS/POST, headers Content-Type/Authorization/X-Requested-With를 적용했습니다. OPTIONS 204는 null body이며 data asset을 조회하지 않습니다. API는 읽기 전용으로 POST는 405입니다.

[외부 HTTP 근거](external-access.json): API OPTIONS **204**, 미지의 /api/* OPTIONS **204**, **AIAgentBot/1.0 200 JSON**, 오류 경로 **404 JSON**, POST **405 JSON**. Python에서 같은 명시적 UA를 사용한 실제 urllib 요청도 **200 JSON**입니다. Python 기본 UA **403 / error code: 1010**은 해결되지 않았습니다.

Orca CLI로 확인한 UI: Pages Settings에는 Build/Variables/Bindings/Runtime/General만 존재하며 project Security Level/BIC/Bot Fight Mode 메뉴가 없습니다. Custom domains는 미설정, Domains 목록은 No data available입니다. 계정 WAF 메뉴는 Enterprise add-on 구매 화면이며 계정 소유 domains 대상 설정입니다. 계정 BotBase는 봇 카탈로그/관찰 화면이며 Pages BIC OFF 옵션이 아닙니다.

따라서 요청 수정본에 언급된 pages.dev 프로젝트/계정 BIC OFF 설정은 현재 계정 UI에서 제공되지 않으며 변경했다고 주장하지 않습니다. 커스텀 도메인은 사용하지 않고 기본 pages.dev를 유지합니다. Functions 실행 이전의 차단은 CORS 코드에서 제거할 수 없습니다. 현재 접근 가능한 명시적 클라이언트 식별 UA를 사용하며, 기본 UA 차단 해제 자체는 Cloudflare 지원 측 확인이 필요합니다.

공식 근거:

- [BIC 설정](https://developers.cloudflare.com/waf/tools/browser-integrity-check/): 문서의 globally는 account 전체가 아니라 **your zone** 범위입니다.
- [Pages Headers](https://developers.cloudflare.com/pages/configuration/headers/): `_headers`는 정적 asset 응답에만 적용되며 Functions 응답에는 적용되지 않습니다. 현재 API는 Functions이므로 중복 `_headers`/global middleware를 추가하지 않았습니다.
- [Pages routing](https://developers.cloudflare.com/pages/functions/routing/): `_routes.json`은 Function 호출 여부를 제어하며 WAF/BIC 설정이 아닙니다.
- [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/): custom rules로 skip할 수 없습니다.

WAF/BIC 완화: **미완료(현재 pages.dev 계정/프로젝트에 설정 권한 UI 없음)**. 지정된 preflight/AIAgentBot acceptance는 통과했습니다.


## 추가: 독립 Worker 배포 완료

Worker URL: **https://psn-trophy-tracker-api.eggu3213.workers.dev/api/v1/status**

API base: **https://psn-trophy-tracker-api.eggu3213.workers.dev/api/v1**

실제 Wrangler deploy 성공, version `9a1da35f-d8de-44e1-807d-2d1f5d1f33cd`. `wrangler.worker.toml`은 기존 `worker/src/index.ts`를 배포하고 `DATA_BASE_URL=https://psn-trophy-tracker.pages.dev`로 같은 canonical/history를 연결합니다. Pages config는 유지합니다. 인증은 Worker scripts/account read 범위 Wrangler OAuth로 수행했으며 credential은 repository/로그에 포함하지 않았습니다.

실제 Worker `/status`, `/profile`, `/games?limit=5`, `/trophies/recent?limit=5`, `/games/NPWR12310_00`, `/games/NPWR12310_00/trophies`, `/changes`, 두 since 요청, SILENT HILL f 양언어 endpoint **모두 HTTP 200**. Code Veronica **30/30, earned 9**, ko-KR/en-US/원문 필드 보존 검증. [Worker HTTP 기록](worker-acceptance.json).

Worker OPTIONS 및 /api/* preflight **204**, AIAgentBot **200 JSON**, unknown API **404 JSON**, POST **405 JSON**. 기본 Python-urllib UA는 **403/1010**으로 여전히 관찰되어 무차별 bot 허용을 주장하지 않습니다. [Worker 외부 접근 기록](worker-external-access.json).

최종 metadata cache 재분류 sync [Actions 36673666921](https://github.com/eggu/psn-trophy-tracker/actions/runs/36673666921) **success**, **2.42초**, ko-KR/en-US 168개씩 cache 사용. Snapshot `2026-09-30T05:30:06.907Z`, data commit `9c48a70`, Pages deployment `02ef7fd8`을 통해 Worker에서도 같은 timestamp 확인. 영어 공식 응답 164개/지역 원문 fallback 4개, 한국어 지원 146개/fallback 22개, 상세 8413개, earned 2455개입니다.

최종 tests **30 passed**, 타입 검사 및 Pages/Worker bundle build 통과. DATA_BASE_URL에 대한 current/index/과거 snapshot 최대 1개 조회와 Worker /data/current.json 404 동작을 검증했습니다.
