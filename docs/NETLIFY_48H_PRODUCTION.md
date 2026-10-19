# Netlify 48시간 Production 운영

상태: 2026-10-19 사용자 통합 정상화 지시로 확정. 실제 활성화·CI·Preview 증거는 연결 PR에 기록한다.

- 저장소: `cetin072/worklog-voice-pwa`
- 사이트 ID: `1ab24b2c-a3e7-479f-8c1b-bbd0a567a25d`
- 실제 Git 연결의 Production branch는 `main`을 유지한다.
- 고정 기준점: 2026-10-19 17:20 KST. 최초 확인: 2026-10-21 17:20 KST, 이후 +48시간.
- 매일 17:20 KST Actions wake-up → 생성 시각에 해당하는 48시간 슬롯만 허용. cron `*/2`를 쓰지 않아 월말·연말에 간격이 짧아지지 않는다.
- GitHub 지연은 슬롯 시작 후 24시간까지 허용한다. 원래 슬롯이 끝난 작업·같은 슬롯 재실행·중복 실행은 배포하지 않는다.
- 마지막 **성공적으로 공개된** Netlify Production SHA와 최신 `origin/main`의 실제 웹 빌드 입력을 비교한다. 모바일·문서·테스트만 바뀌면 `NO_CHANGES`.
- 변경이 있어도 직전 실제 공개 후 48시간 미만이면 다음 고정 슬롯까지 대기한다.
- GitHub 권한은 Contents read / Actions read다. main 커밋·PR 생성·자동 merge를 하지 않는다. 기존 PR CI·보호 규칙은 유지한다.
- 일반 Git main 빌드는 `ignore`에서 중단한다. PR Preview와 기존 QA branch는 계속 허용한다.
- Netlify Build Hook은 ignore를 무시하므로 **build.command에서도** 요청의 저장소·사이트·SHA·슬롯·90분 유효시간·직전 공개 시각을 검증한다. 요청 이후 main이 바뀌면 실제 빌드 SHA 불일치로 실패한다.
- Build Hook URL은 사이트별 GitHub Secret `NETLIFY_PRODUCTION_BUILD_HOOK` 하나에 저장한다. 별도 GitHub App/PAT/서버는 필요 없다. URL은 비밀값이며 PR/로그/문서에 기록하지 않는다.
- `NETLIFY_PRODUCTION_RELEASE_ENABLED=true` repository variable로 예약 활성화 여부를 구분한다. 수동 workflow_dispatch는 branch와 무관하게 **항상 읽기 전용**이고 Hook Secret을 주입하지 않는다.
- 요청 POST는 한 번만 한다. 응답 유실도 재전송하지 않고 공개 SHA를 관찰한다. 실패·타임아웃은 기존 공개 버전을 기준으로 남기고 다음 48시간 슬롯에서 다시 비교·재시도한다.
- 결과는 Actions summary와 14일 보관 artifact에 남긴다. 실패한 run의 로그는 GitHub에 남는다. 완료되지 않은 게시를 성공으로 기록하지 않는다.
- 기존 release marker는 build 산출물에서만 실제 source SHA/실행 정보로 보강한다. 저장소와 main을 변경하지 않는다.

## 검증 경계

전용 회귀 검사는 월말·윤년 포함 900개 슬롯, 신규/변경 없음, 최소 48시간, 부분 실패·다음 슬롯 재시도, 동시/지연/재실행, 실제 공개 SHA, DB/원격 main 이동, Git 빌드 차단과 Preview 허용, Hook payload/인코딩/SHA/유효시간, 응답 유실과 POST 1회, 빌드 전 marker 보존을 검증한다.

실제 Production 테스트 배포는 수행하지 않는다. 활성화 후 최초 실배포는 정상 예약 시점에 실제 변경이 있는 경우에만 발생한다. 로컬 fixture 통과와 dry-run 성공을 실제 Hook Production 성공으로 표현하지 않는다.

공식 동작 근거: [Build hooks](https://docs.netlify.com/build/configure-builds/build-hooks/), [Ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/).
