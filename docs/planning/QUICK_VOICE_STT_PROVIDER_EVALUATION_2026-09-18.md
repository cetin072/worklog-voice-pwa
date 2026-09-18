# Quick Voice STT Provider Evaluation — 2026-09-18

Issue: #353  
PR: #358  
Status: PoC candidate baseline, not permanent adoption

## 1. Decision rule

업무수첩은 특정 STT 엔진을 제품 Core로 채택하지 않는다.

Provider는 언제든 교체 가능해야 하며, 아래 조건을 만족한 후보만 실제 배포 후보가 된다.

- UI/Data Core/업무 규칙이 provider native API를 import하지 않음
- 공통 MobileTranscriptionProvider contract 뒤에 위치
- model lifecycle이 download-on-demand / checksum / version 경계 뒤에 위치
- 한국어 정확도와 핵심 entity benchmark를 통과
- Android release build와 binary size 측정 통과
- 라이선스/제3자 라이선스 배포 조건 확인
- 실패/취소/재시도 가능
- 총운영비가 합리적

## 2. Candidate A — whisper.rn / whisper.cpp

Current baseline:
- whisper.rn: 0.7.2
- license: MIT
- underlying whisper.cpp: MIT
- React Native Android/iOS binding
- Expo에서는 native prebuild/development build 필요
- raw PCM ArrayBuffer를 transcribeData()로 전달 가능
- Whisper requirement: 16kHz mono 16-bit PCM
- runtime model file path 사용 가능
- model을 APK에 강제 포함하지 않고 runtime download 가능

업무수첩 적합성:
- 현재 Expo AudioStream PCM과 직접 연결 가능
- 별도 WAV/M4A 변환 없이 Quick Voice PoC 가능
- provider adapter로 격리하기 쉬움
- 1차 PoC 우선 후보

주의:
- native dependency이므로 새 development/release build 필요
- 실제 Expo 57 / RN 0.86 Android 빌드는 이 저장소 CI에서 검증 필요
- 모델 크기/메모리/발열은 실제 기기 측정 필요

## 3. Candidate B — sherpa-onnx / SenseVoice 계열

Current baseline:
- sherpa-onnx core: 1.13.8
- core license: Apache-2.0
- Android prebuilt artifacts 제공
- React Native wrapper candidate: react-native-sherpa-onnx 0.4.4
- wrapper license: MIT

장점:
- offline/on-device speech stack이 넓음
- VAD/STT/diarization 등 향후 확장성이 큼
- Android native 지원이 활발함

주의:
- 현재 RN wrapper는 FFmpeg/Shine 등 LGPL 제3자 구성요소를 명시함
- 상용 APK 배포 시 THIRD_PARTY_NOTICES 및 LGPL 준수 조건 감사 필요
- wrapper와 core를 같은 것으로 보지 말 것
- 1차 PoC 결과가 부족할 때 2차 비교

## 4. Candidate C — faster-whisper server

Current baseline:
- faster-whisper: 1.2.1
- license: MIT
- CTranslate2 기반 server inference
- 모바일 APK native dependency가 아님

장점:
- Android 기기 성능과 무관하게 일관된 inference 가능
- local STT의 속도/발열/메모리가 불리할 때 좋은 baseline
- provider adapter 뒤에서 교체 가능

주의:
- 서버/GPU 운영비
- 네트워크 latency
- offline 불가
- 음성 데이터 전송에 따른 개인정보/보안 정책 필요

## 5. Current PoC order

1. whisper.rn local PCM
2. sherpa-onnx local comparison
3. faster-whisper server baseline

이 순서는 제품 채택 순위가 아니다.

실측 결과가 나쁘면 Core/UI/Data Core는 유지하고 provider implementation만 교체한다.

## 6. Required benchmark

한국어 10초 / 30초 샘플 세트에 다음 유형을 포함한다.

- 날짜: “9월 22일”
- 시간: “오후 2시 30분”
- 금액: “350만원”
- 기관명
- 사람 이름
- 일정 + 업무가 섞인 문장
- 숫자/영문 약어가 섞인 문장

기록:
- full sentence correctness
- entity correctness
- first model load
- transcription latency
- peak/체감 memory
- 발열/배터리 체감
- APK binary delta
- model download bytes

## 7. Current implementation boundary

Already prepared in #358:
- transcription-provider.ts
- stt-provider-registry.ts
- stt-model.ts
- quick-voice-pcm.ts
- quick-voice-flow.ts
- providers/whisper-rn-provider.ts

Concrete package import/init belongs in composition/native integration only.

whisper.rn을 제거하더라도 위 Core 계약은 유지되어야 한다.

## 8. 2026-09-18 implementation checkpoint

`whisper.rn 0.7.2`의 Android ARM64 release build는 PR #358의
`android-standalone` job에서 성공했다. 이 결과는 native binding이 현재 Expo
57 / React Native 0.86 조합에서 build-time 후보 조건을 충족한다는 근거이며,
한국어 품질 채택 판정은 아니다.

Quick Voice의 현재 runtime path는 아래와 같다.

```text
first microphone tap
→ runtime download of ggml tiny multilingual model
→ available-space check + SHA-256 verification
→ verified local cache only
→ whisper.rn context
→ 16kHz mono signed-int16 PCM transcribeData()
→ canonical saveWorklog()
→ refreshBriefing()
```

The initial model candidate is `ggml-tiny.bin` (multilingual, 77,691,713
bytes) from the upstream `ggerganov/whisper.cpp` model distribution. It is
never bundled in the base APK; the runtime cache only promotes a download after
the expected SHA-256 matches. A partial, wrong-sized, or checksum-failed file
is removed.

Still required before adoption:

- Android device Korean 10/30-second entity benchmark
- first model-load and transcription latency measurements
- RAM, thermal, and battery observations

## 9. ARM64 release size checkpoint

The end-to-end commit `cf10a2a` passed the Mobile App Android standalone
release workflow (run `35300670285`). The uploaded ARM64 APK is
**51,328,008 bytes (48.95 MiB)**.

- STT-before baseline: 46,053,076 bytes
- APK delta: +5,274,932 bytes (+11.45%)
- Runtime model download: 77,691,713 bytes, separate from the APK

This is a release-build size checkpoint, not a Korean quality/adoption
decision. The runtime model remains download-on-demand and is not embedded in
the APK.

Until these measurements exist, the provider remains a PoC candidate rather
than a permanent default.
