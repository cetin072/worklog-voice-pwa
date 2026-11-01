# Firebase 실기기 검사 운영

2026-11-01 사용자 승인. 채팅방·작업자를 바꾸어도 AGENTS.md와 이 문서를 따른다.

## 수정 중과 최종 후보

일반 수정은 기존 타입·코드 회귀·Android bundle/에뮬레이터 검사로 반복한다. Firebase는 Google의 실제 Pixel 5를 쓰는 별도 검사이며, 코드 테스트 개수와 기기 실행 횟수는 다르다. 매 PR push의 자동 Firebase 실행은 하지 않는다.

최종 출시 후보, 또는 native dependency/permission/manifest·인증/deep link·음성·알림·사진 등 기기 경계가 바뀐 안정된 체크포인트에서 main의 Android Physical Device Gate를 수동 실행한다. 최신 기본 검사가 통과한 정확한 40자리 source_sha를 지정한다. 검사 정책이 포함된 후보를 사용한다. 정식 Play 서명 검사가 아니라 합성 QA APK의 기기 화면 검사라는 범위를 유지한다.

## 실행과 중복 억제

GitHub Actions → Android Physical Device Gate → Run workflow → branch main → source_sha 입력. CLI를 쓴다면 기존 정상 로그인에서 다음과 같이 실행한다.

```bash
gh workflow run firebase-test-lab.yml --ref main -f source_sha=검사할_40자리_SHA
```

같은 SHA 실행은 직렬화한다. 최근 성공 run 100개 중 동일 후보의 만료되지 않은 결과 artifact가 있으면 확인 후 재사용한다. 원 검사 run 링크를 보존하며 새 기기 검사를 했다고 표시하지 않는다. artifact가 만료되거나 검색 범위 밖이면 새 검사가 필요할 수 있다. 다른 SHA·기기·실패·한도 초과 결과를 재사용하지 않는다.

## 상태와 비용

- PASS: 실제 기기 검사 성공 또는 출처가 확인된 같은 후보의 PASS 재사용.
- FAIL: 제품/실행 오류. 원인을 해결하고 기본 검사를 거쳐 새 후보를 만든다.
- WAITING_QUOTA: TEST_QUOTA_EXCEEDED. 기기 실행 전 거절되었으며 PASS가 아니다. Actions job은 실패로 남고 summary와 result.json에는 검사 대기로 기록한다.
- 빌드/인증/다운로드 단계의 실패 또는 취소는 PASS도 quota 대기도 아니다. 해당 단계 로그를 확인한다.

한도 초과 시 자동 재시도하지 않는다. 다음 일일 할당량을 기다리거나, 사용자 승인을 받고 로컬 실기기 검수/생략 근거를 기록한다. 같은 프로젝트 무료 한도를 다른 프로젝트 생성으로 우회하지 않는다. Blaze 전환·결제 연결·할당량 유료 확대는 별도 승인이다. 무료 한도는 실행 시점 공식 문서와 Console에서 확인하며 리셋 시각을 한국 자정으로 추정하지 않는다.

## 출시 연결

기존 Android Play AAB workflow에 physical_gate_run_id를 입력한다. 빌드는 해당 run의 실제 workflow 경로·성공 여부와 firebase-physical-result/result.json의 source SHA·고정 기기를 확인한다. 다른 후보 결과로 빌드하지 않는다.

예외가 필요한 경우 사용자에게 승인받은 사유·승인 대화/기록·대체 검수 근거를 physical_gate_exception에 입력하고 run ID는 비운다. 예외는 APPROVED_EXCEPTION으로 기록되며 Firebase PASS가 아니다. 문자열 입력 자체가 사용자 승인 절차를 대신하지 않는다. 사용자 승인 없는 예외 입력을 금지한다.

GitHub Actions summary와 artifact를 출시 기록에 연결한다. 검사 후 소스 SHA가 바뀌면 자동 재사용하지 않는다. 문서만의 변경처럼 영향이 없더라도 새 후보에 대한 명시적 승인 예외 또는 재검사로 기록을 남긴다. Play Console 수동 제출에서도 같은 규칙을 따른다. 보호규칙이나 수동 업로드 권한을 변경해 강제하는 범위는 이번 정책에 포함하지 않는다.

Google 계정 동의·실제 Calendar 등록·알림 도착·Play 스토어 이동 등 Robo 범위 밖 항목은 사용자 기기 검수로 별도 확인한다. 작은 UI/문구 변경을 이유로 전체 Human QA를 반복하지 않는다.

공식 기준: https://firebase.google.com/docs/test-lab/usage-quotas-pricing
