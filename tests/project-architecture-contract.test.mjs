import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

test("제품 헌장은 업무수첩을 개인 업무 통합 앱으로 정의한다", () => {
  const charter = read("../PROJECT_CHARTER.md");
  assert.match(charter, /개인 업무 통합 앱/);
  assert.match(charter, /각 기능은 단독으로도 쓸 수 있어야 한다/);
  assert.match(charter, /업무수첩은 독립 도구를 연결하는 허브/);
  assert.match(charter, /Notion/);
  assert.match(charter, /Adapter/);
});

test("모듈 아키텍처는 독립 결과와 선택적 연결을 분리한다", () => {
  const architecture = read("../docs/MODULE_ARCHITECTURE_V1.md");
  assert.match(architecture, /Standalone-first/);
  assert.match(architecture, /Result Model/);
  assert.match(architecture, /Optional Connections/);
  assert.match(architecture, /결과와 연결을 분리한다/);
  assert.match(architecture, /대규모 재작성하지 않는다/);
  assert.match(architecture, /통화녹음 선택 → STT → 전체 녹취 → 통화 보고서/);
  assert.match(architecture, /카메라\/갤러리 → 페이지 보정 → 여러 장 관리 → PDF/);
});

test("AGENTS는 제품 헌장과 모듈 아키텍처를 일상 개발 규칙으로 연결한다", () => {
  const agents = read("../AGENTS.md");
  assert.match(agents, /PROJECT_CHARTER\.md/);
  assert.match(agents, /docs\/MODULE_ARCHITECTURE_V1\.md/);
  assert.match(agents, /각 기능은 단독으로도 쓸 수 있는 수준으로 완성/);
  assert.match(agents, /기존 정상 기능은 모듈화를 이유로 대규모 재작성하지 않고/);
  assert.match(agents, /Notion: 현재 사람이 읽는 실제 업무기록의 기본 원장/);
});
