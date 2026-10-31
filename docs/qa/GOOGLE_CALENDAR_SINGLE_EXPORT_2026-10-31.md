# 선택한 Schedule → Google Calendar 단건 출력: 2026-10-31

## 범위와 상태

후속 Calendar 전용 브랜치. main e3a8a50 기준이며 캡처 Draft #473
(881f0833a7c7b6da863ba1861202a1b2218abcaf)을 병합하거나 수정하지 않는다.
정식 Play 앱에서는 계속 숨기고 QA 앱에서만 노출한다. main 병합, Play 제출,
운영 웹 배포, DB/RLS/migration, 서명 키 및 운영 인증 설정 변경은 실행하지 않는다.
코드/격리 검사, APK, native/runtime 검사, 실제 Google 동의/등록은 별도 완료 경계다.
실계정 OAuth 또는 Google 일정 쓰기는 아직 실행하지 않았다.

## 설계와 재사용

Schedule Core → CalendarSource/CalendarConnection → 기존 CalendarExport Contract
→ Google REST Adapter. 입력/알림 Core는 수정하지 않는다. 기존 Expo WebBrowser,
Supabase JS 2.116.0(MIT), React Native/Expo 런타임을 재사용한다. 새 의존성·유료
서비스·장기 토큰·테이블·백그라운드 작업·import/list/sync는 없다. 일반 일정 조회와
인증은 기존 Supabase Data API/RLS 및 getUser를 사용한다. 원본 ID·creator를 제한하고
workspace, 확정 상태, title/start/end/all_day/timezone/updated_at을 검사한다.

시트 열 때와 보내기 때 서버 원본을 읽는다. Google 사전 GET 후 POST 직전에도 다시
읽어 revision/필드 변경을 차단한다. GET 확인 후 성공 표시 전에도 원본을 확인한다.
끝이 없는 일정은 사용자가 명시한 종료만 적용하며 Core를 수정하지 않는다.
종일 end는 포함하지 않는 날짜다. 시작/종료/시간대/종일/대상 계정을 표시한다.

기존 UUID 기반 event ID, 중복 클릭 공유, 생성 전 GET, 응답 유실/409 후 동일 ID GET을
유지한다. 성공에는 ID/source UUID/status뿐 아니라 제목·start/end·종일·시간대 일치가
필요하다. 기존 불일치/410 삭제는 덮어쓰거나 재생성하지 않는다. 실행 중 이미 확인한
ID가 404로 사라져도 재생성하지 않는다. 재시작/재연결 뒤에도 ID는 고정이다.
확인 이력이 없는 404만 신규 등록 후보이며 실제 삭제/접근 은폐 여부를 404만으로
확정할 수 없다. Google이 같은 ID를 거부하고 GET도 없으면 미확인으로 남는다.
쓰기 중 계정/원본 변경이나 닫기는 이미 커밋된 원격 쓰기를 취소할 수 없으며 성공으로
표시하지 않는다. 기존 Google 일정 수정/삭제, 참석자, 자동 Google 알림은 없다.

## OAuth / 토큰 경계

일반 앱 로그인과 Calendar 연결은 별도다. 클릭 전 인증/Calendar 요청이 없다.
Calendar 전용 Supabase client는 persistSession:false, autoRefreshToken:false,
detectSessionInUrl:false, flowType:pkce, 별도 storageKey를 쓴다.
설치된 auth-js는 persistSession:false일 때 SDK 자체 메모리 storage를 사용한다.
SecureStore나 기본 앱 client를 넘기지 않으며 provider token을 app session에 합치지 않는다.
SDK client는 교환 후 dispose하고 Google access token만 Adapter closure에 보관한다.
Google refresh token은 요청/저장/사용하지 않는다(access_type:online).
50분의 보수적 연결 수명 또는 HTTP 401이면 재연결한다. 403은 거부/철회로 표시한다.
앱 종료/앱 사용자 변경/로그아웃/연결 해제 시 메모리 연결을 폐기한다.
서로 다른 Google 계정을 연결해도 기존 앱 access/refresh token, user ID, workspace는
교체하지 않는다. primary client의 callback handler는 purpose=calendar URL을 거부한다.
콜드 스타트에서도 그 callback을 앱 로그인으로 교환하지 않는다.

중요: Supabase OAuth를 중계로 재사용하므로 Calendar용 임시 Supabase 인증 세션은
발급된다. 처음 보는 다른 Google 계정이라면 Supabase의 기존 가입/trigger 정책에 따라
별도 Auth 사용자/개인 workspace가 생성될 수 있다. 기존 앱 세션은 교체하지 않지만
이 서버 측 효과까지 없는 순수 Google authorization이라고 주장하지 않는다.
실계정 Human QA에서는 우선 이미 Supabase에 등록된 승인 테스트 Google 계정을 사용한다.
미등록 Google 계정으로 동의하기 전에는 이 계정 생성 가능성까지 별도 승인한다.
장기적으로 순수 authorization이 필요하면 native Google authorization client와 Cloud
설정 변경을 별도 작업으로 검토하며 이번에 새 native SDK/client를 임의 추가하지 않는다.

