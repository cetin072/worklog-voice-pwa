import {
  buildMockCallAnalysis,
  buildMockReviewPayload,
  mockReviewStats,
  normalizeMockSelectionItem,
} from "./mock-call-review-state.mjs";

const SESSION_KEY = "worklog.mockCallReview.results.v1";
const callCard = document.getElementById("callInboxCard");
const selectionSummary = document.getElementById("callSelectionSummary");

let selection = [];
let analyses = [];
let currentIndex = 0;
let reviewCard = null;
let startButton = null;
let processing = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveMockPayload(payload) {
  try {
    const previous = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]");
    const list = Array.isArray(previous) ? previous : [];
    list.push(payload);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // 모의 저장은 UX 확인용이므로 sessionStorage 실패가 검수를 막지 않는다.
  }
}

function createButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function ensureStartButton() {
  if (!selectionSummary || selectionSummary.hidden || !selection.length) return;
  if (startButton?.isConnected) return;

  startButton = createButton("무료 모의 분석 체험", "mock-start-button", startMockProcessing);
  const note = document.createElement("p");
  note.className = "mock-start-note";
  note.textContent = "실제 녹음내용은 읽지 않습니다. 연락처·시간 메타데이터만 사용해 검수 화면용 예시를 만듭니다.";
  selectionSummary.append(startButton, note);
}

function ensureReviewCard() {
  if (reviewCard?.isConnected) return reviewCard;
  reviewCard = document.createElement("section");
  reviewCard.id = "mockCallReviewCard";
  reviewCard.className = "card mock-review-card";
  reviewCard.setAttribute("aria-live", "polite");
  callCard?.insertAdjacentElement("afterend", reviewCard);
  return reviewCard;
}

function header(title, subtitle = "") {
  const wrap = document.createElement("div");
  wrap.className = "mock-review-head";
  const text = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "무료 모의 처리 · 외부 전송 0건";
  const heading = document.createElement("h2");
  heading.textContent = title;
  text.append(eyebrow, heading);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "mock-review-subtitle";
    sub.textContent = subtitle;
    text.append(sub);
  }
  const close = createButton("닫기", "mock-close", closeReview);
  wrap.append(text, close);
  return wrap;
}

function closeReview() {
  reviewCard?.remove();
  reviewCard = null;
  processing = false;
}

async function startMockProcessing() {
  if (processing || !selection.length) return;
  processing = true;
  analyses = selection.map((item, index) => buildMockCallAnalysis(item, index));
  currentIndex = 0;
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}

  const card = ensureReviewCard();
  card.replaceChildren(header("통화 분석 준비 중", `${selection.length}건 · 모의 데이터`));
  const steps = document.createElement("ol");
  steps.className = "mock-processing-steps";
  const labels = [
    "선택 통화 메타데이터 확인",
    "STT 모의 결과 생성",
    "AI 모의 분석 결과 생성",
    "검수 화면 준비",
  ];
  const items = labels.map((label) => {
    const item = document.createElement("li");
    item.textContent = label;
    steps.append(item);
    return item;
  });
  const lock = document.createElement("p");
  lock.className = "mock-lock-note";
  lock.textContent = "🔒 실제 녹음 업로드·STT·AI 호출은 실행하지 않습니다.";
  card.append(steps, lock);
  card.scrollIntoView({ behavior: "smooth", block: "start" });

  for (const item of items) {
    await delay(260);
    item.classList.add("done");
  }
  await delay(180);
  processing = false;
  renderCurrentReview();
}

function fieldLabel(labelText, control) {
  const label = document.createElement("label");
  label.className = "mock-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function renderTranscript(result) {
  const details = document.createElement("details");
  details.className = "mock-transcript";
  const summary = document.createElement("summary");
  summary.textContent = "모의 녹취록 보기";
  const warning = document.createElement("p");
  warning.className = "mock-data-warning";
  warning.textContent = "⚠ 실제 녹음에서 변환된 내용이 아닙니다.";
  const text = document.createElement("pre");
  text.textContent = result.transcript;
  details.append(summary, warning, text);
  return details;
}

