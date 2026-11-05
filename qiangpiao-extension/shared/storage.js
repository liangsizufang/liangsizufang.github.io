/**
 * Shared chrome.storage helpers for qiangpiao (plain script, no bundler).
 * Attaches to globalThis.QiangpiaoStorage for popup + content + background.
 */
(function (root) {
  const STORAGE_KEYS = {
    WATCH_LIST: "watchList",
    SETTINGS: "settings",
  };

  const DEFAULT_SETTINGS = {
    defaultQuantity: 2,
  };

  function extractEventId(url) {
    if (!url) return null;
    try {
      const u = new URL(url);
      const eventMatch = u.pathname.match(/\/event\/([A-Za-z0-9]+)/i);
      if (eventMatch) return eventMatch[1];
      const segments = u.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1] || "";
      if (/^[0-9A-Fa-f]{10,}$/.test(last) || /^[0-9A-Za-z]{12,}$/.test(last)) {
        return last;
      }
      return null;
    } catch {
      return null;
    }
  }

  function deriveLabel(url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] && parts[0] !== "event") {
        return decodeURIComponent(parts[0]).replace(/-/g, " ");
      }
      if (parts[0] === "event" && parts[1]) return `Event ${parts[1]}`;
      return u.hostname;
    } catch {
      return String(url).slice(0, 48);
    }
  }

  function clampQuantity(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 2;
    return Math.min(20, Math.max(1, Math.round(v)));
  }

  function createWatchedEvent(partial) {
    partial = partial || {};
    const now = new Date().toISOString();
    const url = partial.url || "";
    const eventId = partial.eventId || extractEventId(url) || crypto.randomUUID();
    return {
      id: partial.id || crypto.randomUUID(),
      url,
      eventId,
      label: partial.label || deriveLabel(url) || "Untitled event",
      quantity: clampQuantity(
        partial.quantity != null ? partial.quantity : DEFAULT_SETTINGS.defaultQuantity
      ),
      sectionNotes: partial.sectionNotes || "",
      priceNotes: partial.priceNotes || "",
      status: partial.status || "watching",
      onsaleAt: partial.onsaleAt != null ? partial.onsaleAt : null,
      createdAt: partial.createdAt || now,
      updatedAt: partial.updatedAt || now,
      lastOutcomeAt: partial.lastOutcomeAt != null ? partial.lastOutcomeAt : null,
    };
  }

  async function getWatchList() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.WATCH_LIST);
    const list = data[STORAGE_KEYS.WATCH_LIST];
    return Array.isArray(list) ? list : [];
  }

  async function setWatchList(list) {
    await chrome.storage.local.set({ [STORAGE_KEYS.WATCH_LIST]: list });
  }

  async function upsertWatchedEvent(event) {
    const list = await getWatchList();
    const idx = list.findIndex(
      (e) => e.id === event.id || (event.eventId && e.eventId === event.eventId)
    );
    const next = Object.assign({}, event, { updatedAt: new Date().toISOString() });
    if (idx >= 0) list[idx] = Object.assign({}, list[idx], next);
    else list.unshift(next);
    await setWatchList(list);
    return list;
  }

  async function removeWatchedEvent(id) {
    const list = (await getWatchList()).filter((e) => e.id !== id);
    await setWatchList(list);
    return list;
  }

  async function findWatchedEvent(eventIdOrUrl) {
    const list = await getWatchList();
    const eventId = extractEventId(eventIdOrUrl) || eventIdOrUrl;
    return (
      list.find(
        (e) =>
          e.eventId === eventId ||
          e.url === eventIdOrUrl ||
          (e.url && eventIdOrUrl && String(eventIdOrUrl).includes(e.eventId))
      ) || null
    );
  }

  async function getSettings() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.SETTINGS] || {});
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const next = Object.assign({}, current, partial);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
    return next;
  }

  function formatCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return d + "d " + h + "h " + m + "m";
    if (h > 0) return h + "h " + m + "m " + sec + "s";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }

  function resolveDisplayStatus(event, now) {
    now = now || new Date();
    const locked = ["got", "failed", "soldout", "limited", "onsale"];
    if (locked.indexOf(event.status) >= 0) {
      const labels = {
        got: "Got tickets",
        failed: "Failed",
        soldout: "Sold out",
        limited: "Limited",
        onsale: "Onsale open",
      };
      return { status: event.status, countdownMs: null, label: labels[event.status] };
    }
    if (event.onsaleAt) {
      const t = new Date(event.onsaleAt).getTime();
      if (!Number.isNaN(t)) {
        const diff = t - now.getTime();
        if (diff > 0) {
          return {
            status: "watching",
            countdownMs: diff,
            label: formatCountdown(diff),
          };
        }
        return { status: "onsale", countdownMs: 0, label: "Onsale open" };
      }
    }
    return { status: "watching", countdownMs: null, label: "Watching" };
  }

  root.QiangpiaoStorage = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    extractEventId,
    deriveLabel,
    clampQuantity,
    createWatchedEvent,
    getWatchList,
    setWatchList,
    upsertWatchedEvent,
    removeWatchedEvent,
    findWatchedEvent,
    getSettings,
    setSettings,
    formatCountdown,
    resolveDisplayStatus,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
