import { detectCurrentPage } from "./lib/detect.js";

type Msg =
  | { type: "iiif-atlas:detect" }
  | { type: "iiif-atlas:capture-from-page"; imageUrl: string };

chrome.runtime.onMessage.addListener(
  (msg: Msg, _sender, sendResponse) => {
    if (msg.type === "iiif-atlas:detect") {
      sendResponse(detectCurrentPage());
      return true;
    }
    if (msg.type === "iiif-atlas:capture-from-page") {
      sendResponse(detectCurrentPage());
      return true;
    }
    return false;
  },
);
