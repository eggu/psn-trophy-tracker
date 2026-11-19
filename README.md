# Trophy & Achievement Tracker

PlayStation 트로피와 Steam 도전과제를 수집해 통합 Dashboard, Agent Markdown, JSON REST API로 제공합니다. 기존 PSN 데이터와 API 경로도 그대로 사용할 수 있습니다.

- Dashboard: https://psn-trophy-tracker.pages.dev/
- Canonical JSON: https://psn-trophy-tracker.pages.dev/data/current.json
- Agent Markdown: https://psn-trophy-tracker.pages.dev/agent
- Agent Markdown (Worker): https://psn-trophy-tracker-api.eggu3213.workers.dev/agent
- JSON REST API (Worker): https://psn-trophy-tracker-api.eggu3213.workers.dev/api/v1
- Pages API: https://psn-trophy-tracker.pages.dev/api/v1

## 구성

GitHub Actions Collector → 검증된 `data/current.json` / `data/history/` → Cloudflare Pages 정적 파일 + Pages Functions.

`functions/api/[[path]].ts`는 기존 `worker/src/router.ts`를 재사용합니다. Functions는 `env.ASSETS.fetch()`로 같은 배포의 JSON을 읽습니다. Pages API에는 KV/PSN 인증정보가 필요하지 않습니다. 추가 Worker는 같은 router를 사용하고 `DATA_BASE_URL`로 Pages canonical/history를 읽습니다. 새 data 배포는 Worker 재배포 없이 반영됩니다.

## 실행과 운영

Node.js 22 이상:

```sh
npm ci
npm test
npx tsc --noEmit
npm run build:dashboard
npx wrangler pages dev dashboard/dist
```

Pages Git 연동 빌드 명령은 `npm run build:dashboard`, 출력 폴더는 `dashboard/dist`, production branch는 `main`입니다. `wrangler.toml`도 같은 출력 폴더를 지정합니다. Functions는 저장소 루트의 `functions/`에서 자동 빌드됩니다. `_routes.json`은 `/api/*`, `/agent`, `/agent/*`를 Functions로 보내고 정적 파일은 직접 제공합니다.

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
- 실패하면 이전 `current.json`을 보존하고 안전한 sync 실패 marker를 별도로 기록합니다. 수집에 성공한 snapshot만 history에 기록하고 current를 원자적으로 교체합니다.

## 공식 영어·한국어 metadata

`Accept-Language: ko-KR` 및 `en-US`로 trophy definitions와 trophy groups(게임명)를 요청합니다. 기계번역과 외부 출시 DB는 사용하지 않습니다.

원본 `name` / `description`은 유지하고 공식 응답을 `localized["ko-KR"]`, `localized["en-US"]`에 각각 저장합니다. Dashboard는 한국어 우선, 없으면 원문을 표시합니다. API 기본 `name` / `description`은 영어 우선이며 `originalName` / `originalDescription`과 두 localized 필드를 함께 반환합니다. JSON API의 영어 기본값은 유지합니다. 새 Human/Agent Markdown은 최신 요청에 따라 공식 한국어 우선, 없으면 원문입니다. PSN이 영어 요청에도 지역 원문을 반환하는 trophy set은 `localization["en-US"].status = "fallback"`으로 표시하고 해당 공식 응답을 그대로 보존하며 번역하지 않습니다. 현재 영어 164개/지역 원문 fallback 4개입니다.

`localization[locale]`은 trophy set version, 확인 시각, `available` / `fallback` 상태를 기록합니다. 성공한 지원·fallback 결과 모두 version별로 재사용합니다. 새 title, version 변경, trophy ID 변경 시 재조회하며 일시적인 요청 실패는 캐시하지 않아 다음 sync에 재시도합니다. Full Sync도 변경 없는 한국어 캐시는 재사용합니다.

PSN은 지원 locale 목록이나 `Content-Language`를 제공하지 않습니다. `ko-KR` 요청에 반환된 실제 한글을 확인한 경우만 한국어 지원으로 기록합니다. 한글이 관찰되지 않은 응답은 원문 fallback으로 분류합니다. 게임 브랜드명이 영어로 유지되더라도 한국어 트로피가 있으면 해당 공식 응답을 저장합니다.

## Human UI / Agent Markdown

