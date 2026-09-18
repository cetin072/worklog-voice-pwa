# Codex 실행 지시문 — Quick Voice STT 0.1 / 교체형 오픈소스 구조

기준일: 2026-09-18  
Parent Issue: #353  
Parent Milestone: #355  
Working PR: #358  
Branch: `feat/353-quick-voice-stt-contract`

## 0. 최우선 목표

이번 작업의 목표는 특정 STT 엔진을 붙이는 것이 아니다.

**업무수첩의 Quick Voice를 실제 사용 가능한 흐름으로 만들되, STT/OCR/AI/Calendar 같은 외부 엔진은 언제든 교체할 수 있는 구조를 고정한다.**

목표 사용자 흐름:

```text
마이크 시작
→ 짧게 말함
→ 종료
→ STT
→ 업무 원문 저장
→ 기존 Data Core
→ 브리핑 즉시 갱신
→ 필요 시 inline 수정
```

기본 흐름에 별도 확인 화면을 강제하지 않는다.

## 1. Source of Truth

작업 시작 시 다음 순서로 읽는다.

1. 최신 GitHub `main`
2. `AGENTS.md`
3. Issue #353 / #355
4. PR #358 최신 HEAD와 review/comment
5. `docs/planning/WORK_NOTE_OPEN_SOURCE_MODULAR_ARCHITECTURE_V1.md`
6. `docs/planning/QUICK_VOICE_STT_0_1_V1.md`
7. 직접 수정할 인접 코드와 테스트

과거 채팅보다 최신 GitHub 상태를 우선한다.

새 Issue/Branch/PR을 중복 생성하지 말고 #358 안에서 계속 진행한다.

## 2. 절대 아키텍처 원칙 — Replaceability First

구조는 반드시 아래 경계를 유지한다.

```text
업무수첩 UI / Data Core / 업무 규칙
             ↓
      공통 Contract
             ↓
      Provider Adapter
             ↓
   실제 오픈소스/SDK/API
```

### 금지

- UI에서 `whisper.rn`, sherpa, faster-whisper 타입/함수를 직접 import
- Data Core가 provider 이름, 모델 파일 형식, native API를 알아야 하는 구조
- provider 결과를 검증 없이 canonical Transcript로 저장
- 특정 모델 경로를 앱 핵심 로직에 하드코딩
- 한 provider 실패 때문에 Quick Voice 전체 구조를 다시 쓰는 설계
- 모델을 base APK에 무조건 포함
- production secret / 유료 API 자동 도입

### 필수

- `service='stt'`, `operation='transcribe'` 공통 경계 유지
- provider-specific 코드는 provider adapter/composition 영역 안에 격리
- Transcript V1은 provider-neutral 유지
- audio evidence는 provider가 만들지 않고 trusted AudioInput에서 상속
- provider 선택은 registry/configuration에서 수행
- provider 제거/교체 시 UI/Data Core 수정이 없어야 함
- 테스트에서 provider-neutral 경계를 회귀 방지

## 3. 오픈소스 채택 기준

오픈소스는 "무료라서" 선택하지 않는다. 아래를 모두 비교한다.

### A. 법적/운영
- 라이선스
- 상업적 배포 가능성
- 제3자 라이선스 포함 여부
- Fork 필요성
- upstream 업데이트 추적 비용

### B. 유지보수
- 최근 release/commit
- Android/React Native 현재 지원
- issue/PR 활동
- 단일 maintainer 의존 위험
- native build 복잡도

### C. 제품 성능
- 한국어 문장 정확도
- 날짜/시간/금액/기관/이름 entity 정확도
- 10~30초 첫 전사 latency
- RAM/CPU/배터리/발열
- 앱 binary 증가량
- 모델 다운로드 크기
- offline 가능 여부

### D. 구조 적합성
- runtime model path 가능
- model download-on-demand 가능
- cancellation/retry 가능
- segments/timestamps 추출 가능
- 향후 30~60분 회의로 확장 가능
- Adapter 뒤에 숨기기 쉬운가

### E. 총비용
- 개발시간
- 유지보수시간
- 서버/GPU/API 비용
- 장애 대응 비용

## 4. 현재 PoC 우선순위

현재 1차 기준:

