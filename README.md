# 업무기록 Voice PWA

갤럭시에서 홈 화면 아이콘을 눌러 업무를 말하거나 직접 입력하고, 기존 Notion `🎙 업무 통합 기록` DB에 저장하는 소형 PWA입니다.

## 현재 안정판

- 기준: v1.5 / 2026-09-09
- Production: `https://worklog-voice-pwa.netlify.app`
- 배포: Netlify
- 원본 저장소: 이 GitHub 저장소
- Notion/Kakao 비밀키의 원본 값은 GitHub에 저장하지 않고 Netlify 환경변수로 관리
- 운영자 앱 접근키와 지인용 개인 Notion 연결정보는 현재 사용 중인 브라우저 localStorage에도 저장되어 요청 인증에 사용

## 구조

`Android PWA → Web Speech API / Android 키보드 음성입력 → Netlify Function → Notion API`

일일 브리핑은 ChatGPT 예약 업무가 Notion의 시스템 브리핑 레코드를 갱신하고, PWA가 이를 표시합니다. 카카오 자동전송은 Netlify Scheduled Functions가 최신 브리핑을 확인해 운영자 본인의 `나와의 채팅방`으로 전송합니다.

## 현재 기능

- 큰 `말하기` 버튼
- 한국어 음성 인식
- 사용자가 중지할 때까지 계속 듣기 및 무음 종료 시 자동 재시작
- 녹음 중 Screen Wake Lock 지원 기기에서 화면 자동 꺼짐 방지
- 직접 입력 지원
- 인식 결과 확인 및 수정
- 작성 중 내용 자동 임시저장 및 앱 재실행 시 복구
- 기관 / 상태 / 유형의 가벼운 규칙 기반 자동선택
- 사용자가 기관 / 상태 / 유형을 직접 고르면 이후 자동 추론이 해당 선택을 덮어쓰지 않음
- 태장 관련 일부 음성 오인식은 기관 분류만 보정하고 음성원문은 그대로 보존
- 여러 업무를 `다음 업무`, `다음 건`, `그다음` 등으로 구분해 저장
- 금액 / 담당자 / 기한 / 후속조치 선택 입력
- 저장 직전 마지막 음성 결과 반영 대기
- 모호한 네트워크 실패 뒤 동일 저장 재시도 시 clientRequestId 기반 중복 저장 방지
- 저장 성공 진동 및 완료 표시
- 기존 Notion `🎙 업무 통합 기록` DB에 저장
- PWA 홈 화면 설치 지원

## 일일 브리핑

- 오전 08:00 / 오후 14:00 하루 2회 ChatGPT 예약 정리
- 우선업무 TOP 최대 10개
- 화면에는 처음 5개를 표시하고 필요할 때 나머지를 펼쳐봄
- TOP 업무를 앱에서 완료 처리하고 즉시 실행 취소 가능
- `브리핑 다시 정리`로 현재 Notion 미완료 업무를 규칙 기반으로 즉시 재정렬
- 빠른 재정리는 같은 날 예약 브리핑 직후에는 현재 회차(period)를 유지해 카카오 자동전송과 충돌하지 않도록 처리
- 오늘이 아닌 오래된 브리핑은 화면에서 명확한 경고 표시
- TOP 상태 확인 실패도 사용자에게 표시
- 빠른 브리핑 조회는 최대 500건까지 Notion pagination 처리

## 카카오 브리핑

- 운영자 본인의 카카오톡 `나와의 채팅방` 전용
- 최초 1회 Kakao OAuth 연결
- Kakao 토큰은 Netlify Blobs에 서버 측 저장
- 자동전송 1차 시도:
  - 오전 08:15
  - 오후 14:15
- 실패 시 각 회차마다 15분 간격으로 최대 2회 추가 재시도
- 여러 메시지 중 일부만 성공한 경우 다음 재시도에서 남은 메시지부터 이어서 전송
- 같은 날짜/같은 회차 중복 전송 방지
- 수동 `카톡으로 보내기` 연속 재탭 30초 쿨다운
- 메시지에 브리핑 생성 날짜 표시
- 자동전송 최근 성공/실패 상태를 앱에서 확인 가능
- Deploy Preview에서는 실제 카카오 연결·해제·메시지 전송 차단

자세한 설정은 `docs/KAKAO_BRIEFING_SETUP.md`를 참고합니다.

## 환경변수

Netlify에서 관리합니다.

