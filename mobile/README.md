# 업무수첩 Mobile

Android 우선 Expo/React Native 모바일 클라이언트다.

## 현재 구현

- Expo SDK 57 + React Native 0.86 + TypeScript
- Expo Router App Shell
- 기존 `/api/supabase-auth-config`를 통한 공개 Supabase 설정 로딩
- `expo-secure-store` 기반 Supabase 세션 저장
- 기존 계정 이메일/비밀번호 로그인
- `/api/briefing-fast`를 통한 Data Core 읽기 smoke
- `/api/worklog`를 통한 Data Core 쓰기 smoke
- `expo-audio` 기반 사용자 시작형 음성 녹음
- Android background recording foreground service
- 녹음 원본을 앱 document directory에 Local-first 보존
- 녹음 결과를 공통 Audio Intelligence용 `mobile-recording` AudioInput 메타데이터로 변환

Push, Share Intent, Widget, Calendar, 실제 오디오 업로드/STT는 후속 Issue에서 추가한다.

## 실행

```bash
cd mobile
npm ci
npm run typecheck
npm start
```

Android 네이티브 권한/foreground service까지 포함한 녹음 검수는 Expo Go가 아니라 standalone/development build에서 수행한다.

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
