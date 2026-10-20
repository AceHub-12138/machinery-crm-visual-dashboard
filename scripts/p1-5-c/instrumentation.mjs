/** Test-only RAF cap and resource counters; no external quality controller. */
export function installProbe(requestedTargetHz) {
  let seed = 713;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const nativeRequest = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
  const logical = new Map();
  const activeTimeouts = new Set(), activeIntervals = new Set();
  let timeoutsScheduled = 0, timeoutsFired = 0, intervalsScheduled = 0, intervalCallbacks = 0;
  let nextId = 0, nextDue;
  let engineLast;
  let browserIntervals = [], browserProbeDurations = [], engineIntervals = [], engineDurations = [], longTasks = [];
  let maxPending = 0;
  const minimumInterval = Number.isFinite(requestedTargetHz) && requestedTargetHz > 0 ? 1000 / requestedTargetHz : 0;

  window.requestAnimationFrame = callback => {
    const logicalId = ++nextId;
    const attempt = timestamp => {
      if (!logical.has(logicalId)) return;
      if (minimumInterval && nextDue !== undefined && timestamp + 0.5 < nextDue) {
        logical.set(logicalId, nativeRequest(attempt));
        return;
      }
      logical.delete(logicalId);
      if (engineLast !== undefined) engineIntervals.push(timestamp - engineLast);
      engineLast = timestamp;
      if (minimumInterval) {
        nextDue = nextDue === undefined ? timestamp + minimumInterval : nextDue + minimumInterval;
        if (nextDue < timestamp - minimumInterval) nextDue = timestamp + minimumInterval;
      }
      const started = performance.now();
      callback(timestamp);
      engineDurations.push(performance.now() - started);
    };
    logical.set(logicalId, nativeRequest(attempt));
    maxPending = Math.max(maxPending, logical.size);
    return logicalId;
  };
  window.cancelAnimationFrame = logicalId => {
    const nativeId = logical.get(logicalId);
    if (nativeId !== undefined) nativeCancel(nativeId);
    logical.delete(logicalId);
  };
  window.setTimeout = (handler, delay, ...args) => {
    let id;
    const wrapped = (...callbackArgs) => {
      activeTimeouts.delete(id); timeoutsFired++;
      if (typeof handler === 'function') return handler(...callbackArgs);
    };
    id = nativeSetTimeout(wrapped, delay, ...args); activeTimeouts.add(id); timeoutsScheduled++; return id;
  };
  window.clearTimeout = id => { activeTimeouts.delete(id); nativeClearTimeout(id); };
  window.setInterval = (handler, delay, ...args) => {
    const wrapped = (...callbackArgs) => { intervalCallbacks++; if (typeof handler === 'function') return handler(...callbackArgs); };
    const id = nativeSetInterval(wrapped, delay, ...args); activeIntervals.add(id); intervalsScheduled++; return id;
  };
  window.clearInterval = id => { activeIntervals.delete(id); nativeClearInterval(id); };
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  window.__p15cProbe = {
    snapshot(reset = false) {
      const result = { browserIntervals, browserProbeDurations, engineIntervals, engineDurations, longTasks, maxPending, pending: logical.size, requestedTargetHz };
      if (reset) {
        browserIntervals = []; browserProbeDurations = []; engineIntervals = []; engineDurations = []; longTasks = [];
        engineLast = undefined; maxPending = logical.size;
      }
      return result;
    },
    timerAudit() {
      return { activeTimeouts: activeTimeouts.size, activeIntervals: activeIntervals.size, pendingApplicationRaf: logical.size, timeoutsScheduled, timeoutsFired, intervalsScheduled, intervalCallbacks };
    },
  };
}
