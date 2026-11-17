# Google 캘린더 자동 연결 유지 (미병합 개발)

인증 시간이 지나면 Google 연결을 자동 갱신합니다. 통신 장애 때는 연결을 보존하고 재시도하며, Google 권한 철회·갱신권한 만료 시 재연결을 안내합니다.

서버 OAuth 설정·배포 및 실계정 QA 확인 후 병합/출시 시 mobile/src/features/settings/patch-notes.ts 반영. 기존 online 연결은 업데이트 후 최초 1회 동의가 필요합니다. OAuth Testing 게시 상태이면 7일 만료가 적용될 수 있습니다.
