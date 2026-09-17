(() => {
  const $ = (id) => document.getElementById(id);
  const mic = $("mic");
  const micText = $("micText");
  const briefingCard = $("briefingCard");
  const briefingOpen = $("homeBriefingOpen");
  const overdueCount = $("homeBriefingOverdueCount");
  const todayCount = $("homeBriefingTodayCount");
  const upcomingCount = $("homeBriefingUpcomingCount");
  const undatedCount = $("homeBriefingUndatedCount");
  const status = $("homeBriefingStatus");
  const entryCard = $("entryCard");

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

  function setEntryOpen(open) {
    if (entryCard) entryCard.hidden = !open;
    $("voiceDockManual")?.setAttribute("aria-expanded", String(open));
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
    manual.setAttribute("aria-controls", "entryCard");
    manual.setAttribute("aria-expanded", String(Boolean(entryCard && !entryCard.hidden)));

    voiceCard.insertBefore(dock, mic);
    dock.append(timer, cancel, mic, manual);

    cancel.addEventListener("click", () => {
      $("clear")?.click();
      setEntryOpen(false);
    });

    manual.addEventListener("click", () => {
      setEntryOpen(true);
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

  function summaryCount(summary, selector) {
    const value = summary.querySelector(`${selector} b`)?.textContent?.trim() || "0";
    return `${Number(value || 0)}건`;
  }

  function renderSummaryFromV2() {
    const root = $("briefingV2");
    const summary = root?.querySelector(".briefing-v2-summary");
    if (!root || root.hidden || !summary) return false;

    if (overdueCount) overdueCount.textContent = summaryCount(summary, ".is-overdue");
    if (todayCount) todayCount.textContent = summaryCount(summary, ".is-today");
    if (upcomingCount) upcomingCount.textContent = summaryCount(summary, ".is-upcoming");
    if (undatedCount) undatedCount.textContent = summaryCount(summary, ".is-undated");
    if (status) {
      const meta = $("briefingMeta")?.textContent?.trim() || "";
      status.textContent = meta || "오늘 업무 브리핑을 최신 상태로 정리했습니다.";
      status.classList.add("is-ready");
    }
    return true;
  }

  function renderSummaryFallback() {
    [overdueCount, todayCount, upcomingCount, undatedCount].forEach((node) => {
      if (node) node.textContent = "—";
    });
    if (status) {
      status.textContent = $("briefingMeta")?.textContent?.trim() || "전체 브리핑에서 세부 내용을 확인할 수 있습니다.";
      status.classList.remove("is-ready");
    }
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

  window.addEventListener("worklog:record-saved", () => {
    window.setTimeout(() => {
      syncBriefingSummary();
      if (!$("text")?.value?.trim()) setEntryOpen(false);
    }, 250);
  });
  window.addEventListener("worklog:briefing-reset", () => {
    if (status) {
      status.textContent = "브리핑을 최신 상태로 다시 불러오는 중입니다.";
      status.classList.remove("is-ready");
    }
  });

  setFullBriefingOpen(false);
  setEntryOpen(Boolean($("text")?.value?.trim()));
  syncMicState();
  syncBriefingSummary();
})();
