# 업무수첩 Play 업데이트 후보 — 2026-11-11

사용자 채팅 ‘정식앱에 올리자’에 따른 기존 Play 설치본 업데이트 후보다. 공개 Production 트랙 확대는 하지 않는다.

## 후보 범위

제품 PR #525/#532의 계정·기록·초안과 홈을 보존하고 #534/#535/#536의 정기지출·반복업무·습관을 재사용한다. QA 04fd95d의 시작 오류 수정 및 15474ba의 취소 버튼 identity/활성 상태, native 검사 보완을 포함한다. main 기준 제품 파일만 수집하며 QA checkpoint PR #537 자체를 retarget/merge하지 않는다. QA 전용 보고서·증거 이미지·렌더러는 출시 코드로 복제하지 않는다.

## Console 읽기 확인

기존 앱 com.cetin072.worklog는 비공개 테스트 Alpha, 현재 0.1.0/code8이다. 모든 App Bundle 7건(8/7/6/5/3/2/1)을 확인했다. 최고 code8보다 큰 code9로 기존 업로드 키를 사용한다. QA의 com.cetin072.worklog.qa/code12와 혼동하지 않는다. 프로덕션 액세스는 아직 비활성으로 기존 트랙만 업데이트한다.

## 적용·검사 경계

공유 worklog 프로젝트의 구독/결제수단/정기지출/반복업무/습관 migration은 앞선 승인으로 적용돼 있으며 재적용하지 않는다. 사용자 데이터 삭제·변환·시험 행 생성 없음. DB 확인은 읽기 전용이다.

TypeScript·회귀·native runtime·exact-candidate Firebase 실기기 PASS를 확인한 뒤 main 병합과 AAB/기존 트랙 제출을 진행한다. Firebase 한도 초과는 대기이며 승인 없는 예외 입력·유료 전환을 하지 않는다. 세부 실행 결과와 정확한 source SHA/run ID·서명·해시는 릴리즈 PR에 기록한다. 이 문서는 Play 제출 완료를 의미하지 않는다.
