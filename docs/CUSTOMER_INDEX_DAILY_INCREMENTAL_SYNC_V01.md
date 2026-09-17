# Customer Index Daily Incremental Sync 0.1

기준 Issue: #309
관련 Source-of-Truth 문서 PR: #306

## 목적

Google Drive의 `메티스업무/고객 상담파일`에서 이전 성공 실행 이후 신규·변경된 항목만 하루 1회 확인하고, 별도 LIVE 고객 인덱스에 누적 반영한다.

최종 MASTER 파일 `메티스_전체고객인덱스_MASTER_v1_최종_v5.xlsx`는 읽기 전용 기준원본이다. 자동 동기화는 MASTER 파일을 수정하지 않는다. 기존 `DEV_메티스_고객인덱스_v5_STAGING`은 CRM DEV 검색용 파생본으로 유지하며, 일일 변경 감시 원본으로 사용하지 않는다.

## MASTER v5에서 승계한 운영 규칙

MASTER v5의 `20_증분스캔로그`는 다음 절차를 고정한다.

`새 경로/변경 알림 접수 → 기존 키 검색 → 확실한 기존인은 이력 추가 → 확실한 신규는 새 키 → 불명확하면 검토`

LIVE Identity의 기준키는 `P-[A-F0-9]{12}` 형식이다. 기존 고객과 연결이 확실하면 기존 P-키를 유지한다. 이름만 일치하거나 동명이인·가족관계·소개자 여부가 불명확하면 자동 병합하지 않는다.

## 구조

```text
Google Drive Changes API (metadata.readonly)
  → fileId/folderId + modifiedTime 변화
  → 감시 루트 하위 경로 확인
  → 기존 Drive 연결 우선 조회
     ├─ 기존 연결 1개: 기존 P-키로 이력 추가
     ├─ 명백한 신규 단일 고객 폴더: 새 P-키 생성
     └─ 그 외: 확인대기
  → Source Item / Link / Review / Event / Run Log
  → 성공 후 Drive page token 갱신
```

Google Drive는 외부 Connector다. Provider 인증·조회는 `google-drive-adapter.mjs` 안에 한정하며, 고객 판정 규칙은 `daily-sync.mjs`가 소유한다.

## 첫 실행

LIVE 테이블에는 먼저 MASTER v5 `44_활성Identity운영마스터`의 활성 사람 Identity를 승인된 운영 절차로 적재해야 한다.

필수 사전조건:

1. `운영Identity 포함=예` 행만 LIVE Identity로 적재
2. 기존 P-키를 그대로 보존
3. 사람 이름·상태 등 고객정보를 GitHub fixture나 로그에 저장하지 않음
4. MASTER import 행 수와 빈 키·중복 키 검증
5. 과거 Drive 연결은 MASTER `20_증분스캔로그`의 식별값을 가능한 범위에서 Source Link로 적재

체크포인트가 없는 첫 scheduled run은 현재 Drive `startPageToken`만 저장하고 종료한다. 과거 전체 폴더를 자동 재스캔하지 않는다. 이후 실행부터 그 page token 이후 변경만 처리한다.

## 자동 판정

### 기존 Identity

현재 변경 항목이나 상위 폴더의 Drive ID가 이미 하나의 P-키와 연결되어 있을 때만 자동으로 기존 Identity에 연결한다.

이름만 같은 경우는 자동 연결하지 않는다.

### 신규 Identity

다음 조건을 모두 만족할 때만 새 P-키를 만든다.

- 새로 생성된 Drive 폴더
- 폴더명에서 한 사람 이름만 명확히 추출
- 소개·배우자·부모·자녀·가족·관계자 표현 없음
- 기존 LIVE Identity에 같은 정규화 이름 후보 없음
- 기존 Drive 연결 없음

새 키는 폴더 ID에서 결정적으로 생성한다. 동일 폴더 재처리는 같은 키로 수렴한다. 신규 행의 사람유형은 `고객후보`, Identity 상태는 `자동생성-신규폴더`다.

