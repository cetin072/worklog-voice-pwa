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

  function syncMicState() {
    const listening = mic.classList.contains("listening");
    const label = listening ? "종료" : "음성 기록";
    if (micText.textContent !== label) micText.textContent = label;
    mic.setAttribute("aria-label", listening ? "음성 기록 종료 후 저장" : "음성 기록 시작");
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
    const followUp = summary.querySelector(".is-followup b")?.textContent?.trim() || "0";
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