Human URL은 `/`(전체 Dashboard), `/games`(168개 목록), `/game/{id}`(게임 상세)입니다. 게임 카드는 실제 링크이며 상세 URL 직접 방문·새로고침도 동작합니다. 시각은 브라우저 시간대와 무관하게 KST로 표시합니다.

저장소에서도 [agent/README.md](agent/README.md)를 직접 읽을 수 있습니다. `agent/STATUS.md`, `PROFILE.md`, `CHANGES.md`, `RECENT.md`, `GAMES.md`와 `agent/games/{id}.md`를 실제 파일로 보존합니다. `npm run build:agent`로 재생성하며 매 sync 성공/실패 결과 commit 전에 자동 갱신합니다. 저장소 파일의 Fresh/Stale은 생성 시점 기준이고, 실시간 freshness는 HTTP `/agent/status`에서 확인합니다.

Agent 진입점: **https://psn-trophy-tracker.pages.dev/agent**

| Markdown URL | 내용 |
|---|---|
| `/agent` | 문서 manifest, 사용 순서 |
| `/agent/status` | 성공/시도/생성 시각, Fresh/Stale |
| `/agent/profile` | 계정 레벨·등급별 수량·게임 수 |
| `/agent/changes` | 일반 현황 확인의 첫 문서, 직전 sync 대비 변화 |
| `/agent/recent` | 최근 획득 50개, 전체 KST 시각 |
| `/agent/games` | 이름 → NPWR ID 인덱스, 개별 trophy 제외 |
| `/agent/game/{id}` | 등급별 요약, 미획득 먼저, 획득 시각과 설명 |

