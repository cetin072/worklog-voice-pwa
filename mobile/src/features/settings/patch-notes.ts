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
    date: '2026-09-22',
    title: 'Quick Voice 안정화·플로팅 UI·업무 삭제',
    summary: '빠르게 말하고 저장하는 흐름을 실기기 기준으로 안정화하고 브리핑 관리를 더 단순하게 만들었습니다.',
    items: [
      'Android 기본 음성 인식을 Quick Voice의 빠른 입력 경로로 적용하고 Whisper는 장애 시 대체 경로로 유지했습니다.',
      '뜸을 두고 말하기, 마지막 문장 보존, 무음 종료, 저장 후 즉시 다음 녹음 같은 실사용 흐름을 안정화했습니다.',
      'Quick Voice를 웹 버전처럼 하단 플로팅 형태로 줄여 홈 업무 내용을 더 넓게 볼 수 있게 했습니다.',
      '녹음 중 안내문과 실시간 인식 문장이 겹치지 않도록 한 줄 상태 표시로 정리했습니다.',
      '잘못 들어간 업무·메모는 완료 처리하지 않고 브리핑에서 삭제할 수 있게 했습니다.',
    ],
  },
  {
    date: '2026-09-20',
    title: '업무일지·재알림·일정 안전성',
    summary: '업무 기록이 업무일지와 알림으로 이어지는 흐름의 정확성과 복구성을 보강했습니다.',
    items: [
      '완료·진행 업무를 날짜별 업무일지에서 확인할 수 있는 자동 업무일지 기반을 정리했습니다.',
      '업무 다시 알림과 미루기 흐름을 추가하고 취소된 일정의 휴대폰 알림 정합성을 보강했습니다.',
      '메모와 할 일을 구분하고 필요할 때 서로 전환할 수 있는 업무 분류 흐름을 추가했습니다.',
    ],
  },
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
