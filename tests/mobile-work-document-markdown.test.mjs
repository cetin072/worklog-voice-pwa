import test from 'node:test';
import assert from 'node:assert/strict';
import { documentSections } from '../mobile/src/features/work/work-document-markdown.ts';

test('document headings build the outline in order and skip headings inside fenced text', () => {
  const content = '요약\r\n# 사업 계획\r\n- 공급처 확정\r\n## 가격 #\r\n본문\r\n~~~md\r\n## 목차에서 제외\r\n~~~\r\n## 가격\r\n추가 정책';
  const sections = documentSections(content);
  assert.deepEqual(sections.map(s => [s.heading, s.level]), [[undefined, undefined], ['사업 계획', 1], ['가격', 2], ['가격', 2]]);
  assert.match(sections[1].body, /- 공급처 확정/);
  assert.match(sections[2].body, /## 목차에서 제외/);
  assert.equal(sections[3].body, '추가 정책');
});
