(() => {
  const $ = (id) => document.getElementById(id);
  const mic = $("mic");
  const micText = $("micText");
  const briefingCard = $("briefingCard");
  const briefingOpen = $("homeBriefingOpen");
  const todayCount = $("homeBriefingTodayCount");
  const overdueCount = $("homeBriefingOverdueCount");
  const followUpCount = $("homeBriefingFollowUpCount");
  const nextSchedule = $("homeBriefingNextSchedule");
  const status = $("homeBriefingStatus");

  if (!mic || !micText || !briefingCard || !briefingOpen) return;

  let recordingStartedAt = 0;
  let recordingTimer = null;

  function createQuickButton(id, className, icon, visualLabel, ariaLabel) {
    const button = document.createElement("button");
    button.id = id;
    button.className = `voice-quick-action ${className}`;
    button.type = "button";
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;

    const iconNode = document.createElement("span");
    iconNode.className = "voice-quick-icon";
    iconNode.setAttribute("aria-hidden", "true");
    iconNode.textContent = icon;

    const labelNode = document.createElement("span");
    labelNode.className = "voice-quick-label";
    labelNode.setAttribute("aria-hidden", "true");
    labelNode.textContent = visualLabel;

    button.append(iconNode, labelNode);
    return button;
  }

  function ensureVoiceQuickDock() {
    const existing = $("voiceQuickDock");
    if (existing) {
      return {
        dock: existing,
        timer: $("voiceDockTimer"),
        timerText: $("voiceDockTimerText"),
        cancel: $("voiceDockCancel"),
        manual: $("voiceDockManual"),
      };
    }

    const voiceCard = mic.closest(".voice-card");
    if (!voiceCard) return {};

    const dock = document.createElement("div");
    dock.id = "voiceQuickDock";
    dock.className = "voice-quick-dock";
    dock.setAttribute("aria-label", "음성 빠른 조작");

    const timer = document.createElement("div");
    timer.id = "voiceDockTimer";
    timer.className = "voice-dock-timer";
    timer.setAttribute("role", "timer");
    timer.setAttribute("aria-live", "polite");
    timer.setAttribute("aria-label", "녹음 시간 00분 00초");
    timer.hidden = true;

    const timerText = document.createElement("span");
    timerText.id = "voiceDockTimerText";
    timerText.textContent = "00:00";
    timer.append(timerText);

    const cancel = createQuickButton("voiceDockCancel", "is-cancel", "✕", "취소", "현재 입력 취소 및 지우기");
    const manual = createQuickButton("voiceDockManual", "is-manual", "✏️", "메모", "메모 직접 입력으로 이동");

    voiceCard.insertBefore(dock, mic);
    dock.append(timer, cancel, mic, manual);

    cancel.addEventListener("click", () => {
      $("clear")?.click();
    });

    manual.addEventListener("click", () => {
      $("manualEntry")?.click();
    });

    return { dock, timer, timerText, cancel, manual };
  }

  const quickDock = ensureVoiceQuickDock();

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function updateRecordingTimer() {
    if (!recordingStartedAt || !quickDock.timerText || !quickDock.timer) return;
    const elapsed = Date.now() - recordingStartedAt;
    const display = formatElapsed(elapsed);
    quickDock.timerText.textContent = display;
    const [minutes, seconds] = display.split(":");
    quickDock.timer.setAttribute("aria-label", `녹음 시간 ${Number(minutes)}분 ${Number(seconds)}초`);
  }

  function startRecordingTimer() {
    if (!quickDock.timer || !quickDock.timerText) return;
    if (!recordingStartedAt) recordingStartedAt = Date.now();
    quickDock.timer.hidden = false;
    updateRecordingTimer();
    if (!recordingTimer) recordingTimer = window.setInterval(updateRecordingTimer, 250);
  }

  function stopRecordingTimer() {
    if (recordingTimer) {
      window.clearInterval(recordingTimer);
      recordingTimer = null;
    }
    recordingStartedAt = 0;
    if (quickDock.timerText) quickDock.timerText.textContent = "00:00";
    if (quickDock.timer) {
      quickDock.timer.hidden = true;
      quickDock.timer.setAttribute("aria-label", "녹음 시간 00분 00초");
    }
  }

  function syncMicState() {
    const listening = mic.classList.contains("listening");
    const label = listening ? "종료" : "음성 기록";
    if (micText.textContent !== label) micText.textContent = label;
    mic.setAttribute("aria-label", listening ? "음성 기록 종료 후 저장" : "음성 기록 시작");
    quickDock.dock?.classList.toggle("is-recording", listening);
    quickDock.cancel?.classList.toggle("is-recording", listening);
    if (listening) startRecordingTimer();
    else stopRecordingTimer();
  }

  function actualItems(list) {
    if (!list) return [];
    return [...list.querySelectorAll(":scope > li")].filter((item) => !item.classList.contains("briefing-empty"));
  }

  function todayMmDd() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    }).formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${Number(get("month"))}/${Number(get("day"))}`;
  }

  function compactScheduleWhen(value) {
    const raw = String(value || "").trim();
    if (!raw) return "—";
    const [day, time] = raw.split(/\s+/, 2);
    if (day === todayMmDd() && time && time !== "종일") return time;
    if (day === todayMmDd() && time === "종일") return "종일";
    return raw;
  }

  function renderSummaryFromV2() {
    const root = $("briefingV2");
    const summary = root?.querySelector(".briefing-v2-summary");
    if (!root || root.hidden || !summary) return false;

    const overdue = summary.querySelector(".is-overdue b")?.textContent?.trim() || "0";
    const followUp = root.dataset.followUpCount || "0";
    const scheduleSection = root.querySelector(".briefing-v2-schedules");
    const scheduleLists = scheduleSection ? [...scheduleSection.querySelectorAll("ul.briefing-v2-list")] : [];
    const todayItems = actualItems(scheduleLists[0]);
    const upcomingItems = actualItems(scheduleLists[1]);
    const firstSchedule = todayItems[0] || upcomingItems[0] || null;
    const firstWhen = firstSchedule?.querySelector(".briefing-date")?.textContent || "";

    if (todayCount) todayCount.textContent = `${todayItems.length}건`;
    if (overdueCount) overdueCount.textContent = `${Number(overdue || 0)}건`;
    if (followUpCount) followUpCount.textContent = `${Number(followUp || 0)}건`;
    if (nextSchedule) nextSchedule.textContent = compactScheduleWhen(firstWhen);
    if (status) {
      const meta = $("briefingMeta")?.textContent?.trim() || "";
      status.textContent = meta || "오늘 업무 브리핑을 최신 상태로 정리했습니다.";
      status.classList.add("is-ready");
    }
    return true;
  }

  function renderSummaryFallback() {
    const todayItems = actualItems($("briefingToday"));
    const upcomingItems = actualItems($("briefingUpcoming"));
    const firstSchedule = todayItems[0] || upcomingItems[0] || null;
    const firstWhen = firstSchedule?.querySelector(".briefing-date")?.textContent || "";
    if (todayCount) todayCount.textContent = `${todayItems.length}건`;
    if (nextSchedule) nextSchedule.textContent = compactScheduleWhen(firstWhen);
    if (status) status.textContent = $("briefingMeta")?.textContent?.trim() || "전체 브리핑에서 세부 내용을 확인할 수 있습니다.";
  }

  function syncBriefingSummary() {
    if (!renderSummaryFromV2()) renderSummaryFallback();
  }

  function setFullBriefingOpen(open) {
    briefingCard.hidden = !open;
    briefingOpen.setAttribute("aria-expanded", String(open));
    briefingOpen.textContent = open ? "간단히 보기" : "전체 보기";
    if (open) {
      briefingCard.classList.remove("is-collapsed");
      const legacyToggle = $("briefingCardToggle");
      legacyToggle?.setAttribute("aria-expanded", "true");
      if (legacyToggle) legacyToggle.textContent = "접기";
      window.requestAnimationFrame(() => briefingCard.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  briefingOpen.addEventListener("click", () => setFullBriefingOpen(briefingCard.hidden));

  const micObserver = new MutationObserver(syncMicState);
  micObserver.observe(mic, { attributes: true, attributeFilter: ["class"] });
  micObserver.observe(micText, { childList: true, characterData: true, subtree: true });

  const briefingObserver = new MutationObserver(syncBriefingSummary);
  briefingObserver.observe(briefingCard, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  window.addEventListener("worklog:record-saved", () => window.setTimeout(syncBriefingSummary, 250));
  window.addEventListener("worklog:briefing-reset", () => {
    if (status) {
      status.textContent = "브리핑을 최신 상태로 다시 불러오는 중입니다.";
      status.classList.remove("is-ready");
    }
  });

  setFullBriefingOpen(false);
  syncMicState();
  syncBriefingSummary();
})();