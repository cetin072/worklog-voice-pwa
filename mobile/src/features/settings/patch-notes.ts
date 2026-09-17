export type PatchNoteEntry = {
  date: string;
  title: string;
  summary: string;
  items: string[];
};

// Mobile uses the same user-facing release-note facts as the web patch notes.
// Keep only changes that are already merged to main. Development-only notes live in .patch-notes/.
export const MOBILE_PATCH_NOTES: PatchNoteEntry[] = [
  {
    date: '2026-09-16',
    title: '홈·브리핑·검색·알림·편집',
    summary: '업무수첩 핵심 사용 흐름과 검색·알림·일정 연결을 정리했습니다.',
    items: [
      '오늘의 브리핑을 홈에서 먼저 확인하고 음성 기록으로 바로 진입할 수 있게 정리했습니다.',
      '지난 것 / 오늘 할 일 / 다가오는 업무 / 기한 없는 업무의 4구간으로 브리핑을 통일했습니다.',
      '로그인 사용자가 지난 업무를 키워드로 검색할 수 있는 통합 검색 기반을 추가했습니다.',
      '날짜와 시간이 분명한 미팅·약속·방문·통화는 업무 기록과 함께 일정으로 연결되도록 했습니다.',
      '아침·오후 업무 알림과 알림 테스트·문제 해결 흐름을 추가했습니다.',
    ],
  },
  {
    date: '2026-09-15',
    title: '로그인·설정·Data Core',
    summary: 'Google 로그인과 독립 설정 화면, Data Core 기반을 보강했습니다.',
    items: [
      'Google 로그인을 기본 시작 방법으로 추가하고 이메일 로그인도 유지했습니다.',
      '독립 설정 페이지와 앱 설치 메뉴를 추가했습니다.',
      '업무수첩의 구조화 데이터 기반을 Supabase Data Core 중심으로 전환할 수 있는 준비를 완료했습니다.',
    ],
  },
  {
    date: '2026-09-14',
    title: 'Platform V1 기반',
    summary: '개인 업무공간·업무·일정의 공통 데이터 기반을 구축했습니다.',
    items: [
      'Workspace, 업무기록, 일정, 원본 참조와 사용자별 RLS 격리 구조를 구축했습니다.',
      'Personal Workspace 자동 생성과 Data Core 저장 경로를 추가했습니다.',
      'Briefing V2가 Data Core 업무·일정을 읽고 상태 변경을 처리할 수 있게 했습니다.',
    ],
  },
];
