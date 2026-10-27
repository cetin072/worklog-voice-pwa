# 홈 알림 표시·편집 진입 검수

기준 main: 056a6339f4352e92c4a023ebd05dddeb7c9bc201. 별도 Draft 검토 범위다. #470 업데이트/아이콘 작업과 QA 패키지 작업은 포함하지 않는다.

## 변경과 데이터 경계

- 일정과 업무/메모는 같은 compact 버튼을 쓴다. 종 + 문자, 최소 44pt, 높이 고정/문자 잘림 없음. 상세는 기존 설정 화면으로 연결한다. 긴 범례는 도움말을 눌러 읽는다.
- 기기 저장 기록과 실제 native 예약을 함께 확인한 경우만 녹색 예약됨이다. 확인된 미설정은 회색, 미확인/권한 문제는 주황이다. 취소·완료는 별도 문구이며 전달 완료를 추정하지 않는다.
- 업무 연결은 schedule.metadata의 workRecordId/reminderWorkRecordId UUID를 사용한다. 제목으로 연결하지 않는다. 50건 단위 연결 조회, 기존 100건 단위 소유 일정 조회, 전체 목록당 native/secure-storage snapshot 각 1회. 정확한 count가 맞지 않거나 중복 연결/누락/오프라인이면 unknown이다. 연결 없음만으로 알림 없음을 주장하지 않는다.
- 사용자/화면/새로고침/설정 닫힘에 따라 evidence를 교체한다. 늦은 결과는 session/sync epoch와 effect cleanup으로 거부한다. 알림 예약/취소·기존 revision 동기화 계약은 변경하지 않는다.
- 연필은 제목을 즉시 편집할 수 있다. 캐시 또는 완전한 날짜·시간 seed가 있으면 입력/저장 전체를 즉시 열고 상세 확인을 비차단으로 수행한다. 날짜·시간은 한 쌍으로 dirty 보호한다. 저장 시작/닫기/다른 항목/계정 종료 이후 응답은 적용하지 않는다. 오류에서 입력을 지우지 않는다.
- 기존 홈 응답은 dueKey만 있고 dueTime/종류 변환 허용 여부가 없을 수 있다. 이 경우 시간·종류 확인은 필수 대기로 남는다. 서버의 optional dueTime 전달은 알려진 due_has_time만 사용한다. 기존 fast RPC가 해당 필드를 주지 않으면 생략한다. DB/RPC/schema를 수정하지 않았고 서버 배포하지 않았다. 따라서 현재 설치본/이전 서버에서 모든 첫 편집 대기가 사라진다고 주장하지 않는다.
- 검색 편집은 allowTitleWhileLoading 기본 false를 유지한다. 기존 검색 경로에 dirty 보호 없이 조기 입력을 허용하지 않는다.
- 직접 삭제, voice footer JSX/배치, 대기 표시, auth/브랜드 로딩, 서명/패키지/권한 설정을 보존한다.

## 자동 검증

저장소 전체 `npm test`, `npm --prefix mobile run typecheck`, Android Expo export, `git diff --check`로 검증한다. 실행 결과와 최종 SHA는 Draft PR/인계문에 기록한다.

추가 런타임 검사는 실제 production 함수/컴포넌트에 native/network/React 경계 mock을 주입한다. 상하 동일 표현, 44pt/줄바꿈 계약, 101개 연결의 3회 batch, 중복/누락/잘린 응답, 계정 변경, provider cleanup, 실제 Supabase SDK query 직렬화, 0/1/복수 예약, 과거/취소/권한/unknown, dirty 입력·빠른 다른 연필·offline·취소 후 늦은 응답을 확인한다. 기존 홈 JSX 검사는 empty/populated/overdue/schedules/mixed 및 직접 삭제를 유지한다. 이는 실제 Android OS 알림 전달이나 픽셀 검사가 아니다.

## Work에서 이어받을 검수

1. 이 Draft 브랜치 최신 SHA를 checkout하고 위 검사를 실행한다. main 병합/Ready/배포는 하지 않는다.
2. 허용된 Development Build + Metro에서 합성 데이터로 320/390px, 큰 글씨, desktop을 실제 렌더링한다. 상하 상태 일치, touch target, 문구 줄바꿈, voice widget 위치/겹침을 비교한다. UI 코드 보존은 픽셀 보존의 증거를 대신하지 않는다.
3. 계정 A→B, 완료/삭제/수정/설정 취소·뒤로·연속 클릭·새로고침, 실제 알림 권한 회수/회복과 예약 변경을 확인한다. 운영 개인 기록을 QA용으로 변경하지 않는다. 예약 확인과 알림 도착을 구분한다.
4. 기존 로그인·권한이 제공된 Work 환경에서만 실행한다. 서명/권한 변경, main/Production/Play 제출, 웹 정기 배포는 제외한다.

현재 환경 제한: 과거 로컬 브라우저 접근 ERR_BLOCKED_BY_ADMINISTRATOR 및 artifact proxy 403은 재시도/우회하지 않았다. 새 Library 두 파일은 지원 helper에서 download failed로 읽을 수 있는 bytes를 얻지 못했다. 이 실행자는 원본 픽셀을 검사하지 못했다. 개인 첨부/실제 업무 문구는 저장소에 넣지 않는다. 이 문서는 시각/실기기 PASS 선언이 아니다.
