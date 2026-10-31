# Android 캡처 → 일정 자동 등록 V1

기준 main `e3a8a50bd7d7e8f3fe47970268dd04ee84448f78`. 사용자 지시로 최소 실행본을 구현한다. 검증 전 main 병합·Play 제출·운영 설정·DB 변경은 제외한다.

## 구조

Android 단일 image/* → Expo Sharing → 개인 앱 저장소 복사/해시 → encrypted inbox → 한국어 OCR adapter → 기존 Korean date Core를 재사용하는 보수적 캡처 입력 정책 → 기존 saveWorklog(sourceType:capture, clientRequestId) → 서버 WorkRecord/Schedule → 기존 알림 post-save boundary → 저장 결과/기존 수정 sheet/취소 RPC.

- 원본은 서버·AI API에 보내지 않는다. OCR도 기기 내에서 실행하도록 연결했다.
- 저장 전 확인창·저장 버튼은 없다. 명확한 미래 약속 1건은 기존 Schedule 저장 경로로 즉시 보낸다.
- 전체 대화는 전송/로그/ledger에 남기지 않는다. 일정 문장 1개 또는 확인 필요 제목+관련 설명(기존 followUp)만 서버에 전달한다.
- 상대 날짜는 캡처 시각이 아닌 명시된 대화 날짜에만 연결한다. 대화 날짜가 없거나 여러 날짜/변경·취소/제안·의문/과거/애매한 시각이면 날짜 없는 확인 필요 WorkRecord로 저장한다. 글자를 못 읽으면 저장하지 않는다.
- 한 이미지 SHA-256 해시와 계정별 영수증, 기존 서버 clientRequestId 멱등성을 재사용한다. 응답 불명확 시 동일 요청 ID/동일 문장을 재시도한다. 취소한 이미지의 재공유는 재등록하지 않는다.
- 로그인 전 공유는 기기에 보관하고 로그인 후 해당 계정에 귀속한다. 기존 계정의 대기 항목을 다른 계정이 가져가지 않는다. 토큰의 실제 소유자를 저장 직전 확인한다.
- 서버 저장 영수증부터 보관하고 알림 실패는 별도 안내한다. 서버 canonical Schedule을 재조회한 뒤만 기기 알림을 동기화한다. 실제 상세 재조회/수정/실행 취소는 기존 API를 재사용한다.
- 공유 URI는 content/file만 허용하며 자체 private 복사본만 정리한다. 임시 복사 파일은 저장 완료 후 제거한다. 네트워크/OCR 실패 시 보관한다. 이미지 12MiB/24MP 제한, inbox 최대300건 이후 명시 오류(중복 기록을 조용히 버리지 않음).

## 의존성/라이선스/검토

| 대상 | 적용 | 근거/상태 |
|---|---|---|
| expo-sharing | 57.0.24 / MIT | Expo SDK57 공식 incoming share + singleShareMimeTypes. Incoming API는 공식 experimental이다. URL resolver 대신 raw local payload만 사용한다. |
| rn-mlkit-ocr | 0.3.1 / MIT | npm modified 2026-01-22. 단일 주 기여자·작은 프로젝트다. recognizeText(uri,'korean')를 adapter로 격리했다. |
| ML Kit | bundled text-recognition-korean 16.0.1 | rn-mlkit-ocr 배포 Gradle 소스로 확인. Google SDK/model은 wrapper MIT와 별도 Google 조건을 따른다. |
| Latin bundled dependency | 16.0.1 | 해당 wrapper Kotlin의 무조건적인 latin.TextRecognizerOptions import 때문에 한국어만 구성하면 컴파일 위험이 있다. Korean+Latin만 넣고 OCR 실행은 Korean 단일로 한다. Chinese/Japanese/Devanagari와 다른 OCR 엔진은 탑재하지 않는다. |

공식 출처:
- https://docs.expo.dev/versions/v57.0.0/sdk/sharing/
- https://github.com/ahmeterenodaci/rn-mlkit-ocr
- 설치 패키지 LICENSE, src/index.tsx, android/build.gradle, RnMlkitOcrModule.kt 및 Expo Sharing Android intent handler와 대조했다.

기존 Expo57/RN0.86.3에서 타입·autolink/manifest 생성·Metro는 검사했다. 실제 native compile/OCR 품질·첫 인식 시간·APK 증가량·기기 메모리/배터리는 실제 APK 검사 전 미확인이다. 필요하지 않은 새 engine/registry/framework/DB를 추가하지 않았다.

## 현재 검사

- 캡처 정책·영속 inbox·실제 coordinator를 native/network 경계 mock으로 실행: 17/17 PASS.
- 전체 저장소 Node 회귀: 1000/1000 PASS.
- Mobile TypeScript, Expo dependency compatibility, QA Android Hermes export: PASS.
- QA prebuild: PASS. Android SEND image/* 단일 필터, QA package, 기존 scheme/audio/notification 설정 보존 확인.
- 로컬 기본 Kotlin 빌드는 Gradle 배포 다운로드 Network is unreachable로 중단됐다. 환경의 기존 프록시를 Java에 적용한 뒤 Gradle 실행은 확인했지만 제한 시간 내 native compile은 완료하지 못했다. SDK/컴파일 성공을 주장하지 않는다.
- GitHub 기존 Mobile App 네이티브 build/runtime smoke 및 실기 공유/OCR는 아직 별도 확인 대상이다. 모의 OCR 텍스트 검사를 한국어 native OCR 실실행으로 보고하지 않는다.

## 검수 경계

앱 종료/실행 상태의 실제 공유, 미로그인→로그인, OCR 한글 픽셀 정확도, 실제 서버 자동 Schedule 생성, 실제 알림 도착·수정·취소, QA APK 설치는 미완료다. DB migration·운영 설정 변경·기존 서명 교체·Play 제출·main 병합 없음.

일반 이미지 전체를 이해하는 AI가 아니다. V1은 명시된 약속 1건을 보수적으로 연결하고 불확실하면 확인 필요로 남긴다. 실제 기기에서 확인된 부족한 부분만 보강한다.

## 최소 동선 보강

직접 입력은 기존 Home 입력 화면을 initialScreen prop으로 그대로 재사용한다. 실패 후 직접 입력/홈으로 나가면 대기 항목을 삭제하지 않고 자동 재진입만 멈춘다. 명시적 장소 행을 제목/설명에 포함하고, 잘못된 달력 날짜·없음/완료/부정 표현을 확인 필요로 보수 처리한다. 공유 수신 중 다른 intent/계정 전환이 와도 새 payload를 지우지 않고 직렬 처리한다.

추가 안전 검사: warm URL 수신(AppState 전환 없음), 수신 중 새 intent·계정 전환, own-provider/앱-private file URI 거부, OAuth·알림 path 보존을 production 함수로 실행했다. 기존 Home은 공유 화면 아래에 보존해 미완성 음성/직접입력 상태를 임의 폐기하지 않는다. 상대 날짜는 연도·요일이 있는 대화 구분선과 메시지 시각이 함께 보일 때만 처리하며, 일반 캡처의 날짜 제목을 대화 날짜로 단정하지 않는다.
