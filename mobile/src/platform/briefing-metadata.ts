import type { MobileBriefing } from './worklog-api';

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Pure view model shared with executable tests; no invented freshness/total-count guarantees. */
export function briefingMetadata(briefing: MobileBriefing, now = Date.now()) {
  const warnings: string[] = [];
  const generated = briefing.generatedAt ? new Date(briefing.generatedAt) : null;
  const validGenerated = generated && Number.isFinite(generated.getTime()) && generated.getTime() <= now + 300_000;
  const today = dateKey(new Date(now));
  const stale = briefing.today !== today || !validGenerated || dateKey(generated!) !== today;
  const generatedLabel = validGenerated
    ? `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(generated!)} 생성`
    : '생성 시각 확인 불가';
  if (stale) warnings.push('오늘 기준으로 확인되지 않은 브리핑입니다. 새로고침 후 확인해주세요.');
  if (briefing.completeness === 'partial' || briefing.truncated === true) warnings.push('일부 업무만 표시 중입니다. 표시 건수가 전체 건수와 다를 수 있습니다.');
  else if (briefing.completeness !== 'complete') warnings.push('전체 조회 여부를 확인하지 못했습니다. 누락된 업무가 있을 수 있습니다.');
  if (briefing.filteredTaskCount) warnings.push(`조회된 업무 중 ${briefing.filteredTaskCount}건의 표시 정보를 확인하지 못했습니다.`);
  const source = briefing.mode === 'data_core' ? '업무 데이터(Data Core) 기준' : '데이터 출처 확인 필요';
  return {
    heading: stale ? '기준일 확인 필요' : '오늘의 브리핑', stale,
    meta: `${generatedLabel} · 기준일 ${briefing.today || '미확인'} · ${source}`,
    warnings,
  };
}
