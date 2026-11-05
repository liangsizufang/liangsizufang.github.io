/**
 * qiangpiao service worker — storage bootstrap and message relay.
 * No queue/CAPTCHA/payment automation.
 */

importScripts("shared/storage.js");

const S = self.QiangpiaoStorage;

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    S.STORAGE_KEYS.WATCH_LIST,
    S.STORAGE_KEYS.SETTINGS,
  ]);
  if (!Array.isArray(data[S.STORAGE_KEYS.WATCH_LIST])) {
    await chrome.storage.local.set({ [S.STORAGE_KEYS.WATCH_LIST]: [] });
  }
  if (!data[S.STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.local.set({
      [S.STORAGE_KEYS.SETTINGS]: { defaultQuantity: 2 },
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "PING") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }

  if (message.type === "GET_WATCH_LIST") {
    S.getWatchList().then((watchList) => {
      sendResponse({ ok: true, watchList });
    });
    return true;
  }

  if (message.type === "OPEN_URL" && typeof message.url === "string") {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
    return;
  }
});
