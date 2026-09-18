# Mobile QA Fast Loop V1

Issue: #352  
Parent milestone: #355

## 1. 목적

업무수첩 모바일 개발에서 작은 UI/TypeScript 변경마다 standalone APK를 다시 생성·다운로드·설치하고 전체 Human QA를 반복하는 병목을 줄인다.

핵심은 **native runtime과 JS/TS/UI 변경을 분리해 검수하는 것**이다.

## 2. 기본 원칙

1. 기존 Expo/React Native 공식 기능을 먼저 사용한다.
2. QA 속도 개선만을 위해 새 native dependency를 바로 추가하지 않는다.
3. 현재 앱의 development build + Metro 연결을 먼저 시도한다.
4. native runtime이 바뀌지 않은 UI/TypeScript 변경은 기존 development build에서 반복 확인한다.
5. native dependency/config/permission이 바뀔 때만 development build를 다시 만든다.
6. standalone release APK는 milestone이나 native-change checkpoint에서만 생성한다.
7. production OTA / Play Store / production credential 변경은 별도 승인 없이는 하지 않는다.

## 3. 1차 구현 — dependency 추가 없음

현재 scripts:

```bash
cd mobile
npm run android:device
npm run start:device
```

- `android:device`: 현재 native 구성으로 Android development build 설치
- `start:device`: 설치된 development build가 Metro를 사용하도록 개발 서버 시작

Expo SDK 57 / RN 0.86의 기존 구성으로 먼저 검증한다.

## 4. 재빌드 판단표

### 기존 development build 재사용

- React component 변경
- StyleSheet 변경
- 화면 구조 변경
- 브리핑 UI 변경
- 일반 TypeScript business logic
- API 요청/응답 처리
- Calendar/notification UI 문구와 상태 표시
- Quick Voice 상태 UI

### development build 재생성

- native npm package 추가/제거
- Expo config plugin 추가/수정
- Android permission 변경
- Android manifest/native intent 변경
- custom scheme 변경
- Expo/RN native version 변경
- STT native runtime 추가

### release ARM64 APK 생성

- native 변경 검증 완료 시
- milestone Human QA 시
- release checkpoint 시

## 5. Human QA 차등 검수

이미 Human QA PASS했고 이후 관련 파일/config/dependency가 바뀌지 않은 기능은 반복 실기기 검수를 요구하지 않는다.

재검수 조건:

- 영향 파일 변경
- native config 변경
- API/Data Core contract 변경
- 관련 automated regression 실패

예:

- Google OAuth 코드가 untouched → 반복 login QA 생략
- 브리핑 UI만 변경 → 브리핑 변경 범위만 검수
- whisper.rn 같은 native STT 추가 → 새 development build 설치 후 STT 범위 검수

## 6. OTA / Preview 2단계

local development build + Metro가 충분하지 않을 때만 다음을 추가 검토한다.

- expo-dev-client
- expo-updates
- QA preview channel
- runtimeVersion
- rollback strategy

이 단계는 외부 계정/credential/cloud 경계를 먼저 확인하고 production update channel과 분리한다.

## 7. 사무실 실기 확인 절차

1. Android 개발자 옵션 / USB debugging 확인
2. 기기 연결
3. `npm run android:device`
4. 앱 정상 설치/실행 확인
5. `npm run start:device`
6. `mobile/app/index.tsx`의 무해한 UI 변경으로 reload/Fast Refresh 확인
7. USB 해제 후 같은 LAN 연결 가능 여부 확인
8. 결과를 #352에 기록

## 8. 완료 기준

- 개발 빌드 1회 설치 성공
- Metro 기반 반복 UI 변경 확인 성공
- 재빌드 필요/불필요 경계 문서화
- Human QA 차등검수 적용
- 실패 시 기존 standalone APK workflow로 안전하게 fallback 가능



## 9. CI Fast Path

`.github/workflows/mobile-foundation.yml`도 같은 원칙을 따른다.

PR에서 다음만 바뀐 경우:
- `mobile/**/*.ts`
- `mobile/**/*.tsx`
- mobile contract tests
- 일반 UI/상태 로직

기본 실행:
- Expo dependency compatibility
- TypeScript
- mobile contract tests

standalone ARM64 APK는 자동으로 생략한다.

다음 변경은 native build를 자동 실행한다.
- `mobile/app.json`
- `mobile/app.config.js|ts`
- `mobile/package-lock.json`
- `mobile/android/**`
- `mobile/ios/**`
- mobile workflow 자체

또한 `workflow_dispatch`에서 사람이 명시적으로 Android APK build를 요청할 수 있다.

이 정책은 release 검증을 없애는 것이 아니라 **작은 JS/UI 커밋마다 동일한 Gradle 빌드를 반복하지 않는 것**이 목적이다.
