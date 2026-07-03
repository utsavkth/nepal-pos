/* Barcode scanning: native BarcodeDetector where available (ChromeOS, Android
   Chrome), html5-qrcode fallback elsewhere (iOS Safari has no BarcodeDetector).
   Camera access requires a secure context — the app must be served over HTTPS
   at its Tailscale MagicDNS name for this to work on the iPhones.
   On devices with more than one camera a front/rear switch appears on the
   overlay; the choice is remembered for the session and defaults to the rear. */
"use strict";

const scannerModal = document.getElementById("scanner-modal");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const html5qrRegion = document.getElementById("html5qr-region");
const scannerSwitch = document.getElementById("scanner-switch");

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

let nativeStream = null;
let nativeLoopId = null;
let html5qr = null;
let scanning = false;
let currentOnScan = null;
let preferredFacing = "environment"; // remembered for the session; rear by default

function startScanner(onScan) {
  currentOnScan = onScan;
  scannerModal.hidden = false;
  scannerStatus.textContent = t("startingCamera");
  scannerSwitch.hidden = true; // shown only once we confirm 2+ cameras exist
  scanning = true;

  if (!window.isSecureContext) {
    scannerStatus.textContent = t("httpsNeeded");
    return;
  }
  startCameraStream();
}

function handleResult(barcode) {
  if (!scanning) return;
  scanning = false;
  stopScanner();
  currentOnScan(barcode);
}

function startCameraStream() {
  if ("BarcodeDetector" in window) {
    startNativeScanner();
  } else if (window.Html5Qrcode) {
    startHtml5QrScanner();
  } else {
    scannerStatus.textContent = t("noScanner");
  }
}

async function startNativeScanner() {
  try {
    const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
    nativeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: preferredFacing },
    });
    scannerVideo.hidden = false;
    html5qrRegion.hidden = true;
    scannerVideo.srcObject = nativeStream;
    await scannerVideo.play();
    scannerStatus.textContent = t("pointCamera");
    updateSwitchVisibility();

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

function startHtml5QrScanner() {
  scannerVideo.hidden = true;
  html5qrRegion.hidden = false;
  html5qr = new Html5Qrcode("html5qr-region");
  html5qr
    .start(
      { facingMode: preferredFacing },
      { fps: 10, qrbox: { width: 280, height: 160 } },
      (decodedText) => handleResult(decodedText),
      () => { /* per-frame decode misses are normal */ }
    )
    .then(() => {
      scannerStatus.textContent = t("pointCamera");
      updateSwitchVisibility();
    })
    .catch((err) => {
      scannerStatus.textContent = cameraErrorMessage(err);
    });
}

async function updateSwitchVisibility() {
  // Only worth offering a switch if the device actually has 2+ cameras.
  // enumerateDevices is reliable here because camera permission is granted.
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((d) => d.kind === "videoinput");
    scannerSwitch.hidden = cameras.length < 2;
  } catch {
    scannerSwitch.hidden = true;
  }
}

function cameraErrorMessage(err) {
  const name = err && err.name;
  if (name === "NotAllowedError") {
    return t("cameraDenied");
  }
  if (name === "NotFoundError") {
    return t("noCamera");
  }
  return t("cameraFailed");
}

function stopCameraTracks() {
  // Stop the live camera but leave the modal open — used when switching cameras.
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
    return instance.stop().then(() => instance.clear()).catch(() => {});
  }
  return Promise.resolve();
}

function stopScanner() {
  scanning = false;
  stopCameraTracks();
  scannerModal.hidden = true;
}

async function switchCamera() {
  preferredFacing = preferredFacing === "environment" ? "user" : "environment";
  scannerStatus.textContent = t("switchingCamera");
  await stopCameraTracks();
  startCameraStream();
}

document.getElementById("scanner-cancel").addEventListener("click", stopScanner);
scannerSwitch.addEventListener("click", switchCamera);
