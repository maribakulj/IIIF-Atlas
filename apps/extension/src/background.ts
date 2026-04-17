import type { CapturePayload, DetectResult } from "@iiif-atlas/shared";
import { postCapture } from "./lib/api.js";

const MENU_ID_IMAGE = "iiif-atlas-add-image";
const MENU_ID_PAGE = "iiif-atlas-add-page";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID_IMAGE,
    title: "Add this image to IIIF Atlas",
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
    } else if (info.menuItemId === MENU_ID_PAGE) {
      await capturePage(tab);
    }
  } catch (err) {
    notify("Capture failed", String(err));
  }
});

async function captureImage(tab: chrome.tabs.Tab, imageUrl: string) {
  const detect = await runDetect(tab.id!);
  const payload: CapturePayload = {
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? detect?.pageTitle,
    imageUrl,
    manifestUrl: detect?.manifestUrl,
    infoJsonUrl: detect?.infoJsonUrl,
    mode: detect?.manifestUrl || detect?.infoJsonUrl ? "iiif_reuse" : "reference",
    capturedAt: new Date().toISOString(),
    clientInfo: { agent: "extension", version: chrome.runtime.getManifest().version },
  };
  const res = await postCapture(payload);
  notify("Image added to IIIF Atlas", res.item.title ?? res.item.slug);
}

async function capturePage(tab: chrome.tabs.Tab) {
  const detect = await runDetect(tab.id!);
  if (!detect) throw new Error("No detectable image on page");
  const payload: CapturePayload = {
    pageUrl: tab.url ?? "",
    pageTitle: tab.title ?? detect.pageTitle,
    imageUrl: detect.primaryImageUrl,
    manifestUrl: detect.manifestUrl,
    infoJsonUrl: detect.infoJsonUrl,
    mode: detect.manifestUrl || detect.infoJsonUrl ? "iiif_reuse" : "reference",
    capturedAt: new Date().toISOString(),
  };
  const res = await postCapture(payload);
  notify("Page added to IIIF Atlas", res.item.title ?? res.item.slug);
}

async function runDetect(tabId: number): Promise<DetectResult | null> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, {
      type: "iiif-atlas:detect",
    })) as DetectResult | undefined;
    return res ?? null;
  } catch {
    return null;
  }
}

function notify(title: string, message: string) {
  // Avoid notifications permission; log & badge instead.
  console.log(`[IIIF Atlas] ${title}: ${message}`);
  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#4f8cff" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
}
