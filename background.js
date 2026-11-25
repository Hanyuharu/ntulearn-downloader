/**
 * NTULearn Downloader - MV3 Service Worker
 * Opens or focuses the extension dashboard (app.html) when the toolbar icon is clicked.
 */

async function openOrFocusDashboard() {
  const appUrl = chrome.runtime.getURL('app.html');
  try {
    const existingTabs = await chrome.tabs.query({ url: appUrl });
    if (existingTabs.length > 0) {
      const targetTab = existingTabs[0];
      await chrome.tabs.update(targetTab.id, { active: true });
      if (typeof targetTab.windowId === 'number') {
        await chrome.windows.update(targetTab.windowId, { focused: true });
      }
      return;
    }
    await chrome.tabs.create({ url: appUrl });
  } catch (err) {
    console.error('[NTULearn Downloader] Failed to open dashboard:', err);
    // Fallback attempt
    chrome.tabs.create({ url: appUrl });
  }
}

chrome.action.onClicked.addListener(() => {
  openOrFocusDashboard();
});
