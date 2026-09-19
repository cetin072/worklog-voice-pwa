import type { SttBenchmarkEntity } from './stt-benchmark';

export type SttBenchmarkFixture = Readonly<{
  id: string;
  label: string;
  prompt: string;
  expectedEntities: readonly SttBenchmarkEntity[];
}>;

export const QUICK_VOICE_KOREAN_BENCHMARKS: readonly SttBenchmarkFixture[] = Object.freeze([
  Object.freeze({
    id: 'ko-10s-entities',
    label: '한국어 10초 · 날짜/시간/이름/금액',
    prompt: '9월 22일 오후 2시 30분 부산시청에서 김정원 과장 만나기. 보험료 350만원 입금 여부 확인.',
    expectedEntities: Object.freeze([
      { label: 'date', expected: '9월 22일' },
      { label: 'time', expected: '오후 2시 30분' },
      { label: 'institution', expected: '부산시청' },
      { label: 'person', expected: '김정원 과장' },
      { label: 'amount', expected: '350만원' },
    ]),
  }),
  Object.freeze({
    id: 'ko-30s-workflow',
    label: '한국어 30초 · 기관/기한/회의/금액',
    prompt: '미래여성가족진흥원 자료를 다음 주 금요일 오후 4시까지 정리하고 이선영 팀장에게 전달하기. 태장 홈페이지 개발회의는 9월 25일 오전 10시에 진행하고, 계약 관련 비용 1,250만원과 고객 상담 일정도 같이 확인하기.',
    expectedEntities: Object.freeze([
      { label: 'institution', expected: '미래여성가족진흥원' },
      { label: 'deadline', expected: '다음 주 금요일 오후 4시' },
      { label: 'person', expected: '이선영 팀장' },
      { label: 'project', expected: '태장 홈페이지' },
      { label: 'date', expected: '9월 25일' },
      { label: 'time', expected: '오전 10시' },
      { label: 'amount', expected: '1,250만원' },
    ]),
  }),
]);
