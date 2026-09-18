# Quick Voice STT 0.1 V1

Issue: #353  
Parent: #355  
Architecture: #151 / #175

## 사용자 흐름

```text
Quick Voice 녹음
  → AudioInput
  → STT Adapter
  → Transcript V1 의미
  → 사용자 확인/수정
  → canonical saveWorklog()
  → Data Core
  → refreshBriefing()
```

## 이번 단계의 핵심

- UI와 Data Core는 특정 STT provider를 알지 않는다.
- provider는 `service=stt`, `operation=transcribe` 경계 뒤에 둔다.
- STT 결과의 audio reference는 provider가 임의 지정하지 않고 검증된 Mobile AudioInput에서 상속한다.
- 사용자가 확인한 텍스트만 기존 worklog 저장 경계로 전달한다.
- 날짜/시간 해석은 기존 schedule parser를 재사용한다.

## 상태 머신

```text
idle
→ recording
→ captured
→ transcribing
  ↘ transcript_error
→ review
→ saving
  ↘ save_error
→ saved
→ briefing refresh
```

STT 실패와 저장 실패를 구분하고, 저장 성공 후 briefing refresh 실패도 저장 실패로 오해하지 않게 한다.

## Provider 순서

1. provider-neutral mock/contract
2. whisper.rn local PoC
3. sherpa-onnx 비교
4. faster-whisper server baseline

최종 선택은 한국어 정확도, latency, 메모리/배터리, Android 통합, APK 증가량, model download 크기, 장시간 확장성으로 결정한다.

## 모델 정책

- base APK에 모델을 기본 포함하지 않는다.
- download-on-demand 우선.
- multilingual tiny/base quantized부터 비교.
- checksum/version/cache/공간 부족/다운로드 실패 복구를 설계한다.
- 모델 크기는 APK 크기와 별도로 표시한다.

## 0.1 비범위

- 장시간 회의 최적화
- 통화 자동분석
- speaker diarization
- AI 요약
- 유료 STT 자동 연결
- production secret
- 자동 일정 확정