- `NOTION_TOKEN`
- `APP_ACCESS_KEY`
- `NOTION_DATA_SOURCE_ID`
- `KAKAO_REST_API_KEY`
- `KAKAO_CLIENT_SECRET`
- `KAKAO_REDIRECT_URI` (선택)
- `SUPABASE_URL` (Platform Auth를 활성화할 때)
- `SUPABASE_PUBLISHABLE_KEY` (Platform Auth를 활성화할 때; 브라우저에 공개 가능한 publishable key)
- `WORKLOG_DATA_CORE_DUAL_WRITE_ENABLED` (선택: `true`일 때 Platform 로그인 사용자의 Quick Worklog를 Data Core와 Notion에 함께 저장)
- `WORKLOG_DATA_CORE_PRIMARY_ENABLED` (선택: `true`일 때 Platform 로그인 신규 사용자는 Notion 설정 없이 Data Core에 저장)
- `WORKLOG_DATA_CORE_BRIEFING_ENABLED` (선택: `true`일 때 Platform 로그인 사용자의 Briefing V2를 Data Core에서 읽기)

비밀값을 코드, Issue, PR, README에 넣지 않습니다.

`SUPABASE_URL`과 `SUPABASE_PUBLISHABLE_KEY`가 모두 설정되면 앱은 최소 Platform 계정 로그인과 Personal Workspace bootstrap UI를 표시합니다. `WORKLOG_DATA_CORE_DUAL_WRITE_ENABLED=true`를 추가하면 로그인 사용자의 Quick Worklog는 검증된 개인 Workspace에 Data Core와 Notion으로 함께 저장됩니다. 한쪽만 성공하면 원문을 지우지 않아 같은 저장 요청으로 남은 쪽만 다시 시도합니다. 플래그가 없거나 로그아웃 상태면 기존 Notion 저장 흐름을 유지합니다. service role 또는 secret key를 Netlify 공개 응답이나 브라우저에 넣지 않습니다.

`WORKLOG_DATA_CORE_PRIMARY_ENABLED=true`는 Data Core를 Quick Worklog의 성공 기준으로 바꿉니다. 로그인한 신규 사용자는 Notion token이나 운영자 접근키 없이 저장할 수 있고, Notion이 연결된 기존 사용자는 같은 요청에서 선택 동기화를 시도합니다. Notion 장애는 Data Core 저장을 실패로 바꾸지 않으며 동기화 상태가 `pending`으로 남습니다. 실제 활성화 전에는 #125/#131 migration, RLS와 Preview QA를 `worklog-platform`에서 확인해야 합니다.

`WORKLOG_DATA_CORE_BRIEFING_ENABLED=true`는 로그인한 사용자의 Briefing V2를 개인 Workspace의 Data Core WorkRecord로 읽습니다. 이 첫 단계에서는 Data Core 브리핑을 읽기 전용으로 표시하며, 완료 처리와 브리핑 재정리는 기존 Notion 경로에 남겨 둡니다.

## 운영 원칙

현재 `main`은 실제 운영 가능한 안정판입니다.

향후 패치는 다음 흐름을 기본으로 합니다.

1. GitHub Issue로 변경 목적 기록
2. 기능 브랜치 생성
3. 코드 수정
4. 자동 테스트
5. Draft PR + Netlify Deploy Preview 검수
6. 사용자 승인 후 `main` 반영
7. Netlify Production 배포 확인

사용자의 명시적 승인 없이 큰 구조 변경, Notion DB 파괴적 변경, 토큰 노출, 운영 데이터 삭제, Production 병합을 하지 않습니다.

## 모바일 검수 시나리오

1. 앱을 열고 오늘 브리핑이 표시되는지 확인한다.
2. 오래된 브리핑이면 경고가 표시되는지 확인한다.
3. `말하기`를 누르고 한 문장을 말한다.
4. 10초 이상 침묵한 뒤 다시 말했을 때 기존 문장 뒤에 이어지는지 확인한다.
5. 사용자가 상태/유형을 직접 바꾼 뒤 텍스트를 수정해도 직접 선택값이 유지되는지 확인한다.
6. `다음 업무`, `다음 건`, `그다음`으로 여러 업무가 올바르게 분리되는지 확인한다.
7. 말이 끝나자마자 저장해도 마지막 단어가 빠지지 않는지 확인한다.
8. 작성 중 앱을 닫았다 다시 열었을 때 임시 기록이 복구되는지 확인한다.
9. `저장` 후 진동/완료 표시가 나오고, 현재 활성화된 저장 경로(Data Core 또는 Notion)에 기록되는지 확인한다.
10. 카카오 연결 시 최근 자동전송 성공/실패 상태가 표시되는지 확인한다.

## 테스트

Netlify build에서 `npm test`를 실행합니다.

현재 최소 회귀 테스트는 다음을 포함합니다.

- 업무 분할 기본/경계 사례
- 사용자가 직접 고른 상태·유형 보호
- 모호한 네트워크 실패 뒤 저장 요청 ID 재사용

## 향후 후보 기능

- 금액 / 담당자 / 기한 추출 정확도 개선
- 더 강한 인증/세션 구조가 필요한 다사용자 제품화
- 완전한 오프라인 전송 큐는 실제 필요성이 생길 때 별도 검토