### 확인대기

다음은 자동 병합하지 않는다.

- 이름만 일치
- 같은 이름의 후보가 여러 명
- 폴더명에 여러 사람 이름
- 괄호 안 다른 이름
- 소개자·배우자·부모·자녀·가족·관계자 표시
- 과거에 생성됐지만 새로 감시 폴더로 이동된 폴더
- 파일명만으로 발견된 신규 인물

### 삭제·이동

Drive 항목이 삭제·휴지통·감시 폴더 밖 이동 상태가 되어도 고객 Identity나 과거 링크를 삭제하지 않는다. Source Item 상태와 이벤트만 갱신한다.

## 저장 테이블

- `customer_index_live_identities`: MASTER에서 분리된 LIVE 사람 Identity
- `customer_index_drive_items`: Drive 항목의 현재 메타데이터와 fingerprint
- `customer_index_source_links`: Drive 항목과 P-키 연결
- `customer_index_review_queue`: 자동 확정 금지 항목
- `customer_index_sync_events`: 항목별 판단 이력
- `customer_index_sync_runs`: 실행별 결과
- `customer_index_sync_checkpoints`: Drive Changes page token

모든 테이블은 `service_role` 전용이다. 브라우저와 `anon`/`authenticated` 역할에는 직접 권한을 주지 않는다.

## 환경변수

실제 ID와 비밀값은 코드나 PR에 넣지 않는다.

| 변수 | 설명 |
| --- | --- |
| `CUSTOMER_INDEX_SYNC_ENABLED` | `true`일 때만 실행 |
| `CUSTOMER_INDEX_SYNC_WORKSPACE_ID` | LIVE Identity 소유 Workspace UUID |
| `CUSTOMER_INDEX_WATCH_FOLDER_ID` | `고객 상담파일` Drive folderId |
| `CUSTOMER_INDEX_MASTER_FILE_ID` | MASTER v5 Drive fileId. 감시 폴더와 다른지 guard에 사용 |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL` | 최소권한 서비스 계정 이메일 |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY` | 서버 전용 private key |
| `SUPABASE_URL` | Data Core Supabase URL |
| `SUPABASE_SECRET_KEY` | 서버 전용 Supabase secret key |

서비스 계정에는 감시 대상 폴더와 MASTER 파일에 대한 읽기 권한만 부여한다. 구현은 `drive.metadata.readonly` scope를 사용하며 Drive 쓰기 API를 제공하지 않는다.

## 실행

`customer-index-daily-sync.mts`는 매일 00:15 UTC, 즉 Asia/Seoul 09:15에 실행한다.

- 설정 누락 또는 `CUSTOMER_INDEX_SYNC_ENABLED != true`: fail closed
- 변경 없음: Identity/Link/Review 변경 0건, run 상태 `noop`
- 성공: 모든 변경 처리가 끝난 뒤에만 새 page token 저장
- 실패: 기존 page token 유지. 다음 실행이 같은 변경을 다시 처리하며 fingerprint/event key로 멱등 수렴

Netlify console에는 상태와 건수, 오류코드만 기록한다. 고객명·전화번호·Drive 경로는 출력하지 않는다.

## 배포 전 확인

1. migration을 Preview/DEV Supabase에만 적용
2. MASTER v5 활성 Identity seed 행 수와 키 무결성 검증
3. Drive 기존 연결 seed 검증
4. 환경변수 등록 후 `CUSTOMER_INDEX_SYNC_ENABLED`는 계속 `false`
5. 첫 수동 실행이 `checkpoint_initialized`인지 확인
6. 합성 테스트 폴더로 기존/신규/확인대기/이동 시나리오 확인
7. 확인대기 UI 또는 운영 조회 경로 준비
8. 대표자 승인 후 scheduled sync 활성화

Production 데이터 migration과 실제 활성화는 이 코드 PR의 범위가 아니다.