대상은 연결 계정의 기본 소유 캘린더(primary) 하나다. calendar.events.owned는 권한
자체로 소유 캘린더 일정의 조회·생성·수정·삭제를 허용한다. UI에서 범위를 공개하고
앱 동작은 한 건 생성/조회만 사용한다. calendar.app.created는 새 보조 캘린더를 만들어
대상을 바꾸므로 이번 최소안으로 임의 대체하지 않았다. email/profile 기본 로그인
scope는 Supabase Google provider가 사용하는 범위이며 Calendar 권한과 구분한다.

## 사용자 확인 직전 준비할 설정 (아직 미변경/미검증)

이미 확인된 프로젝트/Client ID/API 활성화를 처음부터 다시 요구하지 않는다.
- Cloud worklog-platform, 기존 '업무수첩 Web' OAuth client 유지.
- Google 승인 redirect: https://zlhdhwgabqzsuuhaiedc.supabase.co/auth/v1/callback 유지.
- Supabase worklog-platform (zlhdhwgabqzsuuhaiedc)의 기존 callback allow-list를 읽기 확인한다.
  이 실행 환경의 연결 도구에는 Auth 설정 읽기 API가 없어 현재 값 일치 여부는 미검증이다.
- 앱 base callback: QA worklog-qa://google-auth, 정식 worklog://google-auth.
  Calendar는 동일 base에 `?purpose=calendar`를 붙여 일반 로그인과 구분한다.
- 필요한 최소 QA allow-list 값: `worklog-qa://google-auth?purpose=calendar`.
  기존 패턴이 이 값을 허용하면 변경하지 않는다. 정확한 기존 allow-list로 부족하면
  위 한 값 추가를 사용자에게 별도 승인받는다. 기존 URL/Google client/secret/site URL을
  교체하거나 광범위한 wildcard를 추가하지 않는다. 복구는 추가한 한 항목만 제거한다.
  정식 앱 URL 추가는 이번 QA 범위에 필요 없으므로 변경하지 않는다.
- Google Auth Platform Data Access에 Calendar scope 등록/테스트 사용자가 필요하다면
  정확한 기존 상태와 추가값을 보여주고 승인받는다. 새 scope 동의는 사용자가 직접 한다.
- Client Secret/token을 채팅, 저장소, PR, 로그에 요구/노출하지 않는다.

## 자동 검사 및 APK 증빙

이번 커밋의 실제 실행 결과와 HEAD/Actions 링크는 PR와 최종 보고에 기록한다.
기존 7개 exporter 검사는 live integration 성공의 증거가 아니다.
격리 검사는 실제 제품 source + 주입 HTTP/OAuth 및 설치 SDK로 수행한다.
검사 범위: 취소/거부/만료/잘못된 callback, 다른 Google 계정과 앱 세션 보존,
PKCE 및 provider token 영구 저장 없음, 소유권/원본 변경, 중복 클릭, 고정 ID 재시도,
응답 유실/409, 불일치/410/알려진 ID 404, 명시적 종료/종일 exclusive end,
실제 시트 열기/연결/한 건 보내기/재전송/닫기와 production 숨김.

기존 Mobile App workflow의 일반 ARM64 standalone artifact만 사용자에게 제공한다.
`com.cetin072.worklog.qa`, QA scheme/icon, 기존 signing plugin 유지.
synthetic touch/자동 로그인 APK는 runtime 검사 전용이며 사용자 설치용으로 전달하지 않는다.
정식 앱 삭제를 요구하지 않는다. 최종 HEAD의 TypeScript/Android bundle/native build/
runtime smoke 및 APK package/version/certificate/SHA-256 확인 뒤 raw APK를 전달한다.
관리자 설정이나 실기기 검사가 남으면 '전체 QA 준비 완료'라고 하지 않는다.

## Human QA 한 번에 요청할 항목

자동검사/APK 완료 후 아래만 구체적으로 요청한다.
1. 위 callback allow-list 읽기 확인 및 필요한 경우 정확한 한 항목 추가 승인.
   Google Cloud scope/test user 변경이 실제 필요하면 현재값/변경값/복구안 승인.
2. 기존 Supabase에 등록된 테스트 Google 계정과 해당 기본 캘린더의 사용 승인,
   사용자가 직접 실제 Calendar OAuth 동의. API 활성화와 이 동의를 혼동하지 않는다.
3. 명시적인 합성 일정(제목, 날짜, 시작/종료, 시간대, 종일 여부)을 사용자가 지정/승인.
   자동검사에 사용한 과거/임의 날짜를 실계정 테스트 승인으로 사용하지 않는다.
4. QA 앱 원본 한 건 확인 → 보내기 → Google Calendar 표시 → 같은 일정 재전송 시
   중복 없음 확인. 다른 Google 계정을 선택해도 앱 사용자/업무공간 유지 확인.
   필요 시 취소/거부/오프라인/원본 변경도 확인. 기존 실제 일정은 변경/삭제하지 않는다.
   합성 일정 정리도 별도 승인된 범위에서만 한다.

## 공식 근거

- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth): owned의 실제 권한과 app.created의 대상 차이.
- [Events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get): primary와 생성/확인 계약.
- [Supabase Google](https://supabase.com/docs/guides/auth/social-sign-in/auth-google): provider_token과 Google refresh token의 별도 성격.
- [Supabase signInWithOAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth): 추가 scope/PKCE.
- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow): callback code와 verifier 교환.
- 설치된 @supabase/auth-js GoTrueClient의 persistSession:false 메모리 storage 분기 및 dispose 구현도 검사했다.
