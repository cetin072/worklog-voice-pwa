# 로그인 소개 및 첫 일정 준비 화면

기준 main d21302010e26351d7a34b4821da1db1b95bec11b. PR466(package/실행 경계) 및 Play 작업과 독립. app.config/workflow/서명/인증 프로토콜/권한/웹 배포 정책 변경 없음.

- 기존 기능3개 소개를 남색 compact 카드로 조정. 로그인/회원가입 모드 보존, Google로 로그인/회원가입 문구와 저장소 웹의 기존 다색 G를 PNG로 재사용. 흰 버튼/경계/명시적 접근성 label/disabled 유지.
- 자산 출처: public/index.html의 기존 SVG paths, 로컬 sharp rasterization 72px. 새 로고를 디자인하지 않음. Google 공식 최신 PNG 가져오기는 proxy403으로 중단했으므로 최신2026 gradient 자산과 동일/브랜드 승인이라고 주장하지 않는다. 공식 검토 기준 https://developers.google.com/identity/branding-guidelines . 새 native dependency/폰트는 추가하지 않았다.
- 인증 복구 중 및 첫 briefing 없을 때 브랜드 준비 화면. briefingBusy 초기값과 무관. empty/partial 응답도 도착 즉시 홈과 기존 경고 표시. 알림 동기화 완료까지 가리지 않음.
- 이미 읽은 메모리 briefing은 복귀/토큰 갱신/조회 실패 중 유지. 새 디스크 캐시는 만들지 않았다. cold-start 오프라인에서 저장 데이터 표시를 보장하지 않는다.
- loadBriefing fetch+body parse는 15초 deadline/abort, 최초 준비 화면은20초 경과 시 오류·재시도 노출. 최소 표시 시간 없음. recovery/token 대기에도 무한 spinner 없음. 재시도는 기존 platform reload로 복구 경로를 다시 시작한다.
- userID 별 화면 key로 계정전환/로그아웃 시 상태 제거. old briefing epoch를 unmount시 무효화. notification response는 session/client 준비 후에만 소비하고 unmount된 callback은 무시. 초기/실행중 알림 focus는 기존 화면 경로 사용.

## 확인

TypeScript, 전체 Node 회귀, current-source startup 컴포넌트 hook harness(지연→재시도→spinner/watchdog재설정/오류→재시도·로그아웃), request timeout/abort/retry/offline, empty/partial readiness 및 stale notification callback 테스트. Android Hermes export 수행. 이 검사는 실제 Android touch/레이아웃/실기기 성공과 다르다.

첨부 1000080822.jpg/1000080824.jpg는 공식 Library 전송 및각1회 재시도 모두 download failed. 로컬 파일 없음, 픽셀 미확인. 원격 screenshot 문구·세부배치를 추정하지 않는다.

## 남은 화면 수용

기존 development build+Metro에서320/360/390폭, 큰 글자/키보드의 Google 버튼 가독성·스크롤, 로그인/회원가입 전환 확인. 복원지연/빈일정/부분결과/오프라인/재시도, 메모리데이터 유지, 계정전환 데이터분리, 알림 coldstart/복귀 focus 확인. 실제기기 PASS로 보고하지 않음. 후속검수: 현재 TSX를 읽은 로컬 DOM adapter fixture에서 로그인/인증복원/준비/오류/빈결과/부분결과/데이터표시7시나리오 server render 완료. 이는 Android native layout 검증이 아니다. Chromium 화면 캡처는 file://fixture 탐색이 ERR_BLOCKED_BY_ADMINISTRATOR로 거절돼 중단했으며 다른 경로로 우회하지 않았다. Google G PNG 자체는 픽셀 확인했으며 전체 Android 레이아웃 확인과 구분한다.

JS/TS+번들 이미지 변경만 있으므로 새 네이티브 의존성/runtime 재구성은 필요하지 않다. 기존 development build+Metro의 Fast Refresh는 개발 검수 경로다. 구성된 OTA 업데이트 경로(expo-updates/update URL/runtimeVersion)는 저장소에서 확인되지 않았다. 설치된 정식 standalone 앱은 Metro로 갱신되지 않으며 변경 전달에는 승인된 새 APK/AAB가 필요하다. 이 작업에서는 새 배포를 실행하지 않는다. standalone APK/AAB 배포·Play 제출·main병합은 이 PR 범위에 포함하지 않는다. 병합 단계에 사용자 체감 패치노트 갱신 여부 확인(미병합 내용을 미리 기록하지 않는 저장소 규칙).

후속 CI환경 보완: root-only npm ci에서도 actual TSX hook 회귀를 실행하도록 모바일과 동일한 TypeScript6.0.3을 root devDependency로 고정. JSX element runtime은 native control과 함께 fixture 객체로 대체하며 source 컴파일과 hook/재시도 assertions는 유지한다. mobile/node_modules없이 전체937PASS 확인.

Mobile CI는 mobile-only npm ci이므로 컴파일러 모듈은 mobile/package.json에서 시작해 상위 root까지 탐색한다. root-only 및 별도 임시 mobile-only 트리에서 동일 컴포넌트 회귀2개 모두 PASS 검증.
