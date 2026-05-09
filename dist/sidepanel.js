const pickColorBtn = document.getElementById("pickColorBtn");
const scanBoxBtn = document.getElementById("scanBoxBtn");
const cancelBtn = document.getElementById("cancelBtn");
const clearBtn = document.getElementById("clearBtn");
const copyLatestBtn = document.getElementById("copyLatestBtn");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const statusBanner = document.getElementById("statusBanner");
const heroSection = document.getElementById("heroSection");
const recentSection = document.getElementById("recentSection");
const latestColor = document.getElementById("latestColor");
const recentPicks = document.getElementById("recentPicks");
const selectionColors = document.getElementById("selectionColors");
const selectionMeta = document.getElementById("selectionMeta");
const palettes = document.getElementById("palettes");
const swatchTemplate = document.getElementById("swatchTemplate");

const DEFAULT_SETTINGS = {
  panelFontSize: 13,
  headingFontSize: 17,
  density: "compact",
  showHero: false,
  showRecentPicks: true,
  maxRecentPicksShown: 10,
  maxSelectionColorsShown: 60
};

let currentState = null;
let currentSettings = { ...DEFAULT_SETTINGS };

pickColorBtn.addEventListener("click", () => toggleTool("picker"));
scanBoxBtn.addEventListener("click", () => toggleTool("box"));
cancelBtn.addEventListener("click", () => sendTabAction("cancel-active-mode"));
openSettingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
clearBtn.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "clear-selection" });
  if (response?.ok) {
    clearStatus();
    render(response.state);
  }
});

copyLatestBtn.addEventListener("click", async () => {
  if (!currentState?.lastPickedColor?.hex) {
    return;
  }

  await navigator.clipboard.writeText(
    `${currentState.lastPickedColor.hex} / rgb(${currentState.lastPickedColor.r}, ${currentState.lastPickedColor.g}, ${currentState.lastPickedColor.b})`
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state-updated") {
    render(message.state);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.colorFinderPlusSettings?.newValue) {
    return;
  }

  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...changes.colorFinderPlusSettings.newValue
  };
  applySettings(currentSettings);
  if (currentState) {
    render(currentState);
  }
});

bootstrap();

async function bootstrap() {
  const stored = await chrome.storage.local.get("colorFinderPlusSettings");
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored.colorFinderPlusSettings || {})
  };
  applySettings(currentSettings);

  const response = await chrome.runtime.sendMessage({ type: "panel-ready" });
  if (response?.ok) {
    clearStatus();
    render(response.state);
  }
}

async function sendTabAction(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type,
    tabId: tab.id
  });

  if (response?.ok && response.state) {
    clearStatus();
    render(response.state);
    return;
  }

  showStatus(response?.error || "Unable to activate the tool on this tab.");
}

function toggleTool(toolName) {
  if (currentState?.activeTool === toolName) {
    sendTabAction("cancel-active-mode");
    return;
  }

  sendTabAction(toolName === "picker" ? "start-picker" : "start-box-selection");
}

function render(state) {
  currentState = state;
  renderToolState(state.activeTool);
  renderLatestColor(state.lastPickedColor);
  const recentColors = state.recentPicks.slice(0, currentSettings.maxRecentPicksShown);
  const selectionList = state.activeSelection.slice(0, currentSettings.maxSelectionColorsShown);
  renderSwatchList(recentPicks, recentColors, "Pick a few colors to build a quick history.");
  renderSwatchList(selectionColors, selectionList, "Use the box tool to extract visible colors from a page region.");
  selectionMeta.textContent = state.activeSelection.length > selectionList.length
    ? `${selectionList.length} of ${state.activeSelection.length}`
    : `${state.activeSelection.length} colors`;
  renderPalettes(state.paletteSuggestions);
}

function renderLatestColor(color) {
  if (!color) {
    latestColor.className = "latest-empty";
    latestColor.textContent = "No color picked yet.";
    return;
  }

  latestColor.className = "latest-color";
  latestColor.innerHTML = "";

  const preview = document.createElement("div");
  preview.className = "latest-preview";
  preview.style.backgroundColor = color.hex;

  const meta = document.createElement("div");
  meta.className = "latest-meta";
  meta.innerHTML = `
    <strong>${color.hex}</strong>
    <span>rgb(${color.r}, ${color.g}, ${color.b})</span>
    <span>${currentState.selectionSource === "box" ? "Top color in selection" : "Last picked color"}</span>
  `;

  latestColor.append(preview, meta);
}

function renderSwatchList(target, colors, emptyMessage) {
  target.innerHTML = "";

  if (!colors?.length) {
    target.className = "swatch-grid empty-state";
    target.textContent = emptyMessage;
    return;
  }

  target.className = "swatch-grid";

  for (const color of colors) {
    const node = swatchTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".swatch-preview").style.backgroundColor = color.hex;
    node.querySelector(".swatch-hex").textContent = color.hex;
    node.querySelector(".swatch-rgb").textContent = `rgb(${color.r}, ${color.g}, ${color.b})`;
    node.querySelector(".swatch-count").textContent = color.count > 1 ? `${color.count.toLocaleString()} pixels` : "Single pick";
    node.addEventListener("click", () => navigator.clipboard.writeText(color.hex));
    target.append(node);
  }
}

function renderPalettes(paletteSuggestions) {
  palettes.innerHTML = "";

  const entries = Object.entries(paletteSuggestions || {}).filter(([, colors]) => colors?.length);
  if (!entries.length) {
    palettes.className = "palette-stack empty-state";
    palettes.textContent = "Select multiple colors to generate 4, 8, 16, and 32-color palettes.";
    return;
  }

  palettes.className = "palette-stack";

  for (const [size, colors] of entries) {
    const group = document.createElement("div");
    group.className = "palette-group";

    const label = document.createElement("div");
    label.className = "palette-label";
    label.textContent = `${size}-color palette`;

    const row = document.createElement("div");
    row.className = "palette-row";

    for (const color of colors) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "palette-chip";
      chip.style.backgroundColor = color.hex;
      chip.title = `${color.hex} / rgb(${color.r}, ${color.g}, ${color.b})`;
      chip.addEventListener("click", () => navigator.clipboard.writeText(color.hex));
      row.append(chip);
    }

    group.append(label, row);
    palettes.append(group);
  }
}

function applySettings(settings) {
  document.body.dataset.density = settings.density;
  document.documentElement.style.setProperty("--panel-font-size", `${settings.panelFontSize}px`);
  document.documentElement.style.setProperty("--heading-font-size", `${settings.headingFontSize}px`);
  heroSection.hidden = !settings.showHero;
  recentSection.classList.toggle("is-hidden", !settings.showRecentPicks);
}

function renderToolState(activeTool) {
  const pickerActive = activeTool === "picker";
  const boxActive = activeTool === "box";

  pickColorBtn.classList.toggle("tool-active", pickerActive);
  scanBoxBtn.classList.toggle("tool-active", boxActive);
  pickColorBtn.setAttribute("aria-pressed", String(pickerActive));
  scanBoxBtn.setAttribute("aria-pressed", String(boxActive));
  pickColorBtn.textContent = pickerActive ? "Picker Active" : "Start Picker";
  scanBoxBtn.textContent = boxActive ? "Box Active" : "Draw Selection Box";
}

function showStatus(message) {
  statusBanner.hidden = false;
  statusBanner.textContent = message;
}

function clearStatus() {
  statusBanner.hidden = true;
  statusBanner.textContent = "";
}
