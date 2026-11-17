# 홈 일정 숫자 깜빡임과 카드 떨림 수정

QA #893 (347584c)에서 일정 건수가 숫자와 — 사이를 오가고 로딩 문구가 반복되어 카드 높이가 변하는 문제.

HomeCalendar와 같은 부모의 WorkFolders가 모두 계정 ID를 key로 사용했다. 앞선 null 자식을 포함한 홈 JSX의 React 재조정에서 중복 key가 충돌하여 부모 갱신마다 달력이 재생성됐다. 달력 조회 → 건수 전달 → 부모 갱신 → 달력 재생성 → 재조회가 반복됐다.

두 key를 home-calendar:<owner>, home-folders:<owner>로 분리했다. 계정 변경 시 초기화는 유지한다. 런타임 코드는 이 두 key만 변경한다.

검증: 실제 홈 JSX를 React 19.2.3 reconciler로 실행. 부모 건수 4회 갱신 시 기존 달력 mount 5회(회귀검사 실패), 수정 후 1회(통과). 계정 변경 시 양쪽 모두 새로 mount. 관련 26개 검사와 mobile TypeScript 통과. 테스트 전용 react-test-renderer(MIT) 추가; 제품 런타임 의존성 없음.

휴대폰 수정본 검수는 미완료. 새 APK, 운영 DB, Play 변경 없음. main 병합 후 모바일 사용자 패치노트에 반영할 항목: 홈 일정 숫자 깜빡임과 반복 로딩으로 인한 화면 떨림 수정.