function renderAction(result, action) {
  const box = document.createElement("div");
  box.className = `mock-action mock-action-${action.type}`;

  const top = document.createElement("div");
  top.className = "mock-action-top";
  const includeLabel = document.createElement("label");
  includeLabel.className = "mock-include";
  const include = document.createElement("input");
  include.type = "checkbox";
  include.checked = action.included !== false;
  const title = document.createElement("strong");
  title.textContent = action.label || action.type;
  includeLabel.append(include, title);
  top.append(includeLabel);
  box.append(top);

  const content = document.createElement("textarea");
  content.rows = 2;
  content.value = action.content || "";
  content.disabled = !include.checked;
  content.addEventListener("input", () => { action.content = content.value; });
  box.append(content);

  if (action.type === "schedule") {
    const schedule = document.createElement("div");
    schedule.className = "mock-schedule-grid";
    const date = document.createElement("input");
    date.type = "date";
    date.value = action.dueDate || "";
    const time = document.createElement("input");
    time.type = "time";
    time.value = action.dueTime || "";
    schedule.append(fieldLabel("날짜", date), fieldLabel("시간", time));

    const confirmLabel = document.createElement("label");
    confirmLabel.className = "mock-schedule-confirm";
    const confirm = document.createElement("input");
    confirm.type = "checkbox";
    confirm.checked = Boolean(action.confirmed);
    const confirmText = document.createElement("span");
    confirmText.textContent = "이 일정을 저장 대상으로 확정";
    confirmLabel.append(confirm, confirmText);
    box.append(schedule, confirmLabel);

    date.addEventListener("change", () => { action.dueDate = date.value; });
    time.addEventListener("change", () => { action.dueTime = time.value; });
    confirm.addEventListener("change", () => { action.confirmed = confirm.checked; });

    include.addEventListener("change", () => {
      action.included = include.checked;
      content.disabled = !include.checked;
      date.disabled = !include.checked;
      time.disabled = !include.checked;
      confirm.disabled = !include.checked;
    });
  } else {
    include.addEventListener("change", () => {
      action.included = include.checked;
      content.disabled = !include.checked;
    });
  }

  return box;
}

function renderContact(contact) {
  const box = document.createElement("div");
  box.className = "mock-contact";
  const label = document.createElement("label");
  const include = document.createElement("input");
  include.type = "checkbox";
  include.checked = Boolean(contact.included);
  const text = document.createElement("span");
  text.textContent = `${contact.name || "이름 없음"}${contact.phone ? ` · ${contact.phone}` : ""}`;
  label.append(include, text);

  const confirmLabel = document.createElement("label");
  confirmLabel.className = "mock-contact-confirm";
  const confirm = document.createElement("input");
  confirm.type = "checkbox";
  confirm.checked = Boolean(contact.confirmed);
  confirm.disabled = !include.checked;
  const confirmText = document.createElement("span");
  confirmText.textContent = "연락처 연결 후보 확인";
  confirmLabel.append(confirm, confirmText);
  box.append(label, confirmLabel);

  include.addEventListener("change", () => {
    contact.included = include.checked;
    confirm.disabled = !include.checked;
  });
  confirm.addEventListener("change", () => { contact.confirmed = confirm.checked; });
  return box;
}

