(() => {
  if (window.__colorFinderPlusInjected) {
    return;
  }

  window.__colorFinderPlusInjected = true;

  const state = {
    mode: null,
    isDragging: false,
    dragStart: null,
    overlay: null,
    zoomLevel: 10,
    hud: null,
    hudCanvas: null,
    hudHex: null,
    hudRgb: null,
    hudDot: null,
    selectionBox: null,
    instructions: null,
    screenshotUrl: null,
    screenshotImage: null,
    devicePixelRatio: window.devicePixelRatio || 1,
    viewportRefreshTimer: null
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ping") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "state-updated") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "start-picker") {
      startMode("picker")
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message || "Unable to start picker." }));
      return true;
    }

    if (message?.type === "start-box-selection") {
      startMode("box")
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message || "Unable to start selection box." }));
      return true;
    }

    if (message?.type === "cancel-active-mode") {
      cleanup();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.colorFinderPlusSettings?.newValue) {
      return;
    }

    const nextZoom = Number(changes.colorFinderPlusSettings.newValue.zoomLevel);
    if (Number.isFinite(nextZoom) && nextZoom > 0) {
      state.zoomLevel = nextZoom;
    }
  });

  async function startMode(mode) {
    cleanup();
    state.mode = mode;
    state.devicePixelRatio = window.devicePixelRatio || 1;
    await loadSettings();

    await refreshScreenshot();
    buildOverlay();

    if (mode === "picker") {
      state.instructions.textContent = "Click to pick a color. Press Esc to cancel.";
      state.overlay.addEventListener("mousemove", handlePickerMove);
      state.overlay.addEventListener("click", handlePickerClick);
    } else {
      state.instructions.textContent = "Drag a box to collect colors. Press Esc to cancel.";
      state.overlay.addEventListener("mousedown", handleBoxStart);
      state.overlay.addEventListener("mousemove", handleBoxMove);
      state.overlay.addEventListener("mouseup", handleBoxEnd);
    }

    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange, true);
  }

  async function refreshScreenshot() {
    const response = await chrome.runtime.sendMessage({ type: "capture-tab" });
    if (!response?.ok || !response.imageDataUrl) {
      throw new Error(response?.error || "Capture failed");
    }

    state.screenshotUrl = response.imageDataUrl;
    state.screenshotImage = await loadImage(response.imageDataUrl);
  }

  function buildOverlay() {
    const root = document.createElement("div");
    root.id = "color-finder-plus-root";

    const overlay = document.createElement("div");
    overlay.className = "cfp-overlay is-active";

    const mask = document.createElement("div");
    mask.className = "cfp-mask";

    const selectionBox = document.createElement("div");
    selectionBox.className = "cfp-selection";
    selectionBox.hidden = true;

    const hud = document.createElement("div");
    hud.className = "cfp-hud";

    const badge = document.createElement("div");
    badge.className = "cfp-badge";

    const dot = document.createElement("span");
    dot.className = "cfp-dot";

    const label = document.createElement("span");
    label.textContent = state.mode === "picker" ? "Live picker" : "Selection";

    badge.append(dot, label);

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 160;

    const meta = document.createElement("div");
    meta.className = "cfp-hud-meta";

    const hex = document.createElement("div");
    const rgb = document.createElement("div");

    meta.append(hex, rgb);
    hud.append(badge, canvas, meta);

    const instructions = document.createElement("div");
    instructions.className = "cfp-instructions";

    overlay.append(mask, selectionBox, hud, instructions);
    root.append(overlay);
    document.documentElement.append(root);

    state.overlay = overlay;
    state.hud = hud;
    state.hudCanvas = canvas;
    state.hudHex = hex;
    state.hudRgb = rgb;
    state.hudDot = dot;
    state.selectionBox = selectionBox;
    state.instructions = instructions;
  }

  function handlePickerMove(event) {
    positionHud(event.clientX, event.clientY);
    const sample = sampleColor(event.clientX, event.clientY);
    renderMagnifier(event.clientX, event.clientY, sample);
  }

  function handlePickerClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const sample = sampleColor(event.clientX, event.clientY);
    chrome.runtime.sendMessage({
      type: "picked-color",
      color: {
        ...sample,
        count: 1
      }
    });

    cleanup();
  }

  function handleBoxStart(event) {
    event.preventDefault();
    state.isDragging = true;
    state.dragStart = { x: event.clientX, y: event.clientY };
    updateSelectionBox(event.clientX, event.clientY);
  }

  function handleBoxMove(event) {
    positionHud(event.clientX, event.clientY);

    if (state.mode === "picker") {
      return;
    }

    if (!state.isDragging) {
      renderMagnifier(event.clientX, event.clientY, sampleColor(event.clientX, event.clientY));
      return;
    }

    updateSelectionBox(event.clientX, event.clientY);
    renderMagnifier(event.clientX, event.clientY, sampleColor(event.clientX, event.clientY));
  }

  function handleBoxEnd(event) {
    if (!state.isDragging || !state.dragStart) {
      return;
    }

    state.isDragging = false;
    const rect = normalizeRect(state.dragStart.x, state.dragStart.y, event.clientX, event.clientY);

    if (rect.width < 2 || rect.height < 2) {
      cleanup();
      return;
    }

    const colors = extractColors(rect);
    chrome.runtime.sendMessage({
      type: "box-selection-colors",
      colors
    });

    cleanup();
  }

  async function handleViewportChange() {
    if (!state.mode) {
      return;
    }

    window.clearTimeout(state.viewportRefreshTimer);
    state.viewportRefreshTimer = window.setTimeout(() => {
      refreshScreenshot().catch((error) => {
        console.error("Color Finder Plus viewport refresh failed:", error);
      });
    }, 120);
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      cleanup();
    }
  }

  function cleanup() {
    window.removeEventListener("keydown", handleKeydown, true);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange, true);

    if (state.overlay) {
      state.overlay.remove();
    }

    window.clearTimeout(state.viewportRefreshTimer);

    state.mode = null;
    state.isDragging = false;
    state.dragStart = null;
    state.overlay = null;
    state.hud = null;
    state.hudCanvas = null;
    state.hudHex = null;
    state.hudRgb = null;
    state.hudDot = null;
    state.selectionBox = null;
    state.instructions = null;
    state.viewportRefreshTimer = null;
  }

  function updateSelectionBox(currentX, currentY) {
    const rect = normalizeRect(state.dragStart.x, state.dragStart.y, currentX, currentY);
    state.selectionBox.hidden = false;
    state.selectionBox.style.left = `${rect.x}px`;
    state.selectionBox.style.top = `${rect.y}px`;
    state.selectionBox.style.width = `${rect.width}px`;
    state.selectionBox.style.height = `${rect.height}px`;
  }

  function positionHud(clientX, clientY) {
    const gap = 16;
    const hudWidth = 184;
    const hudHeight = 244;
    const maxLeft = window.innerWidth - hudWidth - 12;
    const maxTop = window.innerHeight - hudHeight - 12;
    const left = clientX + gap > maxLeft ? clientX - hudWidth - gap : clientX + gap;
    const top = clientY + gap > maxTop ? clientY - hudHeight - gap : clientY + gap;

    state.hud.style.left = `${Math.max(12, left)}px`;
    state.hud.style.top = `${Math.max(12, top)}px`;
  }

  function renderMagnifier(clientX, clientY, sample) {
    const context = state.hudCanvas.getContext("2d");
    const sourceX = Math.round(clientX * state.devicePixelRatio);
    const sourceY = Math.round(clientY * state.devicePixelRatio);
    const canvasSize = 160;
    const sourceSize = Math.max(8, Math.round(canvasSize / state.zoomLevel));
    const cellSize = canvasSize / sourceSize;

    context.clearRect(0, 0, canvasSize, canvasSize);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      state.screenshotImage,
      sourceX - sourceSize / 2,
      sourceY - sourceSize / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      canvasSize,
      canvasSize
    );

    context.strokeStyle = "rgba(15, 23, 42, 0.95)";
    context.lineWidth = 2;
    context.strokeRect(
      Math.round(canvasSize / 2 - cellSize / 2),
      Math.round(canvasSize / 2 - cellSize / 2),
      Math.max(1, Math.round(cellSize)),
      Math.max(1, Math.round(cellSize))
    );

    state.hudHex.textContent = `Hex: ${sample.hex}`;
    state.hudRgb.textContent = `RGB: ${sample.rgb}`;
    state.hudDot.style.backgroundColor = sample.hex;
  }

  function sampleColor(clientX, clientY) {
    const sourceX = Math.max(0, Math.min(state.screenshotImage.width - 1, Math.round(clientX * state.devicePixelRatio)));
    const sourceY = Math.max(0, Math.min(state.screenshotImage.height - 1, Math.round(clientY * state.devicePixelRatio)));
    const scratch = document.createElement("canvas");
    scratch.width = 1;
    scratch.height = 1;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    context.drawImage(state.screenshotImage, sourceX, sourceY, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;

    return {
      r,
      g,
      b,
      hex: rgbToHex(r, g, b),
      rgb: `rgb(${r}, ${g}, ${b})`
    };
  }

  function extractColors(rect) {
    const sourceX = Math.max(0, Math.round(rect.x * state.devicePixelRatio));
    const sourceY = Math.max(0, Math.round(rect.y * state.devicePixelRatio));
    const sourceWidth = Math.max(1, Math.round(rect.width * state.devicePixelRatio));
    const sourceHeight = Math.max(1, Math.round(rect.height * state.devicePixelRatio));
    const scratch = document.createElement("canvas");
    scratch.width = sourceWidth;
    scratch.height = sourceHeight;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    context.drawImage(
      state.screenshotImage,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    const imageData = context.getImageData(0, 0, sourceWidth, sourceHeight).data;
    const counts = new Map();

    for (let index = 0; index < imageData.length; index += 4) {
      const r = imageData[index];
      const g = imageData[index + 1];
      const b = imageData[index + 2];
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return Array.from(counts.entries())
      .map(([key, count]) => {
        const [r, g, b] = key.split(",").map(Number);
        return {
          r,
          g,
          b,
          hex: rgbToHex(r, g, b),
          count
        };
      })
      .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));
  }

  function normalizeRect(startX, startY, endX, endY) {
    return {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY)
    };
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get("colorFinderPlusSettings");
    const nextZoom = Number(stored.colorFinderPlusSettings?.zoomLevel);
    state.zoomLevel = Number.isFinite(nextZoom) && nextZoom > 0 ? nextZoom : 10;
  }
})();