1. **whisper.rn + whisper.cpp**
   - React Native 직접 binding
   - MIT
   - Android 지원
   - 현재 Quick Voice 모바일 PoC에 가장 가까운 경로
2. **sherpa-onnx / SenseVoice 계열**
   - 강력한 offline/on-device 후보
   - Apache-2.0 core
   - RN wrapper와 포함된 제3자 라이선스/배포 조건을 별도 감사
3. **faster-whisper server**
   - MIT
   - 모바일 직접 탑재가 아니라 server baseline
   - local inference가 기기에서 불리할 때 교체 가능한 fallback 후보

이 순서는 영구 채택 순위가 아니다.
실측 benchmark 결과로 언제든 바꾼다.

## 5. 이번 작업 실행 순서

### Step 1 — Provider-neutral Core 완료
- provider registry / factory 경계 추가
- provider 선택이 UI에서 분리되어 있는지 확인
- unknown/unconfigured provider fail-closed
- provider 교체 계약 테스트 추가

### Step 2 — 저장 Fast Path 완료
- `saveWorklog()`가 optional stable `clientRequestId`를 받을 수 있게 확장
- 같은 Quick Voice 세션의 재시도는 같은 request ID 사용
- transcript 성공 → save → briefing refresh 공통 orchestration 추가
- save 성공 / refresh 실패를 분리

### Step 3 — Model lifecycle 경계
- base APK model embedding 금지
- model descriptor / version / checksum / local path 경계
- download-on-demand를 붙일 수 있는 인터페이스
- 다운로드 실패/공간 부족/불완전 파일 fail-closed

### Step 4 — whisper.rn 실제 PoC
- 최신 안정 버전을 고정해서 branch에서만 추가
- provider adapter 안에서만 import
- Expo prebuild/native build 필요 경계 기록
- multilingual 한국어 모델 runtime path 사용
- 10~30초 한국어 샘플로 실제 전사

### Step 5 — 실측 후 비교
다음을 기록:
- APK before/after
- model bytes
- 첫 로드 시간
- 10/30초 전사 latency
- 메모리/발열 체감
- 한국어 entity benchmark

whisper.rn 결과가 기준 미달이면 Core를 건드리지 말고 provider만 sherpa-onnx로 교체하여 비교한다.

### Step 6 — End-to-End
- Quick Voice UI 연결
- 종료 후 자동 STT
- STT 성공 후 canonical saveWorklog
- 저장 후 refreshBriefing
- 오인식은 저장 후 inline edit
- STT 실패 시 audio 보존 + 다시 전사 + 직접입력
- 중복 저장 방지

## 6. 테스트 Gate

최소:
- provider-neutral contract
- registry unknown/unconfigured fail-closed
- provider-specific import leakage 방지
- trusted audio evidence inheritance
- stable clientRequestId
- duplicate save 방지
- save 성공 / briefing refresh 실패 분리
- model descriptor/checksum contract
- TypeScript
- Android native build
- UAR

Human QA는 변경 범위만 한다.

## 7. 의사결정 방식

Codex는 한 후보가 막혔다고 전체 작업을 중단하지 않는다.

```text
whisper.rn PoC 실패
→ 원인과 증거 기록
→ Adapter/Core 유지
→ sherpa-onnx PoC로 이동

local STT가 기기 성능상 부적합
→ Adapter/Core 유지
→ faster-whisper server baseline 비교
```

사용자 승인이 필요한 경계:
- main merge
- production 변경
- 유료 서비스
- production secret
- Play Store 제출
- 대형 모델 base APK 포함

그 외 안전한 branch 코드/테스트/문서 작업은 가능한 데까지 계속 진행한다.

## 8. 완료 정의

완료는 "특정 라이브러리 설치"가 아니다.

다음이 만족되면 Quick Voice STT 0.1 완료다.

- 사용자가 짧게 말한다
- 전사가 된다
- 자동으로 기존 업무 저장 파이프라인에 들어간다
- 브리핑에 바로 보인다
- 실패하면 원문/audio를 잃지 않는다
- 중복 저장되지 않는다
- STT provider를 교체해도 UI/Data Core를 다시 만들지 않는다
- 선택한 엔진의 라이선스/용량/성능 근거가 GitHub에 남는다