function renderCurrentReview() {
  const result = analyses[currentIndex];
  if (!result) return renderFinished();
  const card = ensureReviewCard();
  const source = result.source;
  const subtitle = `${currentIndex + 1} / ${analyses.length} · ${source.contactName}${source.phone ? ` · ${source.phone}` : ""}`;
  card.replaceChildren(header("📞 통화요약 검수", subtitle));

  const banner = document.createElement("div");
  banner.className = "mock-data-banner";
  banner.innerHTML = "<strong>모의 데이터</strong><span>실제 STT·AI 결과가 아닙니다. 화면과 저장 흐름만 검수합니다.</span>";
  card.append(banner);

  const title = document.createElement("input");
  title.type = "text";
  title.value = result.title;
  title.maxLength = 200;
  title.addEventListener("input", () => { result.title = title.value; });

  const summary = document.createElement("textarea");
  summary.rows = 4;
  summary.value = result.summary;
  summary.addEventListener("input", () => { result.summary = summary.value; });

  const keyPoints = document.createElement("textarea");
  keyPoints.rows = 4;
  keyPoints.value = result.keyPoints.join("\n");
  keyPoints.addEventListener("input", () => {
    result.keyPoints = keyPoints.value.split("\n").map((item) => item.trim()).filter(Boolean);
  });

  card.append(
    fieldLabel("업무 제목", title),
    fieldLabel("통화 요약", summary),
    fieldLabel("핵심 내용 · 한 줄에 하나", keyPoints),
    renderTranscript(result),
  );

  const actionSection = document.createElement("section");
  actionSection.className = "mock-review-section";
  const actionHeading = document.createElement("h3");
  actionHeading.textContent = "해야 할 일 · 일정 · 후속조치";
  actionSection.append(actionHeading);
  result.actions.forEach((action) => actionSection.append(renderAction(result, action)));
  card.append(actionSection);

  const contactSection = document.createElement("section");
  contactSection.className = "mock-review-section";
  const contactHeading = document.createElement("h3");
  contactHeading.textContent = "연락처 연결 후보";
  contactSection.append(contactHeading);
  result.contacts.forEach((contact) => contactSection.append(renderContact(contact)));
  card.append(contactSection);

  const foot = document.createElement("div");
  foot.className = "mock-review-actions";
  const skip = createButton("이 통화 제외", "mock-secondary", () => {
    currentIndex += 1;
    renderCurrentReview();
  });
  const save = createButton("검수 완료 · 모의 저장", "mock-primary", () => saveCurrent(result));
  foot.append(skip, save);
  card.append(foot);
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveCurrent(result) {
  const payload = buildMockReviewPayload(result);
  saveMockPayload(payload);
  const stats = mockReviewStats(payload);
  const card = ensureReviewCard();
  card.replaceChildren(header("모의 저장 완료", `${currentIndex + 1} / ${analyses.length}`));
  const success = document.createElement("div");
  success.className = "mock-save-success";
  const title = document.createElement("strong");
  title.textContent = "✅ 실제 DB에는 저장하지 않았습니다.";
  const detail = document.createElement("p");
  detail.textContent = `할 일 ${stats.tasks}건 · 일정 ${stats.schedules}건(확정 ${stats.confirmedSchedules}건) · 후속조치 ${stats.followUps}건 · 결정사항 ${stats.decisions}건`;
  success.append(title, detail);
  card.append(success);

  const nextLabel = currentIndex + 1 < analyses.length ? "다음 통화 검수" : "전체 완료 보기";
  card.append(createButton(nextLabel, "mock-primary", () => {
    currentIndex += 1;
    renderCurrentReview();
  }));
}

function renderFinished() {
  const card = ensureReviewCard();
  let savedCount = 0;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "[]");
    savedCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {}
  card.replaceChildren(header("모의 통화 검수 완료", `${savedCount}건 모의 저장`));
  const done = document.createElement("div");
  done.className = "mock-finished";
  const strong = document.createElement("strong");
  strong.textContent = "전체 흐름 검수가 끝났습니다.";
  const text = document.createElement("p");
  text.textContent = "실제 서버·STT·AI·Supabase·Notion에는 아무것도 전송하거나 저장하지 않았습니다.";
  done.append(strong, text);
  card.append(done, createButton("통화 목록으로 돌아가기", "mock-primary", closeReview));
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

window.addEventListener("worklog:call-selection-ready", (event) => {
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  selection = items.map(normalizeMockSelectionItem);
  startButton = null;
  ensureStartButton();
});
