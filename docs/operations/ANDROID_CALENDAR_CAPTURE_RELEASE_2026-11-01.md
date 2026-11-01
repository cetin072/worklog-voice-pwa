# 업무수첩 정식 업데이트 인계 — 2026-11-01

## 반영 결과

사용자가 QA12(489a1f59f75a913fb319bc9d30ddbef216b9bf6e)를 검수하고 정식 반영을 승인했다.

- 캡처 PR #473 병합: 1c2e129821be3e7b3d454cc235b9721cf7b6562f
- Calendar PR #474 병합: 2d59a8ca8b4a7701eded711a22606c8a73f33b81
- 기능 최종 소스: b94a468ac7018f117ae8be8f8df850df4e42f090, 병합 tree 25a696eeec1182c1b6f0c2ed15dc10cd53157e70 일치
- Mobile 41258029197: 5 job 성공, 443개 테스트·타입·번들·ARM64·x86 실행 검사 통과
- Web UAR 41258029217 성공
- Firebase 41258029185: 빌드 성공 후 TEST_QUOTA_EXCEEDED로 실제 기기 실행 전 실패. 사용자가 이 항목을 이번 반영에서 생략하도록 명시 승인. PASS로 처리하거나 workflow를 무력화하지 않았다.

정식 Calendar 노출, 알림과 독립된 단건 전송, 선택형 종료 시간, 간결한 버튼/설정, 사진 입력과 OCR 제목 보존 및 취소 후 재등록을 포함한다. QA/정식의 별도 보관함에서 서버 취소 상태를 재확인하고 명시적 재등록에는 기존 Expo Crypto UUID를 사용한다. 레거시 ID는 읽기 호환한다. 새 DB/migration/운영 데이터 일괄 변경 없음.

## 다음 단계 — 아직 Play 제출·배포 아님

1. 기존 Play Console 업무수첩(com.cetin072.worklog)의 모든 트랙/초안 최고 versionCode를 확인한다. 과거 code5 빌드 성공이나 QA12 숫자로 현재 최고값을 추정하지 않는다.
2. Supabase worklog-platform(zlhdhwgabqzsuuhaiedc)의 Redirect URLs에 worklog://google-auth?purpose=calendar 허용 여부를 정상 대시보드에서 확인한다. 사용자 승인 없이 Auth 설정을 변경하지 않는다. 비밀키를 채팅에 요청하지 않는다.
3. 위 확인 후 기존 play-android-aab.yml에 정확한 최종 main SHA, Console-verified 최고값, 그보다 큰 승인된 새 code를 전달한다. 기존 정식 identity/업로드 키를 그대로 사용한다.
4. AAB manifest·패키지·버전·해시·업로드 인증서·QA flag 부재 확인 후 기존 비공개 Alpha 업데이트를 준비한다. 공개 Production 출시로 확대하지 않는다. 기존 제출/정책 항목의 현재 Console 상태도 확인한다.
5. 패치노트·개인정보 안내 변경의 main CI 및 실제 운영 privacy URL 반영 여부를 확인한다. main 병합과 Netlify 게시·Play 검토·기기 설치 가능 여부는 각각 보고한다. 정기 웹 배포 제외/정책을 임의 변경하지 않는다.

## 접근 제한

이 환경의 브라우저 시작은 bwrap가 /home/agent/.codex/sessions를 read-only filesystem에 생성하지 못해 실패했다. Ego CLI도 제공되지 않는다. 재시도/권한 변경/우회하지 않았다. 따라서 Console 최고 code와 정식 redirect는 미확인이다. Console 접근 가능한 작업방 또는 사용자의 직접 확인이 필요하다.

## 업데이트 팝업

정식 소스는 AppUpdatePrompt를 시작점에서 연결하고 Play UPDATE_AVAILABLE일 때 선택형 안내를 표시한다. 같은 JS 실행에서 닫으면 반복 억제한다. 소스 반영/AAB 생성만으로 업데이트 안내가 발생하지 않는다. Play 배포와 사용자 자격이 필요하고 기존 설치본의 구현 포함 여부는 별도로 확인해야 한다.
