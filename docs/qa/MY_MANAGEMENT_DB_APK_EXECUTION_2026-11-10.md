# 내 관리 DB·누적 QA APK 실행 기록

2026-11-10 사용자가 DB 적용 후 QA APK 제작을 승인했다. 운영/Play 배포와 main 병합 승인은 포함하지 않는다.

## DB 적용

대상은 공유 프로젝트 `jgsxpdflgkqroecfjzxq` / `worklog`. 공급자 화면에서 최근 물리 백업 `2026-11-09 21:23:55 UTC`(11월10일 06:23:55 KST), 최근 7일 목록과 Restore 경로를 확인했다. PITR는 미활성이고 신규 유료 옵션을 켜지 않았다. 실제 백업 복원은 실행/검증하지 않았다. Storage 물체가 이 DB 백업에 포함되지 않는다는 공급자 안내도 확인했다.

승인된 파일 3개를 개별 migration으로 적용했다. 적용 쿼리에는 트랜잭션 범위 lock_timeout 5초, statement_timeout 30초를 추가했다. SQL 본문 검증값은 이전 계획과 같다. 기존 구독 2개 migration은 재적용하지 않았다.

| 실제 version | name | 원래 검토한 파일 version |
|---|---|---|
| 20261110065304 | regular_expenses_v1 | 20261109232907 |
| 20261110065316 | repeating_work_v1 | 20261109233147 |
| 20261110065340 | habits_v1 | 20261109234334 |

migration 도구가 실제 적용 시각을 이력 version으로 부여해 파일명과 테스트 참조를 실제 version으로 맞췄다. SQL을 다시 실행한 것이 아니다. 기존 문서의 옛 version은 적용 전 검토 기록이다.

기존 구독 10건을 원래 열 순서/직렬화 방식으로 DB 내부 집계·해시 비교해 건수와 원래 필드 전체 내용이 적용 전후 일치했다. 사용자 행 원문을 출력하거나 시험 행을 쓰지 않았다. 처음 비교한 jsonb 표현은 원래 row_to_json과 공백/순서가 달라 비교 근거로 쓰지 않았고, 같은 원래 열/row_to_json 방식으로 확인했다.

적용 후 새 6개 테이블의 RLS=true, anon SELECT=false, authenticated SELECT=true·DELETE=false를 확인했다. 변경/조회 RPC는 security invoker, 빈 search_path, anon EXECUTE=false다. 원본 보호 trigger 2개와 실제 migration 이력을 확인했다. 보안 advisor에서 이번 새 객체 관련 발견은 없었고 기존 프로젝트 경고 분류/건수는 유지됐다. 프로젝트 전체 경고 0이라는 뜻은 아니다.

실제 파일명에 맞춘 격리 PGlite SQL/RLS 검사 11/11 PASS. 소유자/타인/anon·같은 요청·버전·완료/Undo·종료 후 이력·권한 회수 검사는 격리 DB에서만 실행했다. 공유 실제 사용자 기록으로 등록·완료를 시험하지 않았다.

## QA 서버

통합 #537은 base가 Netlify 프리뷰 대상 브랜치가 아니므로 후보 주소가 404였다. Netlify UI 로그인은 Invalid state key로 실패해 재시도하지 않았다. 기존 main 기반 반복업무 PR #535 프리뷰를 재사용한다.

통합 소스와 #535 서버 차이는 기존 감사의 공유 모듈 3개뿐이었다. action-engine-v1, briefing-completeness, worklog-data-core-briefing-reader를 통합본과 동일하게 반영했다. 새 구현/서버를 만들지 않았다. 이 서버는 통합본과 동일한 Netlify 함수/공유 소스를 사용한다.

- 서버 소스: `5f26df8094f9d2611fad51cf634052ed293c12e8`.
- Netlify deploy: `6af2c18705dd84e41143d444`, context deploy-preview, state ready.
- 주소: `https://deploy-preview-535--worklog-voice-pwa.netlify.app`.
- `/api/supabase-auth-config` 실제 응답 200: configured=true, dataSchema=worklog, host=jgsxpdflgkqroecfjzxq.supabase.co, dataCorePrimaryEnabled=true. 키 값은 출력하지 않았다.
- 운영 primary deploy는 갱신하지 않았다. Preview 역시 공유 DB를 사용한다.

## APK 후보와 검사 경계

최신 통합 PR의 migration 이력 정렬 커밋을 후보로 고정하고 기존 Mobile App workflow를 한 번 수동 실행한다. 사용자 설치용은 worklog-mobile-auth-ux-arm64-apk이며 physical-qa-bundle 합성 홈 APK와 구분한다. build_android=true, qa_api_base_url은 위 #535 Preview로 명시한다.

빌드 완료 뒤 qa-build-info의 sourceSha/API 주소·manifest package/versionCode·인증서·APK SHA-256을 기록한다. 이전 제공 APK의 인증서와 비교하며 앱 삭제/데이터 초기화를 요구하지 않는다. 설치본 자체에 대한 검수는 연결된 실제 기기가 없어 미실행이다.

이 기록 작성 시점에 APK dispatch/다운로드 검증 결과는 아직 추가 전이다. 이후 결과는 PR에 기록한다. 기존 1,308 자동검사와 TypeScript/Metro 근거는 유지하며, 파일명 참조 변경은 격리 SQL을 재검증했다. APK 빌드 성공과 Android 실제 사용 성공은 구분한다.
