import {
  SOURCE_DEFINITIONS,
  buildAnonymizedDataset,
  validateCaptureRange
} from "./capture-core.mjs";

const form = document.getElementById("captureForm");
const status = document.getElementById("captureStatus");
const prepareButton = document.getElementById("prepareCaptureButton");
const downloadButton = document.getElementById("downloadCaptureButton");
const clearButton = document.getElementById("clearCaptureButton");
let preparedRelayConfigs = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function readConfig(urlName, secretName) {
  const data = new FormData(form);
  return window.GlucoScopeDataSource.sanitizeConfig({
    provider: "gluroo",
    baseUrl: String(data.get(urlName) || "").trim(),
    credential: String(data.get(secretName) || "").trim(),
    persist: false
  });
}

function readAllInputs() {
  if (!document.getElementById("captureConsent").checked) {
    throw new Error("限定リレーと生成ファイルについて確認してください。");
  }
  const data = new FormData(form);
  const range = validateCaptureRange(data.get("rangeStart"), data.get("rangeEnd"));
  return {
    range,
    relayConfigs: {
      "libre-2": readConfig("libreUrl", "libreSecret"),
      "dexcom-g7": readConfig("dexcomUrl", "dexcomSecret")
    }
  };
}

async function prepareCapture() {
  try {
    const { relayConfigs } = readAllInputs();
    setStatus("安全確認を行っています。画面の案内に沿って進めてください。");
    await window.GlucoScopeDataRelay.prepareConnection(relayConfigs["libre-2"]);
    preparedRelayConfigs = relayConfigs;
    downloadButton.disabled = false;
    setStatus("安全確認ができました。約1時間以内にGuardianと2つのGluroo経路を取得してください。");
  } catch (error) {
    preparedRelayConfigs = null;
    downloadButton.disabled = true;
    setStatus(error?.message || "安全確認を完了できませんでした。", true);
  }
}

function downloadJson(dataset) {
  const blob = new Blob([`${JSON.stringify(dataset, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "glucoscope-cgm-comparison-candidate.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function captureAndDownload() {
  try {
    const { range, relayConfigs } = readAllInputs();
    if (!preparedRelayConfigs || !window.GlucoScopeDataRelay.readRelaySession()) {
      throw new Error("先に安全確認を行ってください。");
    }
    preparedRelayConfigs = relayConfigs;
    downloadButton.disabled = true;
    const entriesBySource = {};
    for (let index = 0; index < SOURCE_DEFINITIONS.length; index += 1) {
      const source = SOURCE_DEFINITIONS[index];
      setStatus(`${source.shortLabel}を取得しています（${index + 1}/3）。`);
      const adapter = source.id === "guardian-4"
        ? window.GlucoScopeDataSource.createAdapter({ mode: "public-demo" })
        : window.GlucoScopeDataSource.createAdapter(preparedRelayConfigs[source.id]);
      const result = await adapter.fetchEntries(range.startMs, range.endMs, 12_000);
      entriesBySource[source.id] = result.data;
    }
    const dataset = buildAnonymizedDataset({
      startMs: range.startMs,
      endMs: range.endMs,
      entriesBySource
    });
    downloadJson(dataset);
    setStatus("匿名化した公開候補JSONを、この端末へ保存しました。Gitへ追加する前に内容を確認します。");
  } catch (error) {
    setStatus(error?.message || "3系統の取得を完了できませんでした。", true);
  } finally {
    downloadButton.disabled = !window.GlucoScopeDataRelay.readRelaySession();
  }
}

function clearCapture() {
  form.reset();
  preparedRelayConfigs = null;
  window.GlucoScopeDataRelay.clearRelaySession();
  downloadButton.disabled = true;
  setStatus("入力と接続用チケットを消しました。");
}

prepareButton.addEventListener("click", prepareCapture);
downloadButton.addEventListener("click", captureAndDownload);
clearButton.addEventListener("click", clearCapture);
