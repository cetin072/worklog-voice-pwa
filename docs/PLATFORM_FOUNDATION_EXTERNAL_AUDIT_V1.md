# 업무수첩 Platform Foundation 외부 독립 감사 V1

## 문서 상태

- 성격: **외부 독립 감사(Independent Architecture & Implementation Audit)**
- 감사일: 2026-09-13
- 감사 기준 커밋: main `9feaa58a309ab924f6363be27c5777f135452ce7`
- 감사 대상: main 실사용 코드, 통화정리 Draft stack(PR #59~#81), 스캔/PDF Draft(PR #60/#83), Platform 첫 코드(Issue #93 / PR #94), 공식 문서 4종, 중앙 규칙 저장소
- 감사 방식: 채팅 설명이 아니라 실제 저장소 코드·PR·Issue를 직접 읽고 판정
- 이 문서는 결정문이 아니라 **감사 소견**이다. 수용 / 부분수용 / 반박은 제품 오너가 결정한다.

---

# 1. Executive Verdict

## 판정: **방향 적절하나 일부 수정 필요**

Existing-first Platform Extraction 전략은 이 저장소의 실제 상태에 정확히 맞는 선택이다. 코드를 직접 읽은 결과, Platform Foundation V1이 필요로 하는 공통 기반의 **상당 부분이 이미 구현되어 있고 테스트까지 붙어 있다.** 바닥부터 새로 만들 이유는 없다.

다만 현재 계획서(특히 Issue #93)에는 **실제 코드와 다른 전제 3개**가 들어가 있고, 그 전제 위에서 다음 단계를 정하면 잘못된 자산을 승격하게 된다.

### 즉시 수정이 필요한 3가지

1. **Issue #93의 사실관계 오류.** "통화 Draft PR의 Processing Job / Usage Ledger에는 `user_id`, `workspace_id` 개념이 일부 들어가 있으나"라고 적혀 있으나, 통화 stack 전체(81개 파일, 8,090줄)에서 `workspaceId` / `workspace_id` / `userId` / `user_id` 는 **0건**이다. 존재하는 것은 fingerprint 입력용 `userKey` 문자열 1개와 usage-meter의 자유입력 `userLabel`(최대 40자) 뿐이다. 즉 Workspace 소유권 retrofit 비용은 계획서가 가정하는 것보다 **크다.**

2. **Idempotency 승격 대상이 반대로 지정되어 있다.** Issue #93은 통화 Draft의 Idempotency를 "재사용 후보 1순위"로 적었다. 그러나 실제로는 **통화 Draft의 idempotency는 동작하지 않는 껍데기**이고(`createProcessingRequest`는 정의만 되어 있고 호출하는 코드가 저장소 전체에 0건, 생성된 `idempotencyKey`를 읽는 코드도 0건, 중복 판정 저장소 없음), **main의 idempotency는 클라이언트-서버 완결형으로 실제 동작 중**이다. 승격 원본은 통화 Draft가 아니라 main이어야 한다.

3. **Usage/Cost는 이미 두 벌이 서로 다른 모양으로 존재한다.** 통화 Draft 안에서만 `netlify/shared/usage-ledger-contract.mjs`(서버, eventKey/requestId 기준)와 `public/usage-meter.mjs`(클라이언트, localStorage, id/createdAt/userLabel/요율표/예산)가 **서로 호환되지 않는 이벤트 스키마**로 공존한다. 여기에 Platform Usage Service를 새로 얹으면 **세 벌**이 된다. 이것이 현재 가장 큰 중복개발 위험이다.

### 반대로, 강하게 확인된 좋은 판단

- 통화 Draft의 Processing Job 상태머신·체크포인트·재시도·임시파일 수명관리는 **품질이 높고 이미 의존성 주입 구조**다. 새로 만들면 손해다.
- Platform Status와 Domain Stage를 분리하겠다는 PR #94 본문의 결정은 **코드 근거상 정확**하다. 현재 enum이 실제로 둘을 섞고 있다.
- 스캔/PDF의 OCR은 on-device tesseract.js wasm(자체 호스팅 vendor 자산)이며 서버 OCR이 아니다. **Freeze Rule 위반 없음.**
- TAEJANG Supabase와의 우발적 결합은 없다. worklog 저장소 전 브랜치에 Supabase 코드 0건. 정책이 코드로도 지켜지고 있다.

### 한 줄 요약

> 지금 하고 있는 것은 "업무수첩을 새로 만드는 것"이 **아니다.** 다만 승격 원본을 고르는 근거표가 실제 코드와 어긋나 있어, **그 표를 먼저 고치고 나서** 다음 PR로 넘어가야 한다.

---

# 2. Existing Asset Inventory

모든 근거는 실제 파일·PR 번호 기준이다. `L`은 대략 줄 수.

| 영역 | 현재 위치 | 구현 수준 | 검수 수준 | Platform 재사용 가능성 | 판단 |
|---|---|---|---|---|---|
| **Workspace** | `netlify/shared/platform/workspace-context.mjs` (PR #94, 71L) | 정규화/검증만. 저장소·Provider 없음 | 단위테스트 11개 PASS (전체 60/60) | 계약으로는 사용 가능. **소비자 0** | ⑤ 신규가 맞음. 단 배치 위치·검증 방식 수정 필요 (§6) |
| **Processing Job** | `netlify/shared/call-processing-state.mjs` (46L) + `call-processing-runner.mjs` (321L) — PR #64 | **높음.** 10-status 전이표, 4단계 checkpoint resume, retry_wait, 임시파일 수명, usage 실패 격리 | `call-processing-runner.test.mjs` 205L 등 | **매우 높음.** deps 주입(`transcribe/analyze/persistResult/deleteTemp/uploadTemp/verifyPreparedUpload/recordUsage/saveJob/now`)으로 이미 도메인 비의존 | ③ 공통부 추출. 결합점은 단 3개 (§3.1) |
| **Retry** | 위 runner 내부 `retry_wait` + `retryStage` + checkpoint | **중간.** 재개는 정확. 단 **시도횟수·backoff·최대재시도 없음** | runner 테스트에 포함 | 높음 (재개 로직), 낮음 (백오프 정책 부재) | ③ 재개 로직은 승격, backoff 정책은 ⑤ 신규 |
| **Idempotency** | **main**: `public/request-id.js` (72L) + `netlify/functions/worklog.mts` + `core-logic.mjs::idempotencyHit` + Netlify Blobs `worklog-idempotency` (strong consistency) | **높음. 실제 운영 중 완결형** | `core-functions.test.mjs`에 4케이스 | **최고** | ② 약간 수정 후 Platform 승격 — **승격 원본은 main** |
| Idempotency (통화 Draft) | `public/call-processing-policy.mjs::createProcessingRequest` (L118~127) | **껍데기.** 호출자 0건, key 소비자 0건, 중복판정 저장소 없음 | 없음 | 없음 | ⑤ 폐기 — main 구현으로 교체 |
| Idempotency (preflight) | `public/call-upload-preflight.mjs` L88~92 `fileFingerprint` 목록내 중복제거 | 목록 UX 전용 | `call-upload-preflight.test.mjs` | 도메인 전용 | ④ 모듈 유지 (Platform 아님) |
| **Usage/Cost (서버)** | `netlify/shared/usage-ledger-contract.mjs` (69L) — PR #64/#68 | 중간. eventKey/requestId 기반 정규화 + 미연결 어댑터 | `usage-ledger-contract.test.mjs` 40L | 중간. **`workspace_id`/`user_id` 없음** → Decision 02 미충족 | ③ 공통부 추출 + 식별자 필드 추가 |
| **Usage/Cost (클라이언트)** | `public/usage-meter.mjs` (230L) + `usage-sync.mjs` (86L) + `usage-dashboard-model.mjs` (163L) — PR #62/#68 | 높음. localStorage 원장, 요율표, 예산/경고, 병합 | 테스트 3종 | **서버 계약과 스키마 불일치** (id/createdAt/userLabel/category vs eventKey) | ③ **두 벌을 먼저 하나로 통일**한 뒤 승격 (§4 P0-1) |
| **Storage** | `netlify/shared/call-storage-contract.mjs` (72L) — PR #64 | 중간. prepared-upload 정규화, path traversal 방어, 만료순서 검증 | `call-storage-contract.test.mjs` 55L | **높음. 통화 전용 로직 0** | ② 이름만 바꿔 승격 (사실상 무비용) |
| **STT Adapter** | `netlify/shared/provider-adapter-contract.mjs::normalizeSttAdapterResult` — PR #70 | 높음. transcript/segments/speaker/language/usage 정규화 | `provider-adapter-contract.test.mjs` 84L | **최고. 통화 전용 로직 0** | ① 사실상 그대로 재사용 (이름만 정리) |
| **AI Adapter** | 같은 파일 `normalizeAiAdapterResult` | 높음. 단 `normalizeCallAnalysisResult` 직접 import | 같은 테스트 | 중간 | ③ **envelope(provider/model/providerRequestId/usage)는 공통, payload는 도메인**으로 분리 |
| **Retention** | `public/call-processing-policy.mjs` (133L) — 24h 임시파일 상한, 실패 유예, 녹취 3정책 | 높음. Decision 05와 일치 | `call-processing-policy.test.mjs` 76L | 높음 | ② 승격. 단 30일 휴지통은 미구현 → ⑤ |
| **Auth** | main `public/auth.js` (128L) + `worklog.mts` owner/personal 2모드 | 동작하나 구조적으로 얕음. **개인 Notion PAT를 localStorage 보관 + 매 요청 헤더 전송** | `client-stability.test.mjs` 일부 | **낮음** | ④ 참고 구현으로만 보존. Platform Auth 표준으로 승격 금지 |
| **Sync** | 없음 | 없음 | 없음 | — | ⑤ 신규 (단 V1은 계약만) |
| **Audit** | 없음 | 없음 | 없음 | — | ⑤ 신규 (단 V1은 계약만) |
| **Candidate** | `netlify/shared/call-analysis-normalize.mjs::splitCallAnalysisActions` → `tasks/schedules/followUps/decisions` + `contacts` | **중간~높음. 이미 4분류 taxonomy 존재** | `call-analysis-normalize.test.mjs` 104L, `call-report-contract.test.mjs` 92L | 높음. `SourceRef`만 없음 | ③ 분류체계는 승격, CallReport 형식은 도메인 유지 |
| **Schedule** | **`netlify/shared/schedule-extract.mjs`** — main 실사용 | **높음. 실제 운영 중** | `schedule-extract.test.mjs` | **최고. 이미 3개 소비자** (`worklog.mts` / `worklog-scan.mts`(#83) / `call-analysis-normalize.mjs`(#81)) | ② **2-Module Rule 이미 충족. 즉시 승격 대상인데 어느 문서에도 없음** (§3.2) |

### 인벤토리 총평

Platform Foundation V1이 목표한 6개 실구현 항목 기준으로 대략적인 기존 자산 커버리지는 다음과 같다.

| Platform V1 항목 | 기존 자산 커버리지 | 실제로 새로 써야 할 것 |
|---|---|---|
| Workspace Context | ~5% | 계약(완료) + 소비자 + Provider |
| Processing Job | **~85%** | status/stage 분리, 도메인 결합 3곳 제거 |
| Retry / Idempotency | **~75%** (main 60% + Draft 15%) | backoff/최대시도, Job 대상으로 일반화 |
| Usage / Cost | **~70%** | 두 스키마 통일 + workspace/user 식별자 |
| Storage 경계 | **~90%** | 이름 정리 + 실제 Provider |
| Adapter 경계 | **~85%** (STT ~95%, AI ~60%) | AI envelope/payload 분리 |

> **평균적으로 이미 70% 안팎이 존재한다. "Platform을 만든다"가 아니라 "이미 있는 것에 이름과 소유자를 붙인다"가 실제 작업의 정체다.**

---

# 3. 재사용 우선순위

## 3.1 Processing Job — ③ 공통부 추출 (재작성 금지)

`call-processing-runner.mjs`는 이미 모든 외부 작용이 `deps`로 주입된다. 도메인 결합은 **정확히 3곳뿐**이다.

1. `import { normalizeCallAnalysisResult } from "./call-analysis-normalize.mjs"` (L1) — analyze 결과 정규화가 하드코딩되어 있다. → `deps.normalizeResult`로 주입 전환.
2. `const RETRY_STAGES = new Set(["uploading","transcribing","analyzing","persisting"])` (L5) 및 파이프라인 블록의 단계명 하드코딩 → 모듈이 stage 목록을 주입.
3. `relatedType: item?.relatedType || job.kind || "call"` (L44) — 기본값이 `"call"`.

**이 3곳만 고치면 회의정리 모듈이 코드 복사 없이 같은 runner를 쓸 수 있다.** 이것이 2-Module Rule의 실제 증명이 된다. 예상 변경량은 **50줄 미만**이다. 새 Job 엔진은 만들 이유가 없다.

### status / stage 분리는 2분할이 아니라 3분할이 맞다

현재 `PROCESSING_STATUSES` 10개를 감사자 관점에서 분해하면 다음과 같다.

| 현재 값 | 실제 소유자 | 근거 |
|---|---|---|
| `queued` `completed` `failed` `cancelled` | **Platform Status** | 모든 모듈 공통 |
| `retry_wait` | **Platform** (Domain 아님) | 재시도 정책은 전역 관심사 |
| `cleanup_pending` | **Platform** (Storage 수명) | 임시파일 삭제는 Storage Service 책임 |
| `uploading` | **Platform** (Storage 경계) | 임시 업로드는 공통 |
| `transcribing` `analyzing` `persisting` | **Domain Stage** | 모듈별로 다름 |

즉 제안하신 2분할(Platform Status vs Domain Stage)은 방향은 맞지만, `retry_wait` / `cleanup_pending` / `uploading` 을 Domain Stage로 밀어내면 **각 모듈이 재시도와 임시파일 삭제를 다시 구현하게 된다.** 권장 모델:

```
job.status      : queued | processing | completed | failed | cancelled   (Platform, 5개)
job.retryState  : null | waiting        + attempt, nextAttemptAt          (Platform)
job.tempObject  : path, createdAt, expiresAt                              (Platform/Storage)
job.stage       : 모듈이 정의하는 문자열 (예: transcribing)                (Domain)
job.stageIndex  : 진행률 표시용                                            (Domain)
```

기존 10-status 전이표는 이 모델로 **손실 없이** 사상 가능하다.

## 3.2 Schedule — ② 즉시 승격 (현재 어느 계획에도 없음)

`netlify/shared/schedule-extract.mjs`는 이미 세 곳에서 소비된다.

- `netlify/functions/worklog.mts` (main, 실사용)
- `netlify/functions/worklog-scan.mts` (PR #83)
- `netlify/shared/call-analysis-normalize.mjs` (PR #81)

**2-Module Rule을 이미 초과 충족한 유일한 자산이다.** 그런데 `PLATFORM_FOUNDATION_V1.md` V1 실구현 목록에도, `MODULE_REGISTRY.md` §13 Platform Service 표에도, Issue #93 재사용 자산 목록에도 이 파일은 없다.

`splitCallAnalysisActions`가 이미 `tasks / schedules / followUps / decisions`를 내보내고 있고 `contacts`도 별도로 정규화된다. 즉 **`TaskCandidate` / `ScheduleCandidate` / `FollowUpCandidate` / `ContactCandidate` 4종의 분류체계는 이미 코드에 있다.** 없는 것은 `SourceRef` 하나다.

→ 권고: Schedule/Candidate 계약을 "새로 설계"하지 말고, 위 두 파일에서 **추출 + `SourceRef` 필드 추가**로 진행한다.

## 3.3 그대로 재사용 / 이름만 정리 (①②) — 거의 무비용

| 자산 | 조치 | 예상 비용 |
|---|---|---|
| `normalizeSttAdapterResult` | `call-` 접두 없는 platform 경로로 이동 | 파일 이동 + import 수정 |
| `call-storage-contract.mjs` | → `platform/storage-contract.mjs` | 파일 이동 + import 수정 |
| `schedule-extract.mjs` | → platform 경로, 계약 문서화 | 이동만 |
| main `request-id.js` + `idempotencyHit` + Blobs store | 키 도출부만 일반화 | 소규모 |

**이 4건은 지금 당장, 서로 독립적으로, main 동작 변경 0으로 진행 가능하다.**

## 3.4 참고 구현으로만 보존 (④)

- `public/auth.js` — 개인 Notion PAT를 localStorage에 두고 매 요청 헤더로 보내는 구조다. 2인 실사용 단계에서는 허용 가능하나 Closed Beta Gate(Decision 07 "Secret의 Client 노출 방지")를 통과하지 못한다. **Platform Auth의 원본으로 삼지 말 것.**
- `call-upload-preflight.mjs`의 파일 중복제거 — 목록 UX 전용. Platform Idempotency와 혼동 금지.
- `call-inbox.mjs` / `mock-call-review.mjs` / `call-folder-*` / 삼성 녹음파일 파서 — 순수 통화 도메인. 유지.

## 3.5 실제로 새로 만들어야 하는 것 (⑤) — 목록이 짧다

1. Workspace Context **Provider**(실제 값 공급자) — 계약은 PR #94로 완료
2. Retry **backoff / 최대시도 정책** — 현재 재개는 되지만 정책이 없다
3. **30일 휴지통** — Decision 05에 있으나 코드 없음
4. **Sync State / Audit 최소 계약** — 전무
5. **`SourceRef`** — Candidate 분류는 있으나 출처 추적이 없음

---

# 4. 불필요한 재개발 위험 (중복개발)

## P0-1. Usage/Cost 세 겹 — **가장 심각**

이미 두 벌이 있다.

| | `usage-ledger-contract.mjs` (서버) | `usage-meter.mjs` (클라이언트) |
|---|---|---|
| 식별 키 | `eventKey` = requestId:service:providerRequestId | `id` = timestamp-random |
| 시각 | 없음 | `createdAt` |
| 사용자 | **없음** | `userLabel` (자유입력 40자) |
| Workspace | **없음** | **없음** |
| 필드 | `storageBytes` 있음, `imageCount` 없음 | `imageCount`·`category`·`durationSeconds` 추가 |
| 저장 | 미연결 어댑터 | localStorage 실제 저장 + `usage-sync.mjs` 병합 |

여기에 Platform Usage Service를 얹으면 세 벌이다. 더 나쁜 것은 **클라이언트 쪽은 이미 사용자 기기에 실제 데이터를 쓰고 있다**는 점이다. 스키마를 나중에 바꾸면 마이그레이션 대상이 된다.

→ **조치: Platform Usage를 설계하기 전에 두 스키마를 하나로 합치고 `workspaceId`/`userId`를 넣는다.** 지금이 가장 싸다.

## P0-2. Idempotency 두 갈래 — 승격 원본 오지정

main에는 동작하는 완결형이, Draft에는 호출되지 않는 껍데기가 있다. 계획서는 후자를 1순위로 지정했다. 그대로 진행하면 **이미 검증된 구현을 버리고 미검증 구현을 표준화**하게 된다.

→ **조치: Issue #93의 후속 문단을 수정.** Platform Idempotency = main 구현의 일반화. 통화 Draft의 `createProcessingRequest`는 삭제 대상으로 표시.

## P1-3. Worklog/Notion 저장 경로 복제 — 이미 발생함

`netlify/functions/worklog-scan.mts`(253L, PR #83)는 `worklog.mts`(188L)와 **정렬 후 완전 일치 라인이 118줄**이다. `personalConnection`, `isProductionRequest`, `idempotencyStore`, `INSTITUTIONS/STATUSES/TYPES`, `json/richText/title/makeTitle`, Notion 속성 매핑이 통째로 복사되어 있다.

즉 **"Notion Adapter를 안 만들어서 생긴 중복"이 이미 실제로 발생했다.** 회의·메일·캡처 모듈이 붙으면 네 번째, 다섯 번째 복사가 생긴다.

→ Worklog/Notion Adapter는 `MODULE_REGISTRY.md`에서 "향후"로 되어 있으나, 실측 근거상 **Storage/Adapter 경계보다 우선순위가 높다.**

## P1-4. Adapter 경계 vs 기존 Provider 호출

현재는 모든 Provider가 `createUnconfiguredProviderAdapter`로 잠겨 있어 실제 중복은 없다. 다만 STT를 실제 연결하는 시점에 `stt-readiness.mjs`의 8개 체크와 Platform Adapter 경계가 각각 준비상태를 판단하게 되면 이중 게이트가 된다.

→ `stt-readiness`는 **통화 모듈의 출시 체크리스트**로 남기고, Platform은 `adapter.configured` 단일 사실만 소유한다.

## P1-5. `window.fetch` 3중 패치

main에서 `auth.js`(인증 헤더 주입)와 `request-id.js`(clientRequestId 주입)가 **순차적으로 `window.fetch`를 덮어쓴다**(index.html L122, L124 — 로드 순서 의존). Platform 클라이언트 계층이 같은 방식을 쓰면 3중이 되고, 순서가 바뀌면 저장 경로가 조용히 깨진다.

→ Platform 클라이언트는 fetch 패치 대신 **명시적 호출 계약**을 쓴다.

## P2-6. localStorage 키 네임스페이스 2종

main은 `worklogPersonalNotionToken` / `worklogAccessKey` / `worklogPendingRequestV1` (camelCase), Draft는 `worklog.usage.settings.v1` / `worklog.callProcessing.policy.v1` (dot+버전). Platform 저장 헬퍼가 통일을 시도하면 **기존 사용자 2명의 로그인 상태와 대기 중 요청이 날아간다.**

→ Platform 규약은 **신규 키에만** 적용. main 기존 키는 동결.

## P2-7. Preview QA Gate / AGENTS 문서 3중 작업

`docs/PREVIEW_QA_GATE.md`와 `AGENTS.md` 수정이 PR #77, PR #83, PR #90 세 곳에서 각각 진행 중이다. 병합 충돌과 내용 분기 위험.

---

# 5. 과도한 공통화 위험 (Platform에 올리면 안 되는 것)

## 5.1 Platform Status vs Domain Stage — 분리 방향 타당, 경계선은 조정 필요

§3.1 참조. 제안하신 분리는 **적절하다.** 근거: 현재 코드가 실제로 둘을 한 enum에 섞고 있고, `retry_wait`처럼 도메인 의미가 없는 값과 `transcribing`처럼 통화/회의 전용 값이 같은 전이표에 있다. 다만 `retry_wait` / `cleanup_pending` / `uploading` 은 Domain이 아니라 Platform 쪽이다.

## 5.2 Platform으로 올리면 안 되는 것 — 실제 파일 기준

| 대상 | 위치 | 이유 |
|---|---|---|
| `normalizeCallAnalysisResult` / `normalizeReport` | `call-analysis-normalize.mjs` | `headline/overview/discussionPoints/counterpartRequests/userCommitments/decisions/openQuestions` — 통화 보고서 서사 구조. 회의록과 다르다 |
| 삼성 녹음파일명 파싱 | `call-recording-parser.mjs` (139L) | 기기·제조사 종속 |
| 통화 검수 UX | `mock-call-review*.mjs` (715L) | 도메인 UI |
| 통화 폴더 UX | `call-folder-*.mjs` (786L) | Android 파일선택 도메인 |
| STT 요율표 | `usage-meter.mjs::DEFAULT_STT_RATES` | 값은 운영 설정, 구조만 공통 |
| 이미지 보정 / Otsu 이진화 / 페이지 관리 | `scanner-ocr.js`, `scanner-geometry.js` | 스캔 도메인 |
| PDF 생성 | `scanner-pdf.js` | 스캔 도메인 |
| `stt-readiness` 8개 체크 | `stt-readiness.mjs` | 통화 모듈 출시 체크리스트 |

## 5.3 특히 경계하는 것: `analysisCheckpoint`

runner의 `job.analysisCheckpoint`는 현재 **정규화된 CallReport 전체**를 담는다. 이대로 Platform Job에 올리면 Platform이 CallReport 스키마를 알게 된다.

→ Platform Job은 checkpoint를 **불투명한 blob(모듈이 해석)**으로 다뤄야 한다. 이것이 §3.1의 결합점 1번을 반드시 제거해야 하는 이유다.

## 5.4 과도하지 않은 것 (V1 범위 적절)

Decision 04의 "V1에서 의도적으로 만들지 않는 것" 목록(양방향 Sync 엔진, 복잡 Role, 정교한 Audit, Billing, 범용 Plugin Framework)은 **적절하다.** 2인 실사용 제품에 정확한 절제다. 이 부분은 반박할 것이 없다.

---

# 6. Workspace Context PR 감사 (Issue #93 / PR #94)

## 6.1 정량

- 프로덕션 71줄 / 테스트 123줄 (테스트 비율 1.7배)
- 전체 테스트 60/60 PASS (로컬 재현 확인)
- Netlify Deploy Preview SUCCESS, main 대비 behind 0
- 외부 호출·Secret·비용 0

## 6.2 정말 신규 구현이 필요한 영역이었나 → **YES**

검증: 통화 stack 8,090줄 + main 전체에서 `workspaceId`/`workspace_id`/`userId`/`user_id` **0건**. 기존 `auth.js`는 Notion 연결정보 보관소이지 사용자/조직 신원 모델이 아니다. **중복이 아니다.**

## 6.3 너무 이른 추상화인가 → **부분적으로 그렇다**

- 좋은 점: role을 `owner|member` 2개로 제한, 권한 판정 로직 없음, Provider 잠금, 조용한 truncate 거부. **Decision 04의 절제 원칙을 정확히 지켰다.**
- 문제: **소비자가 0이다.** 계약이 맞는지 증명할 수단이 현재 없다. 형상은 그럴듯하지만 검증되지 않았다.

→ 권고: PR #94를 그대로 두되, **바로 다음 PR에서 소비자 1개를 붙여 계약을 증명한다.** 최적 소비자는 Usage 이벤트다(§4 P0-1과 동시 해결).

## 6.4 구조적 지적: 배치 위치가 틀렸다 — **P1**

`netlify/shared/platform/workspace-context.mjs`는 **서버 전용 경로**다. 이 저장소는 번들러가 없다(`netlify.toml`: `publish = "public"`, 클라이언트는 `public/*.mjs`를 raw ES module로 직접 로드). 따라서 **브라우저 코드는 `netlify/shared/`를 import할 수 없다.**

그런데 Workspace Context가 필요한 지점의 상당수가 클라이언트다.

- `public/usage-meter.mjs` — 현재 `userLabel` 자유입력. `userId`/`workspaceId`가 들어가야 할 자리
- `public/call-processing-policy.mjs::buildCallProcessingFingerprint` — 현재 `userKey`. workspace 범위 idempotency에 필요
- Local-first 사용자 결과물의 소유자 표기

이 저장소에는 **이미 동형(isomorphic) 계약의 선례가 있다.** `netlify/shared/call-processing-runner.mjs` L4가 `../../public/call-processing-policy.mjs`를 import한다. 즉 **공유 계약은 `public/` 아래 두고 서버가 가져다 쓰는 것이 이 저장소의 확립된 패턴이다.**

→ 권고: `public/platform/workspace-context.mjs`로 이동. 지금 옮기면 import 수정 1줄, 나중에 옮기면 소비자 전부를 건드린다.

## 6.5 향후 Job / Usage / Schedule / Sync에서 재사용 적절한가 → **YES, 단 필드 1개 부족**

`{userId, workspaceId, role}`은 Job·Usage·Schedule에 충분하다. 다만 Decision 02는 소속과 행위자 분리(`workspace_id` / `created_by_user_id` / `assigned_user_id`)를 요구한다. 현재 Context는 "현재 접속자"만 표현하고 **"이 레코드를 만든 사람"을 표현할 수단이 없다.** 레코드 측에 `createdByUserId`를 두면 되므로 Context 자체 변경은 불필요하나, **다음 PR에서 명시적으로 규정**해야 한다.

## 6.6 구현 수준이 과하거나 부족한가 → **적정. 사소한 지적 2건**

- `MAX_CONTEXT_ID_LENGTH = 200`은 UUID(36자) 대비 넉넉하다. 문제는 아니나 형식 검증이 전혀 없어 임의 문자열이 통과한다. Provider 연결 시 형식 규약 필요.
- `requireWorkspaceContext(input)`가 `input.workspaceContext ?? input` 폴백을 한다. 편리하지만 호출부가 잘못된 객체를 넘겨도 조용히 통과할 여지가 있다. 소비자가 생기면 재검토.

## 6.7 종합 판정

> **PR #94는 승인 가능하다.** 범위·절제·테스트 밀도 모두 적절하고 main 위험 0이다. 단 **머지 전 `public/platform/`으로 이동**하고, **다음 PR에서 Usage 이벤트를 첫 소비자로 붙일 것**을 조건으로 한다.

---

# 7. 권장 Platform 개발 순서

## 7.1 현재 계획

`Workspace Context → Processing Job → Retry/Idempotency → Usage/Cost → Storage → Adapter → 최소 Auth/Sync/Retention/Audit → 통화 Pilot`

## 7.2 감사 소견

큰 틀은 타당하다. 다만 **비용 곡선을 반영하지 않았다.** Storage와 Adapter는 사실상 파일 이동(§3.3)인데 4~6번에 배치되어 있고, Usage는 이미 두 벌이 갈라져 매일 비싸지는데 4번에 있다.

## 7.3 권장 순서 (기존 자산 활용 기준)

| # | 단계 | 성격 | 근거 |
|---|---|---|---|
| **0** | **문서 사실관계 정정** (Issue #93 3개 전제) | 문서 | 잘못된 표 위에서 승격하면 되돌리기 비쌈. **모든 코드 작업의 선행조건** |
| **1** | Workspace Context: `public/platform/`로 이동 + PR #94 마무리 | ⑤ | 이미 완료. 위치만 수정 |
| **2** | **Usage/Cost 스키마 통일 + `workspaceId`/`userId` 주입** | ③ | **P0. 두 벌이 세 벌 되기 전. 동시에 #94의 첫 소비자 확보** |
| **3** | 무비용 승격 3건 일괄: Storage 계약 / STT 계약 / `schedule-extract` 이동 | ①② | 파일 이동 수준. main 변경 0. 독립 병렬 가능 |
| **4** | **Idempotency: main 구현 일반화** (통화 Draft 껍데기 폐기) | ② | 승격 원본 정정. 검증된 코드 사용 |
| **5** | Processing Job: 결합 3곳 제거 + status/stage 3분할 | ③ | 50줄 미만. 2번이 끝나야 `recordUsage` 시그니처가 확정됨 |
| **6** | Retry backoff/최대시도 정책 | ⑤ | 5번 위에 얹음 |
| **7** | AI Adapter envelope/payload 분리 + `SourceRef` + Candidate 계약 | ③ | 분류체계는 이미 존재 |
| **8** | **통화 Integration Checkpoint (Pilot)** | — | §8 |
| **9** | 최소 Auth / Sync / Retention / Audit 계약 | ⑤ | Pilot이 실제 필요를 알려준 뒤 |
| **10** | Worklog/Notion Adapter | ③ | 이미 118줄 복제 발생. 회의/메일 전에 필수 |

### 원안과의 차이 4가지

1. **Usage를 4번 → 2번으로.** 유일하게 "시간이 지날수록 비싸지는" 항목이다(클라이언트에 실데이터 축적 중).
2. **Idempotency 승격 원본을 통화 Draft → main으로.** 사실관계 정정.
3. **Storage/Adapter를 3번으로 앞당김.** 거의 무비용이고 다른 작업과 독립이므로 먼저 치우면 stack이 얇아진다.
4. **최소 Auth/Sync/Retention/Audit을 Pilot 이후로.** Pilot 전에 만들면 소비자 없는 계약이 4개 더 생긴다(#94에서 이미 겪은 문제).

## 7.4 병렬로 즉시 권고하는 것: 통화 stack 얕게 재정리

PR #81은 main 대비 **177 커밋 / 81 파일 / 8,090줄, 10단 stack**이다. 이 상태로 Platform 작업을 계속하면 두 개의 큰 덩어리가 각자 자라 병합이 불가능해진다.

→ 권고: **stack을 순서대로 병합하지 말고**, main에서 새로 얇은 PR 2~3개를 잘라낸다(위 3번 항목 = 계약 파일 이동 + 테스트, UI 0, main 동작 변경 0). 그 다음 통화 stack을 그 위로 rebase하면 **약 1,500줄이 stack에서 빠진다.** `MODULE_REGISTRY.md` §5의 "stack을 얕게 재정리한다"를 구체적으로 실행하는 방법이다.

---

# 8. 첫 Integration Checkpoint 조건

## 8.1 "최소 뼈대 5개 완성 후"는 **너무 늦다**

원안은 Workspace + Job + Retry/Idempotency + Usage + Storage/Adapter 5개를 모두 만든 뒤 Pilot을 연다. 문제는 그동안 통화 stack이 계속 자란다는 것이다.

Pilot을 열어야 하는 이유는 "중복을 지금 제거하려고"가 아니라 **"통화 Draft의 지속되는 스키마를 Platform 기준으로 고정하려고"**다. 그렇다면 필요한 것은 **지속 데이터 모양을 바꾸는 항목뿐**이다.

## 8.2 실제 최소 조건 — 5개 중 3개

| 항목 | Pilot 전 필요? | 이유 |
|---|---|---|
| Workspace Context | **필수** | 모든 레코드의 소유자 필드 |
| Usage/Cost 통일 스키마 | **필수** | 사용자 기기에 이미 데이터가 쌓이고 있음 |
| Processing Job status/stage | **필수** | Job 지속 레코드 모양이 바뀜 |
| Storage 경계 | 불필요 | 파일 이동. Pilot 중 적용 가능 |
| Adapter 경계 | 불필요 | 모든 Provider가 잠금 상태. 지속 데이터 없음 |

> **권고: 3개가 되는 즉시 Pilot을 연다. Storage/Adapter는 Pilot 진행 중 병렬 적용한다.**

## 8.3 Pilot 분류표 검토 — 현실적인가 → **YES, 5번째 항목만 조정**

제안하신 5분류를 실제 파일에 적용해 보았다.

| 분류 | 실제 해당 자산 | 현실성 |
|---|---|---|
| 통화 전용 → 유지 | 삼성 파서, 통화 폴더 UX, 검수 UX, CallReport 서사, 통화 AI 프롬프트 (~2,100줄) | 명확 |
| Platform과 동일 → 교체 | Storage 계약, STT 계약 | 명확 |
| 일부만 공통 → 추출 | runner, AI 계약, Candidate 분류, Retention 정책 | 명확 |
| Mock/중복 → 제거 | `createProcessingRequest`(미사용), `usage-ledger` vs `usage-meter` 중복분 | 명확 |
| 기존 통화 구현이 더 우수 → Platform 승격 | **runner 전체, Retention 정책** | **적용됨 — 다만 이건 Pilot에서 발견할 일이 아니라 이미 판명된 사실** |

→ 5번째 분류의 실질은 이미 이 감사에서 확정되었다(runner·Retention은 Platform보다 통화 Draft 쪽이 낫다). **Pilot은 이 판정을 재검토하는 자리가 아니라 실행하는 자리로 잡아야 한다.** 그래야 Pilot이 늘어지지 않는다.

## 8.4 Pilot 종료 조건 제안

- 통화 모듈이 Platform Job/Usage/Storage/Workspace를 **소비만** 하고 자체 구현을 갖지 않음
- `netlify/shared/` 안에 `call-` 접두 공통 계약 파일이 0개
- 통화 stack 깊이 3단 이하
- 기존 통화 테스트 전부 통과 (회귀 0)
- main 실사용 경로 무변경

---

# 9. main 실사용 보호 전략

## 9.1 실측 위험 지점

| 위험 | 위치 | 심각도 |
|---|---|---|
| `window.fetch` 이중 패치 순서 의존 | `auth.js`(L122) → `request-id.js`(L124) | **높음.** 순서 변경 시 저장 경로 조용히 파손 |
| localStorage 키 2종 혼재 | main camelCase vs Draft dot-notation | **높음.** 키 변경 시 로그인/대기요청 소실 |
| `index.html` 수동 script 목록 | 13개 태그, 로드 순서 의존, 버전 쿼리 수동 | 중간 |
| `sw.js` 캐시 목록 | 스캔 Draft가 수정 중 | 중간. 구버전 클라이언트 잔류 |
| `netlify.toml` build command | 스캔 Draft가 `npm test` → `npm run build`로 변경 | 중간. main 배포 파이프라인 변경 |
| Notion 속성명 하드코딩 | `worklog.mts` + `worklog-scan.mts` 2곳 | 중간. Adapter 도입 시 동시 수정 필요 |

## 9.2 안전한 Migration 순서 (4단계)

**Stage A — 계약만 (main 위험 0)**
Platform 계약 파일 추가 + 단위테스트만. **main 코드에서 import하지 않는다.** PR #94가 정확히 이 단계이며, §7.3의 1~4번도 여기 해당한다. 이 단계는 몇 개를 병렬로 진행해도 안전하다.

**Stage B — 신규 모듈만 소비**
통화·스캔 등 **아직 main에 없는 모듈**만 Platform 계약을 소비한다. main 실사용 경로(`app.js`/`quick-save.js`/`manual-input.js`/`briefing*.js`/`worklog.mts`)는 손대지 않는다. 여기서 계약이 실전 검증된다.

**Stage C — main을 계약 뒤로 (한 번에 하나)**
Stage B에서 검증된 계약만 main에 적용한다. 순서는 **위험 역순**으로:

1. `schedule-extract` → Platform 경로 (순수함수, 부작용 0) — **가장 안전**
2. Usage 기록 추가 (기존 경로에 관측만 추가, 동작 변경 0)
3. Idempotency 일반화 (기존 Blobs store 키 형식 유지, 신규 키만 추가)
4. Notion Adapter 도입 (`worklog.mts` + `worklog-scan.mts` 동시)
5. Auth/Workspace — **마지막.** 여기만 사용자 2명의 로그인 상태에 실제 영향

**Stage D — 정리**
중복 제거, 참고 구현 삭제.

## 9.3 매 PR 불변식 (Stage C 필수 체크)

- [ ] main의 기존 localStorage 키를 읽기/쓰기/삭제하지 않는다
- [ ] `window.fetch` 패치를 추가하지 않는다
- [ ] `index.html` script 순서를 바꾸지 않는다 (추가는 목록 끝)
- [ ] `sw.js` 자산 목록 변경 시 캐시 버전 bump
- [ ] Notion 속성명·환경변수명 무변경 (AGENTS.md 규칙)
- [ ] 저장 실패 시 원문 보존 동작 회귀 테스트 통과
- [ ] Deploy Preview에서 **실기기 저장 1회** 수동 확인

## 9.4 되돌릴 수 있게 만들기

Stage C의 각 항목은 **단일 PR / 단일 관심사**로 유지한다. Usage 기록 추가와 Idempotency 일반화를 한 PR에 넣으면 문제 발생 시 무엇을 되돌려야 할지 알 수 없다. 2인 실사용 제품에서 **되돌릴 수 있음**은 완성도보다 중요하다.

---

# 10. P0 / P1 / P2 지적사항

## P0 — 지금 막아야 함

| ID | 지적 | 근거 | 조치 |
|---|---|---|---|
| **P0-1** | Usage/Cost 두 스키마가 이미 갈라져 있고 클라이언트는 실데이터 축적 중. Platform이 세 번째가 될 위험 | `usage-ledger-contract.mjs` vs `usage-meter.mjs` 필드 불일치 | Platform Usage 설계 **전에** 두 벌 통일 + `workspaceId`/`userId` 주입 |
| **P0-2** | Issue #93이 통화 Draft의 Idempotency를 재사용 1순위로 지정. 실제로는 미사용 껍데기 | `createProcessingRequest` 호출자 0건, key 소비자 0건 | Issue #93 후속 문단 정정. 승격 원본을 main으로 |
| **P0-3** | Issue #93의 "통화 Draft에 user_id/workspace_id가 일부 있다"는 사실과 다름 | 통화 stack 전체 0건 | 문장 정정. retrofit 비용 재산정 |
| **P0-4** | 통화 stack 177커밋/8,090줄/10단. Platform 작업과 동시 성장 시 병합 불가 | 브랜치 실측 | 계약 파일을 main에서 새로 얇게 잘라내고 stack을 그 위로 rebase (≈1,500줄 감소) |

## P1 — Platform 작업 전 정리 필요

| ID | 지적 | 근거 | 조치 |
|---|---|---|---|
| **P1-1** | PR #94가 서버 전용 경로에 있어 클라이언트가 import 불가 | 번들러 없음. `publish="public"`. 선례는 `public/call-processing-policy.mjs` | `public/platform/`으로 이동 (지금 1줄, 나중엔 소비자 전부) |
| **P1-2** | PR #94에 소비자 0 → 계약 미검증 | 코드 확인 | 다음 PR에서 Usage 이벤트를 첫 소비자로 (P0-1과 동시) |
| **P1-3** | `worklog-scan.mts`가 `worklog.mts`와 118줄 동일 복제 | 정렬 비교 실측 | Notion Adapter 우선순위를 "향후"에서 상향 |
| **P1-4** | Processing Job이 Platform 관심사와 Domain stage를 한 enum에 혼재 | `PROCESSING_STATUSES` 10개 | 3분할 (§3.1). `retry_wait`/`cleanup_pending`/`uploading`은 Platform |
| **P1-5** | Retry에 시도횟수/backoff/최대재시도 없음 | runner 전체 확인 | 재개 로직 승격 시 정책 신규 추가 |
| **P1-6** | `job.analysisCheckpoint`가 CallReport 전체를 담음 | runner L~230 | Platform Job은 checkpoint를 불투명 blob으로 |
| **P1-7** | `window.fetch` 이중 패치, 순서 의존 | index.html L122/L124 | Platform 클라이언트는 fetch 패치 금지 |
| **P1-8** | `schedule-extract.mjs`가 소비자 3개인데 어느 Platform 문서에도 없음 | 3브랜치 grep | Platform 자산으로 등재 + 승격 |

## P2 — Migration 시 정리 가능

| ID | 지적 | 조치 |
|---|---|---|
| **P2-1** | localStorage 키 규약 2종 | 신규 키만 새 규약. main 기존 키 동결 |
| **P2-2** | `PREVIEW_QA_GATE.md`/`AGENTS.md`가 PR #77/#83/#90 3곳에서 중복 수정 | 한 PR로 통합 |
| **P2-3** | `MAX_CONTEXT_ID_LENGTH=200`, ID 형식 검증 없음 | Provider 연결 시 형식 규약 |
| **P2-4** | `stt-readiness` 8체크와 Platform adapter.configured 이중 게이트 소지 | readiness는 통화 출시 체크리스트로 한정 |
| **P2-5** | `index.html` script 태그 수동 관리 (13개) | 모듈 증가 시 로더 정리 |
| **P2-6** | 스캔 Draft가 `netlify.toml` build command 변경 + npm deps 3종 추가 | main 배포 영향 별도 검수 |
| **P2-7** | Decision 05의 30일 휴지통 미구현 | Retention 승격 시 신규 |

---

# 11. 최종 결론

| # | 질문 | 답 | 근거 |
|---|---|---|---|
| 1 | Platform Foundation을 별도로 바닥부터 만들 필요가 있는가? | **NO** | Job ~85% / Storage ~90% / Adapter ~85% / Usage ~70% / Idempotency ~75%가 이미 존재하고 테스트도 있다. 신규가 정말 필요한 것은 Workspace Provider, Retry backoff, 휴지통, Sync/Audit 계약, `SourceRef` 5개뿐 |
| 2 | Existing-first Platform Extraction 전략이 적절한가? | **YES** | 자산 인벤토리가 전략을 강하게 지지한다. 다만 §10 P0-2/P0-3의 근거표 오류를 먼저 고쳐야 전략이 제대로 작동한다 |
| 3 | 현재 main을 계속 실사용하면서 병렬 개발해도 되는가? | **YES** | §9의 4단계(계약만 → 신규 모듈만 소비 → main 하나씩 → 정리)와 §9.3 불변식을 지키는 조건. Stage A는 위험 0 |
| 4 | 통화 Draft를 Platform의 주요 참고 구현으로 써도 되는가? | **CONDITIONAL** | **YES**: Processing Job runner, Storage 계약, STT 계약, Retention 정책 — 오히려 Platform보다 낫다. **NO**: Idempotency(미사용 껍데기, main이 우월), Usage(두 벌 분기, 식별자 없음), Auth/Workspace(존재하지 않음) |
| 5 | Workspace Context부터 시작한 것이 적절한가? | **CONDITIONAL** | 대상 선정·범위 절제·테스트 밀도는 적절. 단 ⓐ 서버 전용 경로라 클라이언트가 못 쓴다(P1-1) ⓑ 소비자 0이라 계약이 미검증(P1-2). 두 조건 충족 시 적절 |
| 6 | Processing Job은 새로 만들기보다 기존 통화 구현에서 승격해야 하는가? | **YES** | runner는 이미 9개 의존성이 전부 주입식이다. 도메인 결합 3곳(총 50줄 미만)만 제거하면 회의정리가 그대로 재사용 가능. 새 엔진은 순손실 |
| 7 | Platform 최소 뼈대 뒤 통화 Migration Pilot이 적절한가? | **CONDITIONAL** | 방향은 맞으나 **5개 전부는 너무 늦다.** 지속 데이터 모양을 바꾸는 3개(Workspace / Usage / Job status·stage)가 되는 즉시 열고, Storage·Adapter는 Pilot 중 병렬 적용 |
| 8 | 현재 계획에서 즉시 수정해야 할 중대한 문제가 있는가? | **YES** | 4건. P0-1 Usage 세 겹 위험 / P0-2 Idempotency 승격 원본 오지정 / P0-3 Issue #93 사실관계 오류 / P0-4 통화 stack 깊이. 모두 **문서 정정과 순서 조정으로 해결 가능하며, 설계 변경은 필요 없다** |

---

# 12. 감사자 최종 소견

이번 감사의 핵심 질문은 다음과 같았다.

> "업무수첩을 새로 만드는 것이 아니라, 지금까지 이미 잘 만들어온 업무수첩을 가장 적은 재작업으로 제대로 된 제품 구조로 승격시키고 있는가?"

**대체로 그렇다.** 그리고 예상보다 더 그렇다. 통화 Draft의 Processing Job runner는 이 감사에서 발견한 가장 좋은 코드이고, 의존성 주입 구조 덕분에 Platform으로 올리는 비용이 거의 없다. main의 idempotency는 조용히 잘 만들어진 완결형이다. Decision 04의 "V1에서 만들지 않는 것" 목록은 2인 제품에 맞는 정확한 절제다. `PROJECT_CHARTER.md` §4("정상 동작 중인 기능은 모듈화를 이유로 재작성하지 않는다")는 실제로 지켜지고 있다.

문제는 설계가 아니라 **재고 파악**이다. 계획서가 자산의 위치를 세 군데에서 잘못 짚었고(Idempotency는 main에 있는데 Draft에서 찾고, Workspace는 Draft에 없는데 있다고 적었고, `schedule-extract`는 이미 3개 모듈이 쓰는데 목록에 없다), 그 결과 **가장 검증된 코드를 버리고 가장 미검증인 코드를 표준화할 뻔했다.**

이것은 방향 전환이 필요한 문제가 아니다. 표를 고치고 순서를 두 칸 바꾸면 된다.

한 가지 더 강조한다. 이 프로젝트에서 가장 큰 위험은 잘못된 아키텍처가 아니라 **통화 stack 177커밋**이다. Platform이 아무리 잘 설계돼도, 8,090줄짜리 10단 stack과 나란히 자라면 둘 다 병합할 수 없게 된다. §7.4의 stack 얕게 재정리를 Platform 2단계와 **동시에** 진행할 것을 권고한다.

새 코드가 적을수록 좋다는 기준에서, 이 감사의 결론은 다음과 같다.

> **현재 계획대로 가면 대략 2,000줄을 새로 쓰게 된다. 이 감사의 권고를 반영하면 대략 500줄이면 된다. 나머지 1,500줄은 이미 저장소에 있고, 테스트도 이미 붙어 있다.**
