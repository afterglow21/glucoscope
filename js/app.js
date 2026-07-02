const NIGHTSCOUT_URL = "https://kazuma-nightscoutweb.azurewebsites.net";

let glucoseChart = null;

const directionMap = {
  DoubleUp: "⇈",
  SingleUp: "↑",
  FortyFiveUp: "↗",
  Flat: "→",
  FortyFiveDown: "↘",
  SingleDown: "↓",
  DoubleDown: "⇊",
  "NOT COMPUTABLE": "?",
  "RATE OUT OF RANGE": "?"
};


function setLiveStatus(statusType, label, detail = "") {
  const liveIndicator = document.getElementById("liveIndicator");
  const liveLabel = document.getElementById("liveLabel");

  if (!liveIndicator || !liveLabel) return;

  liveIndicator.classList.remove("live-online", "live-stale", "live-error", "live-pending");
  liveIndicator.classList.add(`live-${statusType}`);
  liveLabel.textContent = label;
  liveIndicator.title = detail || label;
}

function updateRangeStatus(glucose) {
  const rangeStatus = document.getElementById("rangeStatus");
  if (!rangeStatus) return;

  rangeStatus.classList.remove("in-range", "above-range", "below-range");

  if (glucose < 70) {
    rangeStatus.classList.add("below-range");
    rangeStatus.textContent = "● Low";
    return;
  }

  if (glucose > 180) {
    rangeStatus.classList.add("above-range");
    rangeStatus.textContent = "● High";
    return;
  }

  rangeStatus.classList.add("in-range");
  rangeStatus.textContent = "● In Range";
}

function formatRelativeUpdate(date) {
  if (!date || Number.isNaN(date.getTime())) return "--";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.max(0, Math.round(diffMs / 1000));
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;

  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function updateHeaderUpdated(measuredAt) {
  const headerUpdated = document.getElementById("headerUpdated");
  if (!headerUpdated) return;
  headerUpdated.textContent = formatRelativeUpdate(measuredAt);
}

function formatDateTime(date) {
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function makeComment(tir, tar, tbr, avg, cv) {
  if (Number(tir) >= 90 && Number(tbr) < 4 && Number(cv) < 30) {
    return `今日はかなり安定しています。\n\nTIRは${tir}%、平均血糖は${avg}mg/dLです。\n血糖のばらつきも少なく、とても良い流れです😊`;
  }

  if (Number(tbr) >= 4) {
    return `今日は低血糖時間が少し気になります。\n\nTBRは${tbr}%でした。\n夜間や食前の下がり方をあとで見返すと良さそうです。`;
  }

  if (Number(tar) >= 20) {
    return `今日は高血糖時間がやや多めです。\n\nTARは${tar}%でした。\n食後の上がり方を中心に見るとヒントがありそうです。`;
  }

  if (Number(cv) >= 36) {
    return `今日は血糖の上下が少し大きめです。\n\nCVは${cv}%でした。\n乱高下のタイミングをあとで確認してみましょう。`;
  }

  return `今日はまずまず安定しています。\n\nTIRは${tir}%です。\nこのまま落ち着いた流れを保てると良さそうです。`;
}

function drawGlucoseChart(entries) {
  const canvas = document.getElementById("glucoseChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  const sortedEntries = [...entries]
    .filter(e => e.sgv && e.date)
    .sort((a, b) => a.date - b.date);

  const labels = sortedEntries.map(e => {
    const d = new Date(e.date);
    return d.toLocaleString("ja-JP", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  });

  const values = sortedEntries.map(e => e.sgv);

  if (glucoseChart) glucoseChart.destroy();

  glucoseChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "血糖値",
          data: values,
          borderWidth: 3,
          pointRadius: 0,
          tension: 0.35
        },
        {
          label: "低血糖ライン 70",
          data: values.map(() => 70),
          borderWidth: 1,
          borderDash: [6, 6],
          pointRadius: 0
        },
        {
          label: "高血糖ライン 180",
          data: values.map(() => 180),
          borderWidth: 1,
          borderDash: [6, 6],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context => `${context.dataset.label}: ${context.parsed.y} mg/dL`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8
          }
        },
        y: {
          min: 40,
          max: 250
        }
      }
    }
  });
}

