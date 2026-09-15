# Google Auth Setup / Existing Account Link Gate

기준 프로젝트: `worklog-platform`

- Supabase project ref: `zlhdhwgabqzsuuhaiedc`
- Production app: `https://worklog-voice-pwa.netlify.app/`
- Google OAuth callback: `https://zlhdhwgabqzsuuhaiedc.supabase.co/auth/v1/callback`

## 목표

신규 사용자는 `Google로 시작`을 가장 쉬운 로그인 방법으로 사용한다. 기존 이메일/비밀번호 로그인은 보조수단으로 계속 유지한다.

이미 Gmail 주소로 이메일/비밀번호 계정을 만든 사용자는 같은 Google 계정으로 로그인할 때 새 업무수첩 계정을 만들지 않고, 기존 Supabase 사용자에 Google identity가 연결되어야 한다.

Supabase Auth는 동일한 검증 이메일을 가진 identity를 기본적으로 한 사용자에 자동 연결한다. 그래도 Production 적용 전후로 실제 `user_id`와 Personal Workspace가 그대로인지 반드시 확인한다.

## 1. Google Auth Platform 설정

Google Cloud / Google Auth Platform에서 OAuth Client를 새로 만든다.

- Application type: `Web application`
- Authorized JavaScript origin:
  - `https://worklog-voice-pwa.netlify.app`
- Authorized redirect URI:
  - `https://zlhdhwgabqzsuuhaiedc.supabase.co/auth/v1/callback`
- 기본 scopes:
  - `openid`
  - email
  - profile

초기 제한 테스트가 필요하면 Google OAuth Audience의 test user로 검증하고, 일반 배포 시 Audience/Publishing 상태를 별도로 점검한다.

## 2. Supabase Google Provider 설정

반드시 `worklog-platform` (`zlhdhwgabqzsuuhaiedc`) 프로젝트에서만 설정한다.

Supabase Dashboard:

`Authentication → Sign In / Providers → Google`

여기에 Google에서 발급한 값을 직접 입력한다.

- Client ID
- Client Secret
- Google Provider Enabled = ON

### Secret 규칙

Google Client Secret은:

- GitHub에 저장하지 않는다.
- Netlify 공개 환경변수로 넣지 않는다.
- 프론트엔드 JavaScript에 넣지 않는다.
- 채팅에 붙여넣지 않는다.
- Supabase Auth Provider 설정에 직접 입력한다.

## 3. Supabase Redirect URL 설정

`Authentication → URL Configuration`

Production Site URL:

`https://worklog-voice-pwa.netlify.app/`

Production redirect URL도 정확히 허용한다.

Preview에서 실제 Google OAuth를 시험하려면 Netlify Preview URL도 Additional Redirect URLs에 허용해야 한다. 예:

`https://**--worklog-voice-pwa.netlify.app/**`

Production에서는 가능한 한 정확한 URL을 사용한다.

## 4. 앱 동작

로그아웃 상태의 우선순위:

1. `Google로 시작`
2. 이메일/비밀번호 로그인 또는 무료 가입

Google 로그인은 Supabase `/auth/v1/authorize?provider=google` 흐름을 사용한다.

OAuth 완료 후 앱으로 돌아오면:

- Supabase `access_token`
- Supabase `refresh_token`
- 세션 만료 정보

만 로컬 세션에 저장한다.

Google `provider_token` 또는 Google refresh token은 저장하거나 로그하지 않는다.

로그인 완료 후 기존과 동일하게 `bootstrap_personal_workspace`를 호출한다.

## 5. 기존 Gmail 이메일 계정 자동 연결 검증 — 필수

Google Provider를 켜기 전에 기존 계정의 기준값을 안전하게 확인한다.

기록할 값:

- 기존 Supabase `auth.users.id`
- 기존 Personal Workspace ID
- 해당 Workspace owner membership 수

이메일 주소 자체를 테스트 문서나 로그에 남길 필요는 없다.

그 다음 사용자가 **기존 이메일/비밀번호 가입에 사용한 것과 동일한 Google 계정**으로 `Google로 시작`을 실행한다.

성공 후 확인:

- `auth.users` 사용자 ID가 이전과 동일
- 해당 사용자 아래 identity에 `email`과 `google`이 함께 존재
- Personal Workspace ID가 이전과 동일
- Workspace가 하나 더 생기지 않음
- 기존 WorkRecord/Schedule이 그대로 보임
- 새 데이터 소유권도 동일 user/workspace 사용

### 실패 조건

아래 중 하나라도 발생하면 Production 배포/일반 사용자 노출을 중지한다.

- 같은 이메일인데 새 `auth.users.id` 생성
- 새 Personal Workspace 추가 생성
- 기존 업무가 안 보임
- 기존 이메일/비밀번호 로그인 불가
- 다른 사용자의 데이터가 보임

## 6. 회귀 검증

Google identity 연결 후에도 기존 이메일/비밀번호로 다시 로그인해서 다음을 확인한다.

- 같은 user ID
- 같은 Personal Workspace
- 기존 업무/일정 유지
- 저장/브리핑/완료/되돌리기 정상

Google 로그인과 이메일 로그인은 **두 개의 로그인 방법**일 뿐, 사용자 업무공간은 하나여야 한다.

## 7. 신규 Google 사용자 검증

기존 업무수첩 계정이 없는 별도 Google QA 계정으로 확인한다.

- Google 로그인 성공
- 사용자 1개 생성
- Personal Workspace 1개 생성
- owner membership 1개
- WorkRecord 저장
- Briefing 조회
- Schedule 조회
- 로그아웃 후 Google 재로그인 시 같은 user/workspace 재사용

QA 데이터는 검증 후 정리한다.

## 8. 자체 도메인 전환 시

향후 자체 도메인을 붙이면 다음을 함께 갱신한다.

- Google Authorized JavaScript origins
- Supabase Site URL
- Supabase Additional Redirect URLs
- 앱의 OAuth `redirect_to`
- Open Graph canonical URL

Google Client Secret을 새 도메인 때문에 프론트엔드에 옮길 필요는 없다.

## Release Gate

- [ ] Google Web OAuth Client 생성
- [ ] Production origin 등록
- [ ] Supabase callback 등록
- [ ] Google Provider Supabase에서 ON
- [ ] Site URL / redirect allow-list 확인
- [ ] 동일 Gmail 기존 계정 자동 연결 PASS
- [ ] user ID 유지 PASS
- [ ] Personal Workspace 유지 PASS
- [ ] 기존 이메일/비밀번호 로그인 PASS
- [ ] 신규 Google 사용자 PASS
- [ ] npm test PASS
- [ ] UAR PASS
- [ ] Deploy Preview PASS
- [ ] Google Client Secret 노출 없음
