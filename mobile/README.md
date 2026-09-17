# 업무수첩 Mobile Foundation 0.1

Issue #301의 Android 우선 Expo/React Native 모바일 클라이언트다.

## 현재 범위

- Expo SDK 57 + React Native 0.86 + TypeScript
- Expo Router App Shell
- 기존 `/api/supabase-auth-config`를 통한 공개 Supabase 설정 로딩
- `expo-secure-store` 기반 Supabase 세션 저장
- 기존 계정 이메일/비밀번호 로그인
- `/api/briefing-fast`를 통한 Data Core 읽기 smoke
- `/api/worklog`를 통한 Data Core 쓰기 smoke

Push, 녹음, Share Intent, Widget, Calendar는 후속 Issue에서 추가한다.

## 실행

```bash
cd mobile
npm install
npm run typecheck
npm start
```

Foundation 0.1은 Expo Go에서도 기본 화면과 로그인/읽기/쓰기 흐름을 확인할 수 있다. Android 에뮬레이터가 준비되어 있으면 `npm run android`를 사용할 수 있다.

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
