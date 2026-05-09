const DEFAULT_STATE = {
  lastPickedColor: null,
  recentPicks: [],
  activeSelection: [],
  selectionSource: null,
  activeTool: null,
  paletteSuggestions: {},
  updatedAt: null
};

const DEFAULT_SETTINGS = {
  panelFontSize: 13,
  headingFontSize: 17,
  zoomLevel: 10,
  density: "compact",
  showHero: false,
  showRecentPicks: true,
  maxRecentPicksShown: 10,
  maxSelectionColorsShown: 60
};

let extensionState = structuredClone(DEFAULT_STATE);

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get("colorFinderPlusSettings");
  await chrome.storage.local.set({
    colorFinderPlusState: extensionState,
    colorFinderPlusSettings: {
      ...DEFAULT_SETTINGS,
      ...(stored.colorFinderPlusSettings || {})
    }
  });
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.runtime.onStartup.addListener(loadState);

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId && chrome.sidePanel?.open) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("Color Finder Plus error:", error);
      sendResponse({ ok: false, error: error.message || "Unknown error" });
    });

  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "panel-ready":
      await loadState();
      return { state: extensionState };
    case "start-picker":
      return startInteraction(message.tabId, "start-picker");
    case "start-box-selection":
      return startInteraction(message.tabId, "start-box-selection");
    case "cancel-active-mode":
      extensionState.activeTool = null;
      await persistState();
      await broadcastState();
      return relayToTab(message.tabId, { type: "cancel-active-mode" });
    case "capture-tab":
      return captureVisibleArea(sender.tab);
    case "picked-color":
      await savePickedColor(message.color);
      return { state: extensionState };
    case "box-selection-colors":
      await saveBoxSelection(message.colors || []);
      return { state: extensionState };
    case "clear-selection":
      extensionState = structuredClone(DEFAULT_STATE);
      await persistState();
      await broadcastState();
      return { state: extensionState };
    default:
      return {};
  }
}

async function startInteraction(tabId, eventType) {
  if (!tabId) {
    throw new Error("No active tab is available.");
  }

  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedUrl(tab.url)) {
    throw new Error("This page does not allow extensions to inspect it. Try a regular website tab instead.");
  }

  extensionState.activeTool = eventType === "start-picker" ? "picker" : "box";
  await persistState();
  await broadcastState();
  await ensureContentScript(tabId);
  return relayToTab(tabId, { type: eventType });
}


async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return;
  } catch (_error) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  }
}

function isRestrictedUrl(url) {
  if (!url) {
    return true;
  }

  return /^(chrome|edge|brave|opera|vivaldi|about|chrome-extension):/i.test(url);
}

async function relayToTab(tabId, message) {
  const response = await chrome.tabs.sendMessage(tabId, message);
  if (response?.ok === false) {
    throw new Error(response.error || "The page tool could not start.");
  }
  return { state: extensionState };
}

async function captureVisibleArea(tab) {
  if (!tab?.windowId) {
    throw new Error("Unable to capture the current tab.");
  }

  const imageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png"
  });

  return { imageDataUrl };
}

async function savePickedColor(color) {
  if (!color) {
    return;
  }

  extensionState.lastPickedColor = color;
  extensionState.activeSelection = [color];
  extensionState.selectionSource = "picker";
  extensionState.activeTool = null;
  extensionState.updatedAt = new Date().toISOString();
  extensionState.recentPicks = [color, ...extensionState.recentPicks]
    .filter((entry, index, list) => index === list.findIndex((item) => item.hex === entry.hex))
    .slice(0, 24);
  extensionState.paletteSuggestions = {};

  await persistState();
  await broadcastState();
}

async function saveBoxSelection(colors) {
  const normalizedColors = normalizeColorList(colors);
  extensionState.activeSelection = normalizedColors;
  extensionState.selectionSource = "box";
  extensionState.activeTool = null;
  extensionState.updatedAt = new Date().toISOString();
  extensionState.paletteSuggestions = buildPaletteSuggestions(normalizedColors);

  if (normalizedColors[0]) {
    extensionState.lastPickedColor = normalizedColors[0];
  }

  await persistState();
  await broadcastState();
}

function normalizeColorList(colors) {
  return colors
    .filter((color) => Number.isFinite(color?.r) && Number.isFinite(color?.g) && Number.isFinite(color?.b))
    .map((color) => {
      const r = clampChannel(color.r);
      const g = clampChannel(color.g);
      const b = clampChannel(color.b);
      return {
        r,
        g,
        b,
        hex: rgbToHex(r, g, b),
        count: Math.max(1, Number(color.count) || 1)
      };
    })
    .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));
}