예: [Code Veronica Markdown](https://psn-trophy-tracker.pages.dev/agent/game/NPWR12310_00), [Worker Markdown](https://psn-trophy-tracker-api.eggu3213.workers.dev/agent/game/NPWR12310_00).

응답은 `text/markdown; charset=utf-8`입니다. Avatar/image URL 및 반복 UI metadata는 제외합니다. `Last Trophy`는 실제 earnedAt의 최신값이며 PSN title 갱신 시각과 구분합니다. 한국어는 PSN 공식 ko-KR → 원문 순서이며 기계번역하지 않습니다. 기존 영어/한국어 canonical 필드는 유지합니다.

`data/current.json`이 SSOT입니다. `agent/render.ts`가 빌드 시 canonical 및 직전 history에서 작은 문서를 생성합니다. Pages Functions는 해당 Markdown 한 파일만 읽으며 `/agent`와 `/agent/status`는 작은 operational metadata만 읽어 현재 시각 기준 freshness를 계산합니다. Worker는 Pages의 동일 Markdown URL만 읽습니다. Agent 요청은 대용량 canonical/history/PSN을 조회하지 않습니다.

직전 snapshot이 없으면 초기 상태라고 명시하고 과거 획득 전체를 새 변화로 보고하지 않습니다. 변화가 없으면 `No trophy changes since previous sync.`를 표시합니다. 12시간 이상 지난 데이터 또는 마지막 성공 이후 실패한 sync는 Stale입니다. 수집 실패 시 canonical은 보존하고 `data/sync-status.json`에 시도 시각/성공 여부만 원자적으로 기록합니다. Actions는 수집 실패 뒤에도 이 marker를 commit해 배포하며 workflow 자체는 실패 상태를 유지합니다. 인증정보·내부 error stack은 공개하지 않습니다.

168개 인덱스 실측: **5,916 tokens / 13,159 bytes** (`o200k_base`). Changes **52**, Profile **91**, Recent **1,762**, Code Veronica 상세 **964** tokens입니다. Canonical 전체는 **1,872,280 tokens / 6,824,583 bytes**입니다. 현재 단일 인덱스를 유지하며 platform/recent별 분할은 추가하지 않았습니다. 모델별 tokenizer에 따라 수치는 달라집니다. [측정 기록](docs/agent-token-counts.json).

```sh
node scripts/verify-views.mjs
node scripts/verify-views.mjs https://psn-trophy-tracker-api.eggu3213.workers.dev docs/worker-views-acceptance.json
```

Markdown은 AI 도구의 외부 URL 접근 권한이나 Cloudflare의 실행 전 차단을 해제하지 않습니다. `DisabledError`가 없어졌다는 보장은 하지 않습니다.

## JSON REST API

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

검증 근거: [전체 완료/제한 보고](docs/VERIFICATION.md), [Worker HTTP](docs/worker-acceptance.json), [P0](docs/P0-VERIFICATION.md), [플랫폼별 영향](docs/p0-impact.json), [실제 API acceptance](docs/p1-acceptance.json), [운영 설계](docs/DESIGN.md).

## 외부 클라이언트 접근

`/api/*`의 성공·오류·OPTIONS 응답은 다음 헤더를 반환합니다. OPTIONS는 데이터 조회 없이 204입니다. POST는 CORS 허용 목록에 포함하지만 API 자체는 읽기 전용이므로 405 JSON을 반환합니다.

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS, POST
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Content-Type: application/json; charset=utf-8
```

`node scripts/verify-external-access.mjs`로 실제 preflight, AIAgentBot, 오류 응답을 검사합니다. CORS는 Cloudflare가 Functions 실행 전에 차단한 요청에는 적용되지 않습니다. 현재 `AIAgentBot/1.0`은 200 JSON이지만 `Python-urllib/3.9`는 403 / error 1010입니다. Python에서는 명시적인 클라이언트 식별자를 전달하면 접근할 수 있습니다.

```python
import json
from urllib.request import Request, urlopen
request = Request('https://psn-trophy-tracker.pages.dev/api/v1/games',
                  headers={'User-Agent': 'AIAgentBot/1.0'})
games = json.load(urlopen(request))
```

Orca로 확인한 현재 계정에는 등록된 zone/커스텀 도메인이 없습니다. 따라서 `pages.dev`에 사용자 소유 WAF Skip 규칙을 생성할 수 없으며 WAF 완화는 완료되지 않았습니다. 기본 pages.dev를 계속 사용합니다. 기본 Python UA 차단 해제는 Cloudflare 지원 측 확인이 필요합니다. 프로젝트에는 BIC/Security Level 설정이 없고 계정 WAF는 Enterprise 소유 도메인 대상입니다. 일반 Bot Fight Mode는 custom rule로 skip할 수 없습니다. [Cloudflare Skip 옵션](https://developers.cloudflare.com/waf/custom-rules/skip/options/), [Bot Fight Mode 제한](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/), [1010 설명](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/).

`_headers`는 정적 asset 전용이며 Functions 응답에 적용되지 않습니다. `_routes.json`은 Function 호출 범위만 설정합니다. 두 파일은 WAF/BIC 차단을 해제하지 않습니다. [공식 Headers 문서](https://developers.cloudflare.com/pages/configuration/headers/), [BIC zone 범위](https://developers.cloudflare.com/waf/tools/browser-integrity-check/).

## 별도 Worker 배포

Worker: https://psn-trophy-tracker-api.eggu3213.workers.dev/api/v1/status

`wrangler.toml`은 Pages 설정을 유지합니다. 별도 `wrangler.worker.toml`은 이름 `psn-trophy-tracker-api`, 진입점 `worker/src/index.ts`, `workers_dev = true`, `DATA_BASE_URL = https://psn-trophy-tracker.pages.dev`를 지정합니다. Worker origin으로 canonical JSON을 요청하지 않습니다. `/api/*`와 `/agent`·`/agent/*` 밖은 404이며 별도 저장소/PSN 토큰을 두지 않습니다.

```sh
npx wrangler login
npx wrangler deploy --config wrangler.worker.toml
node scripts/verify-api.mjs https://psn-trophy-tracker-api.eggu3213.workers.dev docs/worker-acceptance.json
node scripts/verify-external-access.mjs https://psn-trophy-tracker-api.eggu3213.workers.dev docs/worker-external-access.json
```

2026-09-30 실제 배포/GET acceptance 통과. OPTIONS 204, AIAgentBot 200 JSON. 기본 Python-urllib UA는 Worker에서도 403/1010으로 관찰되어 동일하게 명시적 클라이언트 식별자가 필요합니다. Dashboard/Pages API도 유지합니다. 데이터는 자동 sync→Pages 배포로 최신화되며 Worker 코드 변경은 위 명령으로 재배포합니다.

## Steam 도전과제 수집

Node.js 22 이상이 필요합니다. [Steam Web API 키 발급 페이지](https://steamcommunity.com/dev/apikey)에서 키를 발급하고, Steam 프로필의 **내 공개 설정 → 게임 세부 정보**를 공개로 설정합니다.

프로젝트 루트의 `.env.local`에 다음 환경변수를 설정합니다. 이 파일은 Git에 포함되지 않습니다. 키를 소스나 JSON에 넣지 마세요.

```dotenv
STEAM_API_KEY=발급받은_키
STEAM_PROFILE=https://steamcommunity.com/id/eggu/
```

기존 PSN 스냅샷에 Steam만 수집하려면:

```sh
npm ci
npm run collect:steam
npm run build:agent
```

두 플랫폼을 함께 수집하려면 `PSN_NPSSO`를 환경변수로 제공하고 실행합니다.

```sh
node --env-file-if-exists=.env.local --import tsx collector/src/index.ts
```

GitHub Actions 자동 수집은 저장소의 **Settings → Secrets and variables → Actions**에 `STEAM_API_KEY` Secret을 추가하면 활성화됩니다. PSN 인증은 기존 `PSN_NPSSO`를 사용합니다. Steam 키가 없으면 PSN만 갱신하고 기존 Steam 데이터는 마지막 수집 시각과 함께 유지합니다. API 오류나 비공개·불완전한 응답이 발생하면 기존 스냅샷을 보존합니다.

Dashboard는 통합 획득 수·게임 수·100% 완료 수를 먼저 표시하고, PlayStation과 Steam의 계정·수량·수집 시각을 각각 보여줍니다. 게임 목록에서 PlayStation/Steam과 100% 완료/미완료를 선택해 필터링할 수 있습니다. 최근 획득 목록은 두 플랫폼을 함께 표시합니다. 같은 게임을 두 플랫폼에서 플레이한 경우 각각 별도 항목으로 표시합니다. Steam은 등급이 없으므로 `achievement`로 저장하며 PSN의 Platinum/Gold/Silver/Bronze 수량에는 포함하지 않습니다.

- Steam 게임 ID는 `steam-{appid}`입니다. 예: `/api/v1/games/steam-21690/trophies`, `/agent/game/steam-21690`.
- `/api/v1/games?platform=Steam`으로 Steam 게임을 조회합니다. 기존 `/trophies/recent`와 `/changes`에도 도전과제가 포함됩니다.
- `/api/v1/profile`의 기존 필드는 PSN 값이며, `steam` 필드에 Steam 도전과제·게임 수와 마지막 수집 시각을 제공합니다. `/status`의 `sources`에서 플랫폼별 수집 시각을 확인합니다.
- Steam은 보유 게임 API가 반환하는 게임 중 도전과제가 있는 게임을 수집합니다. API가 반환하지 않는 가족 공유·제거된 게임은 포함되지 않을 수 있습니다. Steam 프로필 쇼케이스의 총계와 집계 범위가 다를 수 있습니다.
- 도전과제 이름·설명은 공식 한국어 응답이 있으면 사용하며, 없으면 영어로 표시합니다. 획득 시각이 제공되지 않은 도전과제는 시각을 추정하지 않습니다. 첫 수집은 전체 라이브러리를 조회하므로 시간이 걸릴 수 있습니다.

### 게임 정렬과 플레이 시각

게임 목록의 **정렬** 메뉴에서 최근 획득순, 마지막 플레이순, 이름순·역순, 진행률 높은순, 완료에 가까운순, 획득 수 많은순을 선택합니다. 완료에 가까운순은 수집을 시작한 미완료 게임 중 남은 항목 수가 적은 게임을 먼저 보여줍니다. 정렬·필터는 상세 페이지의 **게임 목록**으로 돌아와도 유지됩니다.

마지막 플레이는 Steam의 공식 플레이 시각과 PSN의 공식 플레이 이력을 사용하며, PSN은 게임 ID와 트로피 세트 ID의 공식 연결이 확인된 경우에만 표시합니다. 기존 데이터는 해당 수집이 완료되기 전까지 **정보 없음**으로 표시할 수 있습니다. 정보가 없는 게임은 마지막 플레이순에서 아래에 표시하며, 최근 트로피 획득 시각으로 대체하지 않습니다. 최근 획득순은 개별 트로피·도전과제의 실제 획득 시각을 사용합니다.

화면의 **100% 완료**는 모든 트로피·도전과제를 획득한 상태입니다. 플래티넘을 획득했더라도 추가 트로피가 남아 있으면 미완료로 표시합니다. PlayStation의 진행률은 등급별 가중치를 반영할 수 있으므로 Steam의 개수 기준 진행률과 계산 방식이 다릅니다.