async function loadLatestGlucose() {
  const glucoseValue = document.getElementById("glucoseValue");
  const glucoseArrow = document.getElementById("glucoseArrow");
  const status = document.getElementById("status");
  const lastUpdate = document.getElementById("lastUpdate");
  const response = await fetch(`${NIGHTSCOUT_URL}/api/v1/entries.json?count=1`);
  const data = await response.json();

  if (!data || data.length === 0) {
    status.textContent = "データが見つかりません";
    setLiveStatus("error", "NO DATA", "Nightscoutに最新データがありません");
    updateHeaderUpdated(null);
    return null;
  }

  const latest = data[0];
  glucoseValue.textContent = latest.sgv ?? "--";
  glucoseArrow.textContent = directionMap[latest.direction] ?? "→";
  updateRangeStatus(Number(latest.sgv));

  const measuredAt = new Date(latest.date);
  updateHeaderUpdated(measuredAt);
  const now = new Date();
  const minutesAgo = Math.round((now - measuredAt) / 60000);

  status.textContent = `${minutesAgo}分前に更新 / ${latest.direction ?? "方向不明"}`;
  if (lastUpdate) {
    lastUpdate.textContent = `最終更新: ${formatDateTime(measuredAt)}`;
  }

  if (minutesAgo >= 30) {
    setLiveStatus("stale", "STALE", `最終データは${minutesAgo}分前です`);
  } else {
    setLiveStatus("online", "LIVE", `Nightscout接続中 / ${minutesAgo}分前に更新`);
  }
  const currentLastUpdate = document.getElementById("currentLastUpdate");
  if (currentLastUpdate) {
    currentLastUpdate.textContent = measuredAt.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }
  return latest;
}

async function loadDailyStats() {
  try {
    const latest = await loadLatestGlucose();

    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    document.getElementById("chartRange").textContent =
      `${formatDateTime(new Date(oneDayAgo))} 〜 ${formatDateTime(new Date(now))}`;

    const response = await fetch(
      `${NIGHTSCOUT_URL}/api/v1/entries/sgv.json?find[date][$gte]=${oneDayAgo}&find[date][$lte]=${now}&count=1000`
    );

    const entries = await response.json();
    drawGlucoseChart(entries);

    const values = entries
      .filter(e => e.sgv && e.date >= oneDayAgo)
      .map(e => e.sgv);

    if (values.length === 0) {
      document.getElementById("comment").textContent = "24時間分のデータが見つかりませんでした。";
      return;
    }

    const inRange = values.filter(v => v >= 70 && v <= 180).length;
    const aboveRange = values.filter(v => v > 180).length;
    const belowRange = values.filter(v => v < 70).length;

    const tir = pct(inRange, values.length);
    const tar = pct(aboveRange, values.length);
    const tbr = pct(belowRange, values.length);

    const avg = Math.round(average(values));
    const sd = standardDeviation(values);
    const cv = ((sd / avg) * 100).toFixed(1);
    const gmi = calculateGMI(avg).toFixed(1);

    const glucoScore = calculateGlucoScore({
      tir,
      tbr,
      cv,
      avg
    });

    document.getElementById("scoreValue").textContent = `${glucoScore.score}点`;
    document.getElementById("scoreReason").textContent =
     `${glucoScore.rank} ${glucoScore.emoji}`;

    const scoreMessage = document.querySelector(".score-message");
    if (scoreMessage) {
      scoreMessage.textContent = glucoScore.message;
    }

    document.getElementById("tirValue").textContent = `${tir}%`;
    document.getElementById("tarValue").textContent = `${tar}%`;
    document.getElementById("tbrValue").textContent = `${tbr}%`;
    document.getElementById("avgValue").textContent = avg;
    document.getElementById("cvValue").textContent = `${cv}%`;
    document.getElementById("gmiValue").textContent = `${gmi}%`;

    document.getElementById("comment").textContent =
      makeComment(tir, tar, tbr, avg, cv, latest?.sgv ?? "--");

  } catch (error) {
    console.error(error);
    setLiveStatus("error", "OFFLINE", "Nightscout接続エラー");
    updateHeaderUpdated(null);
    document.getElementById("status").textContent = "Nightscout接続エラー";
    document.getElementById("comment").textContent = "データ取得中にエラーが出ました。Consoleを確認してみてください。";
  }
}

function updateClock() {
  const now = new Date();

  const clockEl = document.getElementById("clock");
  if (clockEl) {
    clockEl.textContent = now.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const dateEl = document.getElementById("headerDate");
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    });
  }

}

updateClock();
setLiveStatus("pending", "CHECKING", "Nightscoutの最新データを確認中");
loadDailyStats();

setInterval(updateClock, 1000);
setInterval(loadDailyStats, 60000);
function setupViewTabs() {
  const tabs = document.querySelectorAll(".view-tab");
  const liveView = document.getElementById("liveView");
  const aboutView = document.getElementById("aboutView");

  function activateView(viewName) {
    const isAbout = viewName === "about";

    tabs.forEach((tab) => {
      const tabIsAbout = tab.dataset.view === "about";
      tab.classList.toggle("active", isAbout ? tabIsAbout : !tabIsAbout && !tab.dataset.view);
    });

    if (liveView) liveView.classList.toggle("active", !isAbout);
    if (aboutView) aboutView.classList.toggle("active", isAbout);
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const viewName = tab.dataset.view === "about" ? "about" : "live";
      activateView(viewName);
      window.location.hash = viewName === "about" ? "about" : "live";
    });
  });

  activateView(window.location.hash === "#about" ? "about" : "live");
}

setupViewTabs();
