import test from "node:test";
import assert from "node:assert/strict";
import { buildCallSelectionItems } from "../public/call-selection-event.mjs";

test("선택 통화는 File 원본 없이 실제 통화일시와 길이만 전달한다", () => {
  const items = buildCallSelectionItems([{
    id: 7,
    file: { name: "secret.m4a", bytes: "never-send" },
    parsed: {
      contact: "이선영이사",
      phone: "01096655373",
      phoneDisplay: "010-9665-5373",
      recordedAt: new Date("2026-09-12T13:29:53+09:00"),
    },
    duration: 68.4,
  }]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: "call-7",
    contactName: "이선영이사",
    phone: "010-9665-5373",
    recordedAt: "2026-09-12T04:29:53.000Z",
    durationSeconds: 68.4,
  });
  assert.equal("file" in items[0], false);
});

test("통화길이를 아직 읽지 못한 경우 0으로 안전하게 전달한다", () => {
  const [item] = buildCallSelectionItems([{
    id: 1,
    parsed: {
      contact: "고객",
      recordedAt: new Date("2026-09-13T09:00:00+09:00"),
    },
    duration: null,
  }]);

  assert.equal(item.durationSeconds, 0);
  assert.equal(item.contactName, "고객");
});

test("잘못된 통화일시는 빈 값으로 정규화한다", () => {
  const [item] = buildCallSelectionItems([{
    id: 2,
    parsed: { contact: "고객", recordedAt: "not-a-date" },
    duration: 12,
  }]);

  assert.equal(item.recordedAt, "");
  assert.equal(item.durationSeconds, 12);
});
