// Runtime recorded from confirmed field telemetry. No motor commands are issued here.
(function (root) {
  'use strict';
  const DAY_MS = 86400000;
  const RETENTION_MS = 30 * DAY_MS;
  const MAX_GAP_MS = 60000;
  const INDIA_OFFSET_MS = 19800000;

  function update(previous, observation) {
    const { now, at, online, on } = observation;
    const cutoff = now - RETENTION_MS;
    const source = previous && previous.version === 1 ? previous : {};
    // A transaction captured earlier may retry after another tab has saved newer data.
    if (source.checkpoint && source.checkpoint.at > now) return source;
    const sessions = {};
    for (const [key, interval] of Object.entries(source.sessions || {})) {
      if (!interval || !Number.isFinite(interval.start) || !Number.isFinite(interval.end) ||
          interval.end < interval.start || interval.start > now || interval.end < cutoff) continue;
      sessions[key] = { start: Math.max(interval.start, cutoff), end: Math.min(interval.end, now) };
    }
    const old = source.checkpoint;
    let checkpoint = old && Number.isFinite(old.at) && old.at >= cutoff ? { ...old } : null;
    if (checkpoint && !sessions[checkpoint.activeId]) checkpoint.activeId = '';

    // Ignore an older tab's telemetry. Cleanup still runs if there is no new sample.
    if (Number.isFinite(at) && at >= cutoff && at > 0 && at <= now && (!checkpoint || at >= checkpoint.at)) {
      const fresh = online && now - at < MAX_GAP_MS;
      const continuous = checkpoint && checkpoint.on && sessions[checkpoint.activeId] &&
        at - checkpoint.at <= MAX_GAP_MS;
      let activeId = continuous ? checkpoint.activeId : '';
      if (continuous) {
        // Never count past the last received field timestamp, including on disconnect.
        sessions[activeId].end = Math.max(sessions[activeId].end, at);
      }
      const staleRestart = checkpoint && at === checkpoint.at && !checkpoint.on;
      if (fresh && on && !staleRestart) {
        if (!activeId) {
          activeId = String(at);
          sessions[activeId] = { start: at, end: at };
        }
      } else {
        activeId = '';
      }
      checkpoint = { at, on: Boolean(fresh && on && !staleRestart), activeId };
    }

    // A long offline period must not leave a stale session marked as active.
    if (checkpoint && now - checkpoint.at >= MAX_GAP_MS) {
      checkpoint.on = false;
      checkpoint.activeId = '';
    }
    return { version: 1, ...(Object.keys(sessions).length ? { sessions } : {}), ...(checkpoint ? { checkpoint } : {}) };
  }

  function summarize(ledger, now = Date.now()) {
    const local = new Date(now + INDIA_OFFSET_MS);
    const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - INDIA_OFFSET_MS;
    const starts = {
      today: dayStart,
      week: dayStart - ((local.getUTCDay() + 6) % 7) * DAY_MS,
      month: Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - INDIA_OFFSET_MS
    };
    // Merge overlapping intervals defensively before summing.
    const intervals = Object.values((ledger && ledger.sessions) || {})
      .filter(s => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
      .map(s => ({ start: Math.max(s.start, now - RETENTION_MS), end: Math.min(s.end, now) }))
      .filter(s => s.end > s.start).sort((a, b) => a.start - b.start);
    const merged = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    const totals = {};
    for (const [period, start] of Object.entries(starts)) {
      totals[period] = Math.floor(merged.reduce((sum, s) => sum + Math.max(0, s.end - Math.max(s.start, start)), 0) / 1000);
    }
    return totals;
  }

  function sessionStart(ledger) {
    const checkpoint = ledger && ledger.checkpoint;
    const session = checkpoint && checkpoint.on && ledger.sessions && ledger.sessions[checkpoint.activeId];
    return session ? session.start : 0;
  }

  const api = { update, summarize, sessionStart, RETENTION_MS, MAX_GAP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RuntimeTracker = api;
})(typeof window !== 'undefined' ? window : globalThis);
