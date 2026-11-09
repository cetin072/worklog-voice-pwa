# 계정 로컬 데이터 보호 체크포인트

#521: 서버 getUser가 확인한 계정 ID에 한해 로컬 접근 scope를 연다. 계정별 새 JSON index는 ownerUserId를 기록/검증한다. 전역 기존 meeting-recordings-v1.json과 소유권 없는 M4A/회의록 JSON은 읽어 자동 귀속하거나 이동/삭제/덮어쓰지 않는다. 신규 녹음은 native prepare 뒤 실제 파일 URI와 시작 계정의 인덱스를 capture 시작 전에 저장한다. 강제 종료 후에도 그 계정 인덱스에서 원본을 찾으며 미종료 파일은 길이0/실제 player duration으로 복구된다. 포맷이 손상됐으면 오류로 보존한다.

리스트/재생/수정/공유는 현재 계정 index의 ID/URI와 재대조한다. 계정 전환시 Home keyed tree가 폐기되고 로컬 scope는 즉시 비워진다. 진행 녹음은 보관 중인 시작 계정에 종료 결과를 저장하며 B 화면에 A completion을 보여주지 않는다. 파일/인덱스 쓰기 실패시 원본은 남으며 성공으로 표시하지 않는다.

## 기존 무소유 자료 복구 절차

1. 앱 삭제/저장공간 초기화/다른 QA signer 설치 금지. 기존 앱-private 파일과 index/JSON을 그대로 보존한다.
2. 소유자를 모르는 자료는 어떤 계정에도 자동노출하지 않는다. 앱 안내에서 지원을 요청한다. 운영자도 내용을 일괄 읽거나 현재 로그인계정으로 자동귀속하지 않는다.
3. 사용자가 원래 기기와 해당 자료 소유 계정을 확인하고 명시적으로 선택할 수 있는 보안 검수된 복구 세션을 별도 승인한다. 기기 소유 사실만으로 파일 소유자를 결정하지 않는다.
4. 승인된 범위의 원본을 안전하게 백업/체크섬 검증하고, 원본 수정 없이 해당 계정의 새 index에 링크하는 최소 복구 도구를 검토한다. 기존 파일 이름/내용은 유지한다. 현재 후보는 이 수동 복구 도구를 구현하지 않았다. 자료가 삭제된 것이 아니며 영구폐기 정책도 아니다.

#506/#507 보완: 앱시작/OAuth/직접 계정변경에서는 로컬 scope 및 공개 세션을 즉시 비운다. 기존 service queue의 알림 취소/재확인 후 서버 getUser ID가 맞을 때만 다음 계정을 공개한다. Supabase auth listener가 반환된 뒤 auth 메서드를 호출해 listener lock 교착을 피한다. 오래된 비동기 응답은 epoch로 폐기. 취소실패는 미로그인 화면에 보존되고 새로고침/로그인 preflight에서 재시도한다. 기존 ownerless schedule 알림이 추적되지 않아 소유권을 입증할 수 없으면 계정공개를 막고 무단삭제하지 않는다. 별도 복구 승인 없이 이 경계를 무시하지 않는다. 서버 일정/다른 owner-tag OS알림 불변.

#133 OPEN: 기존 dual-write coordinator의 실제 코드에 synthetic Notion commit후 응답유실, 두 coordinator 병렬 요청을 주입하면 Notion create가2회 발생한다. DataCore canonical ID는 유지되며 실제 Notion API/페이지 변경은 없다. Netlify progress read/write는 분산 CAS가 아니고 Notion create의 원격 commit과 atomic하지 않다. 단순 JS lock이나 사전 pending flag만으로 완전한 멱등성을 주장하지 않는다. 기존 Notion 페이지 자동삭제/병합 금지. test 이름 OPEN #133은 이 미해결 위험의 재현 증거이지 해결PASS가 아니다. QA에서는 DataCore원본이 기본이고 optional Notion보조저장시 자동재시도에 중복위험이 남는다.

## 검증 한계

실제 SDK 녹음 start/prepare URI/강제종료 파일마무리, 실제 Pixel 알림취소·도착, Android 공유창·재생 중 계정전환은 Native runtime 및 사용자 기기 검증이 필요하다. mocked Node PASS를 HUMAN으로 기록하지 않는다. 기존 레거시 파일 자동복구 테스트는 현재의 무소유 자료 자동귀속 금지 요구로 바꾸었고, 원본 byte보존과 A/B scope 테스트로 대체했다. 테스트를 삭제해 보안실패를 숨기지 않는다.
