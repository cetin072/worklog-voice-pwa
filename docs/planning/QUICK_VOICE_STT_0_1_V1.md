# Quick Voice STT 0.1 V1

Issue: #353  
Parent: #355  
Architecture: #151 / #175

## 1. 사용자 흐름 — Web Quick Voice parity

기본 흐름은 별도 확인 화면을 강제하지 않는다.

```text
Quick Voice 시작
  → 짧은 PCM 녹음
  → 종료
  → STT Adapter
  → Transcript V1
  → canonical saveWorklog()
  → Data Core
  → refreshBriefing()
  → 브리핑에서 즉시 확인 / 필요 시 inline 수정
```

웹 main의 `public/app.js`, `public/quick-save.js`, `public/main-ui-state.js`와 같은 속도 원칙을 따른다.

웹은 사용자가 음성을 종료하면 recognition 결과를 바로 저장하고 브리핑을 갱신한다. 모바일 STT도 별도 확인 화면을 기본값으로 추가하지 않는다.

## 2. Provider-neutral 원칙

- UI와 Data Core는 특정 STT provider를 알지 않는다.
- provider는 `service=stt`, `operation=transcribe` 경계 뒤에 둔다.
- provider-specific type은 Transcript/Core 밖으로 새지 않는다.
- STT 결과의 audio reference는 provider가 임의 지정하지 않고 검증된 Mobile AudioInput/PCM capture에서 상속한다.
- Call 전용 `call-transcript-adapter.mjs`를 Quick Voice에 직접 결합하지 않는다.
- Transcript V1 의미와 Platform Adapter 원칙만 재사용한다.

## 3. 상태 머신

```text
idle
→ recording
→ captured
→ transcribing
  ↘ transcript_error
→ saving
  ↘ save_error
→ saved
→ briefing refresh
  ↘ refresh_error
```

### transcript_error
- audio/PCM 보존
- 다시 전사
- 직접 입력

### save_error
- transcript 보존
- 같은 confirmed text는 같은 clientRequestId로 재시도
- 버튼 연타 중복 저장 금지

### refresh_error
- 업무 저장 성공 상태는 유지
- 브리핑만 다시 불러옴

## 4. 자동 저장을 중단하는 조건

다음 경우에는 자동 저장하지 않는다.

- transcript empty
- STT provider error
- audio capture 불완전
- 사용자 명시 취소

날짜/시간 해석이 애매하다는 이유로 음성 원문 업무 저장 자체를 막지 않는다. 기존 parser가 보수적으로 Schedule 생성 여부를 판단한다.

## 5. Quick Voice PCM 입력

기존 장시간 회의용 `RecordingPresets.HIGH_QUALITY` M4A recorder는 유지한다.

Quick Voice local STT는 현재 설치된 `expo-audio 57.0.5`의 `useAudioStream()` raw PCM 경계를 우선 사용한다.

요청 포맷:

- sampleRate: 16000
- channels: 1
- encoding: int16

중요:

- 요청 sampleRate와 실제 device sampleRate는 다를 수 있다.
- 실제 `buffer.sampleRate` / `stream.sampleRate`을 확인한다.
- 실제 channel 수도 확인한다.
- 16kHz mono가 아니면 Whisper 입력이라고 가정하지 않는다.
- 0.1 PoC에서는 fail-closed하고, 필요 시 별도 resampling 경계를 후속으로 추가한다.
- 짧은 음성 경로이므로 memory capture 크기를 제한한다.

구현:
`mobile/src/features/voice/quick-voice-pcm.ts`

## 6. Provider PoC 순서

1. provider-neutral adapter/mock contract
2. whisper.rn + whisper.cpp local PoC
3. sherpa-onnx SenseVoice local 비교
4. faster-whisper server baseline

결정 기준:

- 한국어 전체 문장 정확도
- 날짜/시간/금액/기관/이름 entity 정확도
- 10~30초 latency
- Android CPU/RAM/발열
- native APK delta
- model download bytes
- offline 여부
- 유지보수/라이선스
- 향후 회의 확장성
- 총운영비

## 7. Local 모델 정책

- STT model을 base APK에 기본 포함하지 않는다.
- STT 전 baseline APK: 46,053,076 bytes.
- multilingual quantized tiny/base부터 비교한다.
- 모델은 runtime download-on-demand를 우선한다.
- checksum/version/cache/공간 부족/다운로드 실패 복구를 설계한다.
- 앱 binary 크기와 model download 크기를 따로 표시한다.

whisper.rn 도입 시 model은 runtime file path로 초기화하는 방향을 우선한다.

## 8. 저장/idempotency

Quick Voice 한 녹음 세션은 stable capture identity를 가진다.

저장 원칙:

- transcript 저장 시 stable clientRequestId 사용
- 동일 transcript 저장 retry는 같은 request ID
- saving 중 버튼 연타 금지
- unknown network response 이후 retry도 같은 ID
- 저장 성공 뒤 브리핑 fetch 실패는 새 업무 저장 retry로 이어지지 않음

기존 `saveWorklog()`가 매 호출마다 requestId를 새로 생성하는 부분은 실제 Quick Voice integration 단계에서 optional stable request ID를 받을 수 있도록 보완한다.

## 9. 저장 후 수정

오인식 수정은 별도 저장 전 review 화면이 아니라:

- 성공 결과 카드
- #351 Home briefing inline edit

을 우선 사용한다.

날짜/시간 수정은 기존 `/api/worklog-edit` + Data Core Schedule update 경계를 재사용한다.

## 10. 0.1 비범위

- 30~60분 회의 STT 최적화
- 통화 자동 처리 전체
- speaker diarization
- AI 요약
- 유료 provider 자동 연결
- production secret
- 자동 일정 확정
- 대형 모델 base APK embedding

## 11. Human QA

기존 OAuth/Calendar 전체 검수는 반복하지 않는다.

변경 범위만 확인:

1. Quick Voice 시작/종료
2. PCM 실제 sample rate/channel
3. 한국어 전사
4. 종료 후 자동 저장
5. 브리핑 즉시 반영
6. 오인식 inline 수정
7. STT 실패 복구
8. 중복 저장 없음
9. model download/재사용
10. size delta
