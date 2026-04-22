import type { CapturePayload, DetectResult, IngestionMode } from "@iiif-atlas/shared";
import { CaptureError, getDomainPreset, postCapture } from "./lib/api.js";

const MENU_ID_IMAGE = "iiif-atlas-add-image";
const MENU_ID_PAGE = "iiif-atlas-add-page";
const MENU_ID_REGION = "iiif-atlas-clip-region";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_IMAGE,
    title: "Add this image to IIIF Atlas",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: MENU_ID_REGION,
    title: "Clip region of this image…",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: MENU_ID_PAGE,
    title: "Add this page to IIIF Atlas",
    contexts: ["page", "link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    if (info.menuItemId === MENU_ID_IMAGE && info.srcUrl) {
      await captureImage(tab, info.srcUrl);
    } else if (info.menuItemId === MENU_ID_REGION && info.srcUrl) {
      await captureRegion(tab, info.srcUrl);
    } else if (info.menuItemId === MENU_ID_PAGE) {
      await capturePage(tab);
    }
  } catch (err) {
    notifyError(err);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    if (command === "capture-page") await capturePage(tab);
  } catch (err) {
    notifyError(err);
  }
});

async function captureImage(tab: chrome.tabs.Tab, imageUrl: string) {
  const detect = await runDetect(tab.id!);
  const preset = await getDomainPreset(tab.url);
  const mode = resolveMode(detect, preset);
  const payload: CapturePayload = {
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? detect?.pageTitle,
    imageUrl,
    manifestUrl: detect?.manifestUrl,
    infoJsonUrl: detect?.infoJsonUrl,
    mode,
    capturedAt: new Date().toISOString(),
    clientInfo: { agent: "extension", version: chrome.runtime.getManifest().version },
  };
  const res = await postCapture(payload);
  notifyOk("Image added to IIIF Atlas", res.item.title ?? res.item.slug);
}

async function capturePage(tab: chrome.tabs.Tab) {
  const detect = await runDetect(tab.id!);
  if (!detect) throw new Error("No detectable image on page");
  const preset = await getDomainPreset(tab.url);
  const mode = resolveMode(detect, preset);
  const payload: CapturePayload = {
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? detect.pageTitle,
    imageUrl: detect.primaryImageUrl,
    manifestUrl: detect.manifestUrl,
    infoJsonUrl: detect.infoJsonUrl,
    mode,
    capturedAt: new Date().toISOString(),
  };
  const res = await postCapture(payload);
  notifyOk("Page added to IIIF Atlas", res.item.title ?? res.item.slug);
}

async function captureRegion(tab: chrome.tabs.Tab, imageUrl: string) {
  const selection = await sendToContent<{ imageUrl: string; regionXywh: string } | null>(tab.id!, {
    type: "iiif-atlas:start-region-select",
    imageUrl,
  });
  if (!selection) return;
  const detect = await runDetect(tab.id!);
  const preset = await getDomainPreset(tab.url);
  const mode = resolveMode(detect, preset);
  const payload: CapturePayload = {
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? detect?.pageTitle,
    imageUrl: selection.imageUrl,
    manifestUrl: detect?.manifestUrl,
    infoJsonUrl: detect?.infoJsonUrl,
    mode,
    regionXywh: selection.regionXywh,
    capturedAt: new Date().toISOString(),
  };
  const res = await postCapture(payload);
  notifyOk("Region added to IIIF Atlas", res.item.title ?? res.item.slug);
}

function resolveMode(detect: DetectResult | null, preset: IngestionMode | null): IngestionMode {
  if (detect?.manifestUrl || detect?.infoJsonUrl) return "iiif_reuse";
  return preset ?? "reference";
}

async function runDetect(tabId: number): Promise<DetectResult | null> {
  try {
    return await sendToContent<DetectResult>(tabId, { type: "iiif-atlas:detect" });
  } catch {
    // Detection is best-effort; failure here just falls back to `reference` mode.
    return null;
  }
}

/**
 * Send a message to the tab's content-script, retrying once after a
 * short delay if the script wasn't loaded yet (common on pages that
 * were open before the extension was installed). A second failure
 * surfaces as a user-visible error so we never fail silently.
 */
async function sendToContent<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (_first) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (second) {
      throw new Error(
        `The extension couldn't reach this page. Reload the tab and try again. (${String(second)})`,
      );
    }
  }
}

function notifyOk(title: string, message: string) {
  console.log(`[IIIF Atlas] ${title}: ${message}`);
  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#4f8cff" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}

function notifyError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[IIIF Atlas] Capture failed:", message);
  chrome.action.setBadgeText({ text: "!" });
  const bg = err instanceof CaptureError && err.status === 429 ? "#ff9a3c" : "#ff4d4d";
  chrome.action.setBadgeBackgroundColor({ color: bg });
  chrome.action.setTitle({ title: `IIIF Atlas — ${message}` });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "IIIF Atlas" });
  }, 5000);
}
