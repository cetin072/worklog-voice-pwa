# 업무수첩 Mobile

Android 우선 Expo/React Native 모바일 클라이언트다.

## 현재 구현

- Expo SDK 57 + React Native 0.86 + TypeScript
- Expo Router App Shell
- 기존 `/api/supabase-auth-config`를 통한 공개 Supabase 설정 로딩
- `expo-secure-store` 기반 Supabase 세션 저장
- 기존 계정 이메일/비밀번호 로그인
- 기존 Supabase Google Provider를 재사용하는 `Google로 시작`
- 마지막 로그인 이메일 기억, OS 비밀번호 관리자/자동완성 힌트
- 비밀번호 기본 마스킹 + 보기/숨기기
- 최신 PWA와 같은 홈 브리핑 구조(지난 것·오늘 할 일·다가오는 업무·기한 없는 업무)와 오늘/다가오는 일정 표시
- `/api/briefing-fast`를 통한 Data Core 브리핑 읽기와 loading/empty/error/retry
- `/api/worklog`를 통한 직접 입력 업무 저장
- `expo-audio` 기반 사용자 시작형 음성 녹음
- 홈의 빠른 음성 메모와 별도 장시간 회의 녹음 진입(동일 recorder core 재사용)
- Android background recording foreground service
- 녹음 원본을 앱 document directory에 Local-first 보존
- 녹음 결과를 공통 Audio Intelligence용 `mobile-recording` AudioInput 메타데이터로 변환

Push, Share Intent, Widget, 실제 오디오 업로드/STT는 후속 Issue에서 추가한다.

## 일정과 알림

- 브리핑의 일정 행에서 사용자가 직접 휴대폰의 수정 가능한 Calendar를 선택해 일정을 추가할 수 있다. Android Calendar Provider가 Google 계정 Calendar와 동기화하는 경우 그 계정을 그대로 사용한다.
- 앱은 기기에 저장한 Schedule → Calendar event ID mapping으로 같은 일정의 중복 생성을 막고, 변경·삭제를 재시도할 수 있는 경계를 둔다.
- 일정 알림은 사용자가 직접 선택한 일정의 시작 시각에만 local notification으로 예약한다. 제품 기본 알림 시각은 임의로 정하지 않는다.
- Calendar/알림 권한이 거부되면 설정에서 허용하도록 안내하며, Google Calendar REST API 토큰은 사용하거나 저장하지 않는다.

## 실행

```bash
cd mobile
npm ci
npm run typecheck
npm start
```

Android 네이티브 권한/foreground service까지 포함한 녹음 검수와 Google OAuth deep link 검수는 Expo Go가 아니라 standalone/development build에서 수행한다.

## 인증 경계

- Supabase URL과 publishable key는 기존 `/api/supabase-auth-config`에서 읽는다.
- 이메일/비밀번호 로그인은 기존 Supabase Auth session을 사용한다.
- 앱은 마지막 사용 이메일만 로컬에 기억하고 사용자 비밀번호 원문을 직접 저장하지 않는다.
- 비밀번호 저장/자동완성은 Android/iOS의 OS credential/autofill 계층을 우선한다.
- Google 로그인은 기존 Supabase Google Provider를 재사용하고 `worklog://google-auth`로 앱에 복귀한다.
- Google 로그인은 Expo AuthSession 브라우저를 사용하므로 취소를 명확히 표시하고, cold start·foreground deep link callback을 모두 처리한다.
- Supabase URL Configuration의 Additional Redirect URLs에 `worklog://google-auth`가 허용되어야 한다.
- Google Client Secret이나 provider token은 앱 코드/저장소에 넣지 않는다.

## 음성 녹음 경계

- 녹음은 사용자가 앱에서 명시적으로 시작한다.
- `expo-audio`의 `document` directory를 사용해 시스템이 임의 삭제할 수 있는 cache 저장을 피한다.
- background recording을 켜 Android 화면 잠금/앱 background 상태에서도 녹음을 유지한다.
- Android는 녹음 중 foreground service 알림을 표시한다.
- 이번 단계에서는 녹음 파일을 서버에 자동 업로드하지 않는다.
- STT/Transcript/분석은 Issue #151의 공통 Audio Intelligence 경계를 소비하는 후속 단계에서 연결한다.

## API 주소

기본값은 현재 운영 서버인 `https://worklog-voice-pwa.netlify.app`이다. 다른 Preview/개발 서버를 사용하려면 `.env.example`을 참고해 로컬 `.env`에 다음 값만 지정한다.

```env
EXPO_PUBLIC_API_BASE_URL=https://example.netlify.app
```

Supabase URL이나 publishable key를 모바일 저장소에 복사하지 않는다. 앱은 서버의 공개 설정 endpoint에서 읽는다.

## 보안 원칙

- service role key, Notion token, APP_ACCESS_KEY 등 비밀값을 앱 코드/환경변수에 넣지 않는다.
- Supabase publishable key는 기존 공개 config endpoint를 통해서만 받는다.
- 인증/권한의 최종 판정은 기존 서버/DB/RLS가 맡는다.
- 세션은 SecureStore adapter에 저장하며 큰 세션 값은 안전한 크기로 분할한다.
- 녹음 원본은 사용자 승인 없는 자동 업로드를 하지 않는다.