function buildPaletteSuggestions(colors) {
  if (!Array.isArray(colors) || colors.length < 2) {
    return {};
  }

  const paletteSizes = [4, 8, 16, 32];
  const suggestions = {};

  for (const size of paletteSizes) {
    suggestions[size] = quantizeColors(colors, size).map((color) => ({
      ...color,
      hex: rgbToHex(color.r, color.g, color.b)
    }));
  }

  return suggestions;
}

function quantizeColors(colors, targetSize) {
  if (colors.length <= targetSize) {
    return colors.slice(0, targetSize).map(({ r, g, b, count }) => ({ r, g, b, count }));
  }

  const samples = colors.map((color) => ({
    r: color.r,
    g: color.g,
    b: color.b,
    count: Math.max(1, color.count || 1)
  }));

  const centroids = [];
  const stride = Math.max(1, Math.floor(samples.length / targetSize));

  for (let index = 0; index < targetSize; index += 1) {
    const seed = samples[Math.min(index * stride, samples.length - 1)];
    centroids.push({ r: seed.r, g: seed.g, b: seed.b });
  }

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const buckets = Array.from({ length: centroids.length }, () => ({
      r: 0,
      g: 0,
      b: 0,
      weight: 0
    }));

    for (const sample of samples) {
      const centroidIndex = findNearestCentroid(sample, centroids);
      const bucket = buckets[centroidIndex];
      bucket.r += sample.r * sample.count;
      bucket.g += sample.g * sample.count;
      bucket.b += sample.b * sample.count;
      bucket.weight += sample.count;
    }

    for (let index = 0; index < centroids.length; index += 1) {
      const bucket = buckets[index];
      if (!bucket.weight) {
        continue;
      }

      centroids[index] = {
        r: Math.round(bucket.r / bucket.weight),
        g: Math.round(bucket.g / bucket.weight),
        b: Math.round(bucket.b / bucket.weight)
      };
    }
  }

  const merged = dedupePalette(
    centroids.map((centroid) => ({
      r: clampChannel(centroid.r),
      g: clampChannel(centroid.g),
      b: clampChannel(centroid.b),
      count: 1
    }))
  );

  if (merged.length >= targetSize) {
    return merged.slice(0, targetSize);
  }

  const fallback = colors
    .filter((color) => !merged.some((entry) => entry.hex === color.hex))
    .slice(0, targetSize - merged.length)
    .map(({ r, g, b, count }) => ({ r, g, b, count, hex: rgbToHex(r, g, b) }));

  return [...merged, ...fallback].slice(0, targetSize);
}

function dedupePalette(colors) {
  const unique = new Map();

  for (const color of colors) {
    const hex = rgbToHex(color.r, color.g, color.b);
    if (!unique.has(hex)) {
      unique.set(hex, { ...color, hex });
    }
  }

  return Array.from(unique.values());
}

function findNearestCentroid(sample, centroids) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < centroids.length; index += 1) {
    const centroid = centroids[index];
    const distance =
      Math.pow(sample.r - centroid.r, 2) +
      Math.pow(sample.g - centroid.g, 2) +
      Math.pow(sample.b - centroid.b, 2);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

async function loadState() {
  const stored = await chrome.storage.local.get(["colorFinderPlusState", "colorFinderPlusSettings"]);
  extensionState = {
    ...structuredClone(DEFAULT_STATE),
    ...(stored.colorFinderPlusState || {})
  };

  if (!stored.colorFinderPlusSettings) {
    await chrome.storage.local.set({ colorFinderPlusSettings: DEFAULT_SETTINGS });
  }
}

async function persistState() {
  await chrome.storage.local.set({ colorFinderPlusState: extensionState });
}

async function broadcastState() {
  try {
    await chrome.runtime.sendMessage({
      type: "state-updated",
      state: extensionState
    });
  } catch (_error) {
    // No listeners are attached yet.
  }

  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id && !isRestrictedUrl(tab.url))
        .map((tab) =>
          chrome.tabs.sendMessage(tab.id, {
            type: "state-updated",
            state: extensionState
          }).catch(() => {
            // Ignore tabs that do not have the content script ready.
          })
        )
    );
  } catch (_error) {
    // Ignore cross-tab broadcast failures.
  }
}
