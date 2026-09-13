import {
  buildMockCallAnalysis,
  buildMockReviewPayload,
  mockReviewStats,
  normalizeMockSelectionItem,
} from "./mock-call-review-state.mjs";

const SESSION_KEY = "worklog.mockCallReview.results.v2";
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

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "길이 확인 중";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remain = total % 60;
  if (hours) return `${hours}시간 ${minutes}분`;
  return `${minutes}분 ${String(remain).padStart(2, "0")}초`;
}

function formatRecordedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "통화시각 확인 필요";
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function scrollReviewTop(card) {
  if (typeof card?.scrollTo === "function") card.scrollTo({ top: 0, behavior: "auto" });
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
  const existing = selectionSummary.querySelector(".mock-start-button");
  if (existing) {
    startButton = existing;
    return;
  }
  if (startButton?.isConnected) return;

  startButton = createButton("무료 모의 분석 체험", "mock-start-button", startMockProcessing);
  const note = document.createElement("p");
  note.className = "mock-start-note";
  note.textContent = "실제 녹음내용은 읽지 않습니다. 선택된 통화의 연락처·통화시각·길이만 사용해 보고서/검수 화면용 예시를 만듭니다.";
  selectionSummary.append(startButton, note);
}

function ensureReviewCard() {
  if (reviewCard?.isConnected) return reviewCard;
  reviewCard = document.createElement("section");
  reviewCard.id = "mockCallReviewCard";
  reviewCard.className = "card mock-review-card";
  reviewCard.setAttribute("aria-live", "polite");
  reviewCard.setAttribute("role", "dialog");
  reviewCard.setAttribute("aria-modal", "true");
  reviewCard.setAttribute("aria-label", "통화요약 검수");
  reviewCard.tabIndex = -1;
  document.body.classList.add("mock-review-open");
  document.body.append(reviewCard);
  queueMicrotask(() => reviewCard?.focus({ preventScroll: true }));
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
  document.body.classList.remove("mock-review-open");
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
    "통화 보고서·업무항목 모의 분석 생성",
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
  scrollReviewTop(card);

  for (const item of items) {
    await delay(170);
    item.classList.add("done");
  }
  await delay(120);
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

function listTextarea(labelText, values, onChange, rows = 3) {
  const control = document.createElement("textarea");
  control.rows = rows;
  control.value = (Array.isArray(values) ? values : []).join("\n");
  control.addEventListener("input", () => {
    onChange(control.value.split("\n").map((item) => item.trim()).filter(Boolean));
  });
  return fieldLabel(labelText, control);
}

function renderSourceMeta(source) {
  const meta = document.createElement("div");
  meta.className = "mock-source-meta";
  const name = document.createElement("strong");
  name.textContent = source.contactName || "상대방";
  const phone = document.createElement("span");
  phone.textContent = source.phone || "전화번호 없음";
  const timing = document.createElement("span");
  timing.textContent = `${formatRecordedAt(source.recordedAt)} · ${formatDuration(source.durationSeconds)}`;
  meta.append(name, phone, timing);
  return meta;
}

function renderReport(result) {
  const report = result.report || (result.report = {
    headline: result.title || "",
    overview: result.summary || "",
    discussionPoints: [...(result.keyPoints || [])],
    counterpartRequests: [],
    userCommitments: [],
    decisions: [],
    openQuestions: [],
  });

  const section = document.createElement("section");
  section.className = "mock-review-section mock-report-section";
  const heading = document.createElement("h3");
  heading.textContent = "통화 보고서";
  const note = document.createElement("p");
  note.className = "mock-section-note";
  note.textContent = "실제 연결 후에는 STT 녹취를 한 번 분석해 이 보고서와 아래 업무항목을 함께 만듭니다.";
  section.append(heading, note);

  const headline = document.createElement("input");
  headline.type = "text";
  headline.maxLength = 300;
  headline.value = report.headline || "";
  headline.addEventListener("input", () => { report.headline = headline.value; });

  const overview = document.createElement("textarea");
  overview.rows = 4;
  overview.value = report.overview || "";
  overview.addEventListener("input", () => {
    report.overview = overview.value;
    result.summary = overview.value;
  });

  section.append(
    fieldLabel("한 줄 요약", headline),
    fieldLabel("통화 개요", overview),
    listTextarea("주요 논의사항 · 한 줄에 하나", report.discussionPoints, (values) => {
      report.discussionPoints = values;
      result.keyPoints = [...values];
    }, 4),
    listTextarea("상대방 요청사항", report.counterpartRequests, (values) => { report.counterpartRequests = values; }),
    listTextarea("내가 약속한 사항", report.userCommitments, (values) => { report.userCommitments = values; }),
    listTextarea("결정사항", report.decisions, (values) => { report.decisions = values; }),
    listTextarea("확인 필요사항", report.openQuestions, (values) => { report.openQuestions = values; }),
  );
  return section;
}

function renderTranscript(result) {
  const details = document.createElement("details");
  details.className = "mock-transcript";
  const summary = document.createElement("summary");
  summary.textContent = "전체 녹취록 보기";
  const warning = document.createElement("p");
  warning.className = "mock-data-warning";
  warning.textContent = "⚠ 현재는 실제 녹음에서 변환된 내용이 아닌 모의 녹취입니다.";
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

    const hint = document.createElement("p");
    hint.className = "mock-schedule-note";
    hint.textContent = "AI가 찾은 일정 후보입니다. 직접 확정한 일정만 실제 일정 저장 대상으로 사용합니다.";
    box.append(schedule, confirmLabel, hint);

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
  const subtitle = `${currentIndex + 1} / ${analyses.length}`;
  card.replaceChildren(header("📞 통화 분석 결과 검수", subtitle));

  const banner = document.createElement("div");
  banner.className = "mock-data-banner";
  banner.innerHTML = "<strong>모의 데이터</strong><span>실제 STT·AI 결과가 아닙니다. 보고서와 저장 흐름만 검수합니다.</span>";
  card.append(banner, renderSourceMeta(source));

  const title = document.createElement("input");
  title.type = "text";
  title.value = result.title;
  title.maxLength = 200;
  title.addEventListener("input", () => { result.title = title.value; });

  card.append(
    fieldLabel("업무 제목", title),
    renderReport(result),
    renderTranscript(result),
  );

  const actionSection = document.createElement("section");
  actionSection.className = "mock-review-section";
  const actionHeading = document.createElement("h3");
  actionHeading.textContent = "업무로 옮길 항목";
  const actionNote = document.createElement("p");
  actionNote.className = "mock-section-note";
  actionNote.textContent = "보고서는 기록용 결과이고, 아래 항목만 할 일·일정·후속조치로 별도 저장할 수 있습니다.";
  actionSection.append(actionHeading, actionNote);
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
  scrollReviewTop(card);
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
  title.textContent = "✅ 통화 보고서와 검수 결과를 모의 저장했습니다.";
  const detail = document.createElement("p");
  detail.textContent = `할 일 ${stats.tasks}건 · 일정 후보 ${stats.schedules}건(확정 ${stats.confirmedSchedules}건) · 후속조치 ${stats.followUps}건 · 결정사항 ${stats.decisions}건`;
  const safety = document.createElement("p");
  safety.textContent = "실제 DB·STT·AI에는 전송하지 않았습니다.";
  success.append(title, detail, safety);
  if (stats.schedules > stats.confirmedSchedules) {
    const warning = document.createElement("p");
    warning.className = "mock-save-warning";
    warning.textContent = `미확정 일정 ${stats.schedules - stats.confirmedSchedules}건은 실제 일정 저장 대상이 아닙니다.`;
    success.append(warning);
  }
  card.append(success);

  const nextLabel = currentIndex + 1 < analyses.length ? "다음 통화 검수" : "전체 완료 보기";
  card.append(createButton(nextLabel, "mock-primary mock-next", () => {
    currentIndex += 1;
    renderCurrentReview();
  }));
  scrollReviewTop(card);
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
  strong.textContent = "통화 보고서 → 업무항목 검수 흐름이 끝났습니다.";
  const text = document.createElement("p");
  text.textContent = "실제 서버·STT·AI·Supabase·Notion에는 아무것도 전송하거나 저장하지 않았습니다.";
  done.append(strong, text);
  card.append(done, createButton("통화 목록으로 돌아가기", "mock-primary mock-next", closeReview));
  scrollReviewTop(card);
}

window.addEventListener("worklog:call-selection-ready", (event) => {
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  selection = items.map(normalizeMockSelectionItem);
  if (!startButton?.isConnected) startButton = null;
  ensureStartButton();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && reviewCard?.isConnected) closeReview();
});
