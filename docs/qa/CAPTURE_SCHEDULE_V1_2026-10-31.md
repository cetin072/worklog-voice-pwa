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

## 후속: 수정 버튼을 누를 때 대기 제거

캡처 결과에 이미 서버 상세(title/dueDate/dueTime)가 있으면 첫 수정부터 즉시 편집한다. 빈 시간 문자열은 시간이 없다는 확인된 정보이므로 재조회를 기다리지 않는다. 필수 상세가 없는 경우만 조회를 기다린다. 최신 정보 조회는 뒤에서 진행하고 사용자가 바꾼 필드는 덮어쓰지 않는다. 취소·항목 변경·계정 변경·저장 시작은 이전 조회 응답을 무효화한다. 실제 수정 저장 중 대기 표시는 유지한다.

프로덕션 화면의 실제 편집 함수/입력 handler를 실행하는 회귀검사 4건을 추가했다. 즉시 편집, 누락 상세, 오프라인 갱신, 입력 중 늦은 응답, 빠른 항목 전환, 취소, 저장 중 응답을 검사한다. 기존 홈 편집 회귀검사 5건도 통과했다. 네이티브 의존성·권한·서버 계약 변경은 없다. 실제 기기에서의 체감 검수는 자동 함수 검사와 구분한다.

## 후속: 앱 안에서 캡처 가져오기 / 저장 후 찾기

- 홈의 회의 녹음·직접 입력 아래에 Android ‘캡처 가져오기’를 추가한다. 공식 expo-image-picker 57.0.20(MIT, Expo SDK57 호환 버전)을 사용하며 기존 공유 수신도 유지한다. 이미지 한 장, 편집 없음, quality:1로 원본 bytes를 복사하는 provider를 사용해 기존 SHA-256/inbox/멱등 저장 경로로 합류한다. 취소하면 저장/복사/화면 이동이 없다.
- 기존 expo-intent-launcher 57.0.1의 native 반환은 URI 대신 Intent.toString()이어서 이미지 주소를 추측 파싱하지 않고 공식 picker를 선택했다. 카메라 권한은 차단하고 기존 마이크 권한/음성 기능은 보존한다. 전체 갤러리 접근 권한을 요청하지 않는다. Android Photo Picker/문서 선택의 선택된 항목만 사용한다.
- picker가 만든 앱 cache 파일만 별도의 trusted import로 받아 개인 inbox에 복사하고 cache를 정리한다. 외부 share URI는 앱-private/cache 경로를 계속 거부한다. 새 입력은 계정 전환 시 원래 계정에만 보관하고 다른 계정 화면을 열지 않는다. picker 복귀 시 오래된 대기 항목이 화면 이동을 가로채지 않게 한다.
- 사용자 실기기 결과에서 날짜 미확정 기록은 Schedule이 아닌 기한 없는 확인 필요 업무임을 확인했다. 원본 캡처/사용자 이름을 공개 테스트에 복제하지 않고 구조만 익명 예제로 재현한다. Home을 보존한 채 저장하면 목록이 갱신되지 않던 누락을 수정했다. 저장/수정/취소 완료는 계정·기록 ID를 기준으로 기존 Home 조회를 무효화한다. Home이 아직 없는 cold share도 해당 계정의 후속 화면에서 반영하고, 확인 필요 항목은 기한 없음 탭을 선택·펼친다. 가짜 저장 행을 주입하지 않고 서버 목록을 다시 읽는다.
- 날짜·시간 수정으로 새 Schedule이 생성되면 기존 연결 조회로 서버 Schedule ID를 확인하고 결과의 저장 상태도 바꾼다. 홈 갱신은 일정 생성 시도 이후 수행한다. 기존 서버 데이터/DB 스키마 변경은 없다.
- runtime smoke에 실제 홈 버튼 → Android system picker 열기 → 취소 → 앱 복귀의 비파괴 검사를 추가했다. 실제 선택 이미지의 한국어 OCR·서버 저장·알림 전체 동선과 구분한다. 사용자가 제시한 화면만으로 서버 DB 행을 직접 확인했다고 주장하지 않는다.

참고: https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/ 및 설치된 Android MediaHandler/RawImageExporter/Manifest/config plugin 소스. Android 원칙: https://developer.android.com/training/data-storage/shared/photo-picker

사용된 시각 표현 확인 과정에서 기존 시간 Core는 ‘오후 13시’를 인식하지 못함을 재현했다. 공통 Core는 바꾸지 않고 캡처 입력의 중복 오후 표기(13~23시)만 24시간 표기로 정규화한다. ‘오전 13시’처럼 모순된 표기는 확정하지 않으며, 상대 날짜의 대화 날짜 검증은 유지한다. 실제 사용자 이름/원문은 회귀검사에 넣지 않는다.
