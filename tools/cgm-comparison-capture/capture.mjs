import {
  buildAnonymizedDataset,
  collectCaptureEntries,
  validateCaptureRange
} from "./capture-core.mjs";

const form = document.getElementById("captureForm");
const status = document.getElementById("captureStatus");
const prepareButton = document.getElementById("prepareCaptureButton");
const downloadButton = document.getElementById("downloadCaptureButton");
const clearButton = document.getElementById("clearCaptureButton");
let preparedRelayConfigs = null;
let preparedRelaySourceId = null;
let captureBusy = false;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function getRelayClient() {
  const relay = window.GlucoScopeDataRelay;
  if (
    !relay
    || typeof relay.prepareConnection !== "function"
    || typeof relay.revokeDeviceSession !== "function"
  ) {
    throw new Error("限定リレーの新しい端末接続を利用できません。公開中の最新版を開き直してください。");
  }
  return relay;
}

function updateCaptureControls() {
  prepareButton.disabled = captureBusy;
  clearButton.disabled = captureBusy;
  downloadButton.disabled = captureBusy || !preparedRelayConfigs || !preparedRelaySourceId;
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
  if (captureBusy) return;
  captureBusy = true;
  updateCaptureControls();
  try {
    const { relayConfigs } = readAllInputs();
    const relay = getRelayClient();
    setStatus("Libre 2用の安全確認（1回目）を行っています。画面の案内に沿って進めてください。");
    await relay.prepareConnection(relayConfigs["libre-2"]);
    preparedRelayConfigs = relayConfigs;
    preparedRelaySourceId = "libre-2";
    setStatus("1回目の安全確認ができました。取得中にDexcom G7用の2回目の確認が表示されます。");
  } catch (error) {
    preparedRelayConfigs = null;
    preparedRelaySourceId = null;
    setStatus(error?.message || "安全確認を完了できませんでした。", true);
  } finally {
    captureBusy = false;
    updateCaptureControls();
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
  if (captureBusy) return;
  let captureStarted = false;
  let finalMessage = "";
  let finalIsError = false;
  try {
    const { range, relayConfigs } = readAllInputs();
    if (!preparedRelayConfigs || !preparedRelaySourceId) {
      throw new Error("先に安全確認を行ってください。");
    }
    const relay = getRelayClient();
    preparedRelayConfigs = relayConfigs;
    captureBusy = true;
    captureStarted = true;
    updateCaptureControls();

    const collected = await collectCaptureEntries({
      range,
      relayConfigs: preparedRelayConfigs,
      preparedRelaySourceId,
      prepareRelaySource: async (config, source) => {
        setStatus(`${source.shortLabel}用の安全確認（2回目）を行っています。`);
        await relay.prepareConnection(config);
      },
      createPublicAdapter: () => window.GlucoScopeDataSource.createAdapter({ mode: "public-demo" }),
      createRelayAdapter: (config) => window.GlucoScopeDataSource.createAdapter(config),
      onProgress: (source, index, total) => {
        setStatus(`${source.shortLabel}を取得しています（${index + 1}/${total}）。`);
      },
      onPreparedRelaySource: (sourceId) => {
        preparedRelaySourceId = sourceId;
      }
    });
    preparedRelaySourceId = collected.preparedRelaySourceId;
    const dataset = buildAnonymizedDataset({
      startMs: range.startMs,
      endMs: range.endMs,
      entriesBySource: collected.entriesBySource
    });
    downloadJson(dataset);
    finalMessage = "匿名化した公開候補JSONを、この端末へ保存しました。Gitへ追加する前に内容を確認します。";
  } catch (error) {
    finalMessage = error?.message || "3系統の取得を完了できませんでした。";
    finalIsError = true;
  } finally {
    if (captureStarted) {
      let revoked = false;
      try {
        await getRelayClient().revokeDeviceSession();
        revoked = true;
      } catch {
        // The server stores only an anonymous session and source fingerprint.
        // Clear browser-side state and let the owner retry the idempotent delete.
      }
      window.GlucoScopeDataRelay?.clearRelaySession?.();
      preparedRelayConfigs = null;
      preparedRelaySourceId = null;
      if (!revoked) {
        finalMessage = `${finalMessage} 端末セッションを消す通信だけ完了しませんでした。通信が戻ったら「入力と端末セッションを消す」をもう一度押してください。`;
        finalIsError = true;
      }
    }
    captureBusy = false;
    updateCaptureControls();
    if (finalMessage) setStatus(finalMessage, finalIsError);
  }
}

async function clearCapture() {
  if (captureBusy) return;
  captureBusy = true;
  updateCaptureControls();
  let revoked = false;
  try {
    await getRelayClient().revokeDeviceSession();
    revoked = true;
  } catch {
    // Local URL/passphrases are still cleared immediately below.
  } finally {
    form.reset();
    preparedRelayConfigs = null;
    preparedRelaySourceId = null;
    window.GlucoScopeDataRelay?.clearRelaySession?.();
    captureBusy = false;
    updateCaptureControls();
    setStatus(
      revoked
        ? "入力と匿名の端末セッションを消しました。"
        : "入力は消しました。端末セッションを消す通信だけ完了しなかったため、通信が戻ったらこのボタンをもう一度押してください。",
      !revoked
    );
  }
}

prepareButton.addEventListener("click", prepareCapture);
downloadButton.addEventListener("click", captureAndDownload);
clearButton.addEventListener("click", clearCapture);
