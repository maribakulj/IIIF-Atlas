import { detectCurrentPage } from "./lib/detect.js";
import { startRegionSelect } from "./region-overlay.js";

type Msg =
  | { type: "iiif-atlas:detect" }
  | { type: "iiif-atlas:start-region-select"; imageUrl: string };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg.type === "iiif-atlas:detect") {
    sendResponse(detectCurrentPage());
    return true;
  }
  if (msg.type === "iiif-atlas:start-region-select") {
    // Async: Chrome's MV3 message passing needs an explicit `return true`
    // to keep the channel open until sendResponse is called.
    startRegionSelect(msg.imageUrl).then((sel) => sendResponse(sel));
    return true;
  }
  return false;
});
