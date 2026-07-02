/* Barcode scanning: native BarcodeDetector where available (ChromeOS, Android
   Chrome), html5-qrcode fallback elsewhere (iOS Safari has no BarcodeDetector).
   Camera access requires a secure context — pos.home must be served over HTTPS
   for this to work on the iPhones. */
"use strict";

const scannerModal = document.getElementById("scanner-modal");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const html5qrRegion = document.getElementById("html5qr-region");

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

let nativeStream = null;
let nativeLoopId = null;
let html5qr = null;
let scanning = false;

function startScanner(onScan) {
  scannerModal.hidden = false;
  scannerStatus.textContent = "Starting camera…";
  scanning = true;

  if (!window.isSecureContext) {
    scannerStatus.textContent =
      "Camera needs a secure (HTTPS) connection. Open the https:// address.";
    return;
  }

  const handleResult = (barcode) => {
    if (!scanning) return;
    scanning = false;
    stopScanner();
    onScan(barcode);
  };

  if ("BarcodeDetector" in window) {
    startNativeScanner(handleResult);
  } else if (window.Html5Qrcode) {
    startHtml5QrScanner(handleResult);
  } else {
    scannerStatus.textContent = "No barcode scanner available in this browser.";
  }
}

async function startNativeScanner(handleResult) {
  try {
    const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    nativeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    scannerVideo.hidden = false;
    html5qrRegion.hidden = true;
    scannerVideo.srcObject = nativeStream;
    await scannerVideo.play();
    scannerStatus.textContent = "Point the camera at the barcode";

    const tick = async () => {
      if (!scanning || !nativeStream) return;
      try {
        const barcodes = await detector.detect(scannerVideo);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          handleResult(barcodes[0].rawValue);
          return;
        }
      } catch {
        /* frame not ready yet — keep looping */
      }
      nativeLoopId = requestAnimationFrame(tick);
    };
    nativeLoopId = requestAnimationFrame(tick);
  } catch (err) {
    scannerStatus.textContent = cameraErrorMessage(err);
  }
}

function startHtml5QrScanner(handleResult) {
  scannerVideo.hidden = true;
  html5qrRegion.hidden = false;
  html5qr = new Html5Qrcode("html5qr-region");
  html5qr
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 280, height: 160 } },
      (decodedText) => handleResult(decodedText),
      () => { /* per-frame decode misses are normal */ }
    )
    .then(() => {
      scannerStatus.textContent = "Point the camera at the barcode";
    })
    .catch((err) => {
      scannerStatus.textContent = cameraErrorMessage(err);
    });
}

function cameraErrorMessage(err) {
  const name = err && err.name;
  if (name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in the browser settings.";
  }
  if (name === "NotFoundError") {
    return "No camera found on this device.";
  }
  return "Could not start the camera. Close other apps using it and try again.";
}

function stopScanner() {
  scanning = false;
  if (nativeLoopId) {
    cancelAnimationFrame(nativeLoopId);
    nativeLoopId = null;
  }
  if (nativeStream) {
    nativeStream.getTracks().forEach((t) => t.stop());
    nativeStream = null;
    scannerVideo.srcObject = null;
  }
  if (html5qr) {
    const instance = html5qr;
    html5qr = null;
    instance.stop().then(() => instance.clear()).catch(() => {});
  }
  scannerModal.hidden = true;
}

document.getElementById("scanner-cancel").addEventListener("click", stopScanner);
