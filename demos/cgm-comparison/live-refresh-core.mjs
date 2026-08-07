export function createLiveRefreshController({
  load,
  getDelayMs,
  isVisible = () => true,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) => clearTimeout(timerId),
  onError = () => {}
}) {
  if (typeof load !== "function" || typeof getDelayMs !== "function") {
    throw new Error("Live refresh controller needs load and delay functions.");
  }

  let started = false;
  let timerId = null;
  let inFlight = null;

  function clearScheduledRefresh() {
    if (timerId === null) return;
    clearTimer(timerId);
    timerId = null;
  }

  function schedule() {
    clearScheduledRefresh();
    if (!started || !isVisible()) return;
    const delay = Number(getDelayMs());
    if (!Number.isFinite(delay) || delay <= 0) return;
    timerId = setTimer(() => {
      timerId = null;
      void refresh({ preserveLiveOnError: true }).catch(onError);
    }, delay);
  }

  function refresh(options = { preserveLiveOnError: true }) {
    if (inFlight) return inFlight;
    clearScheduledRefresh();
    const operation = Promise.resolve().then(() => load(options));
    inFlight = operation.finally(() => {
      inFlight = null;
      schedule();
    });
    return inFlight;
  }

  function start() {
    if (started) return inFlight || Promise.resolve();
    started = true;
    return refresh({ preserveLiveOnError: false });
  }

  function handlePageShow(event) {
    if (event?.persisted !== true || !started || !isVisible()) return Promise.resolve();
    return refresh({ preserveLiveOnError: true });
  }

  function handleVisibilityChange() {
    if (!isVisible()) {
      clearScheduledRefresh();
      return Promise.resolve();
    }
    if (!started) return Promise.resolve();
    return refresh({ preserveLiveOnError: true });
  }

  function stop() {
    started = false;
    clearScheduledRefresh();
  }

  return { start, stop, handlePageShow, handleVisibilityChange };
}
