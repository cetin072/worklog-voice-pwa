# 홈·회의 녹음 바로가기 통합 QA — 2026-11-09

설치본 제작 요청에 따라 새 QA 체크포인트를 만든다.

- main: `3e8e301740aa94954508dd255faf263e70e401e9` — 주간/월간 홈, 설정 정리, 마이크 위 회의 녹음 바로가기 포함.
- 이전 통합 QA #525: `ca6cfe51cae8fc7e612c85ae022a20d5805aadcd` — 검수된 초안 복구·계정 격리·알림 정리 등 QA 변경을 보존.
- 두 소스를 QA 브랜치에서 병합하며 #525를 main에 병합하지 않는다. 운영 DB·Production·Play 변경 및 기존 데이터 삭제 없음.
- 기존 `Mobile App` 수동 빌드, `build_android=true`, 이 QA PR의 Netlify Deploy Preview를 API origin으로 사용한다.
- 기존 QA 패키지 `com.cetin072.worklog.qa`와 서명 경로를 유지한다. 생성 후 package/version/code/certificate/SHA256 및 Runtime Smoke를 확인한다.
- QA Preview와 Production은 같은 Supabase 프로젝트이므로 실제 사용자 기록에 테스트 쓰기를 하지 않는다. 포함된 migration 파일을 실행하지 않는다. 로그인 후 실사용 저장·조회, Android 권한·실제 알림은 별도의 사용자 검수다.
- 통합 로컬 검사: TypeScript 통과, 전체 Node 1,213개·모바일/네이티브 578개 통과(집합 중복 포함). 설치본 검수와 시간 절감 실측을 의미하지 않는다.
