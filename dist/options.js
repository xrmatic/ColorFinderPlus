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

const fields = {
  panelFontSize: document.getElementById("panelFontSize"),
  headingFontSize: document.getElementById("headingFontSize"),
  zoomLevel: document.getElementById("zoomLevel"),
  density: document.getElementById("density"),
  showHero: document.getElementById("showHero"),
  showRecentPicks: document.getElementById("showRecentPicks"),
  maxRecentPicksShown: document.getElementById("maxRecentPicksShown"),
  maxSelectionColorsShown: document.getElementById("maxSelectionColorsShown")
};

const valueLabels = {
  panelFontSize: document.getElementById("panelFontSizeValue"),
  headingFontSize: document.getElementById("headingFontSizeValue"),
  zoomLevel: document.getElementById("zoomLevelValue"),
  maxRecentPicksShown: document.getElementById("maxRecentPicksShownValue"),
  maxSelectionColorsShown: document.getElementById("maxSelectionColorsShownValue")
};

const resetBtn = document.getElementById("resetBtn");
const saveStatus = document.getElementById("saveStatus");

for (const [key, field] of Object.entries(fields)) {
  const eventName = field.type === "checkbox" ? "change" : "input";
  field.addEventListener(eventName, () => saveSettings());
}

resetBtn.addEventListener("click", async () => {
  applySettings(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ colorFinderPlusSettings: DEFAULT_SETTINGS });
  setSaveStatus("Defaults restored.");
});

bootstrap();

async function bootstrap() {
  const stored = await chrome.storage.local.get("colorFinderPlusSettings");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.colorFinderPlusSettings || {})
  };

  applySettings(settings);
}

function applySettings(settings) {
  fields.panelFontSize.value = settings.panelFontSize;
  fields.headingFontSize.value = settings.headingFontSize;
  fields.zoomLevel.value = settings.zoomLevel;
  fields.density.value = settings.density;
  fields.showHero.checked = settings.showHero;
  fields.showRecentPicks.checked = settings.showRecentPicks;
  fields.maxRecentPicksShown.value = settings.maxRecentPicksShown;
  fields.maxSelectionColorsShown.value = settings.maxSelectionColorsShown;
  renderValueLabels(settings);
}

async function saveSettings() {
  const settings = {
    panelFontSize: Number(fields.panelFontSize.value),
    headingFontSize: Number(fields.headingFontSize.value),
    zoomLevel: Number(fields.zoomLevel.value),
    density: fields.density.value,
    showHero: fields.showHero.checked,
    showRecentPicks: fields.showRecentPicks.checked,
    maxRecentPicksShown: Number(fields.maxRecentPicksShown.value),
    maxSelectionColorsShown: Number(fields.maxSelectionColorsShown.value)
  };

  renderValueLabels(settings);
  await chrome.storage.local.set({ colorFinderPlusSettings: settings });
  setSaveStatus("Saved.");
}

function renderValueLabels(settings) {
  valueLabels.panelFontSize.textContent = `${settings.panelFontSize}px`;
  valueLabels.headingFontSize.textContent = `${settings.headingFontSize}px`;
  valueLabels.zoomLevel.textContent = `${settings.zoomLevel}x`;
  valueLabels.maxRecentPicksShown.textContent = `${settings.maxRecentPicksShown}`;
  valueLabels.maxSelectionColorsShown.textContent = `${settings.maxSelectionColorsShown}`;
}

function setSaveStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(setSaveStatus.timerId);
  setSaveStatus.timerId = window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 1600);
}
