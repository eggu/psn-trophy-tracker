# Legacy trophy detail incident

## Evidence (2026-09-30)

Diagnostic run: https://github.com/eggu/psn-trophy-tracker/actions/runs/36669365362

Installed client: psn-api 2.18.1. Both endpoints use `/api/trophy/v1/`; service selection is a query parameter, not a separate PS5 URL. Its URL builder drops undefined options. The actual title response contains `npServiceName: trophy`, platform `PS4`, version `01.00`.

| NPWR12310_00 step | Service omitted | Service = trophy |
|---|---|---|
| Definitions | HTTP 404, error 2240525, 0 trophies | HTTP 200, 30 trophies |
| Earned | HTTP 404, client exception | HTTP 200, 30 states |
| Merge | 0 / 0 earned | 30 / 9 earned |
| Canonical | summary 30, details 0 | summary 30, details 30 |

The definitions endpoint returns an error body without throwing; the earned endpoint throws on that error. The Collector previously swallowed the failure, used an empty fallback, and storage validated only the shape of the snapshot.

Official client documentation: https://psn-api.achievements.app/api-docs/user-trophies

## Scope

Baseline snapshot: `2026-09-30T03:59:20.473Z`. 77 of 168 games had positive totals and empty details. PS5: 0, PS4: 65, PS3: 12, PSVITA: 1. Counts overlap for one PS4/Vita title. All title IDs are preserved in `p0-impact.json`.

Representatives: PS4 `NPWR12310_00`, PS3 `NPWR04712_00`, Vita/PS4 `NPWR16040_00`.

## Fix and guardrails

Use the title's explicit service first, falling back to exact PS5 platform detection (`trophy2`) or legacy (`trophy`). Both APIs receive the same service. Fetch every page of the `all` group, detect API error bodies and stalled pagination. Cache reuse requires unchanged version, summary counts, last update and complete details.

Reject positive-total games with empty details and duplicate IDs before writing history or replacing current.json, including dry runs. Report summary/detail count and grade discrepancies as warnings because PSN summary/definition revisions can temporarily disagree. Responses from all groups preserve base and DLC trophies.

The regression fixture is a real PSN response from the diagnostic run, without authorization data. It preserves 1 platinum, 5 gold, 10 silver, 14 bronze; earned 0/0/3/6. Last earned trophy: `2026-09-29T15:09:01Z`; title last update: `2026-09-29T15:09:05Z`. These represent different PSN fields.

## Full sync acceptance

Run https://github.com/eggu/psn-trophy-tracker/actions/runs/36669641884 succeeded in 94.23 seconds. Snapshot `2026-09-30T04:38:45.796Z`: all 168 games match detail/summary totals, zero empty detail arrays, Code Veronica 30 definitions / 9 earned. No Collector consistency warnings.
