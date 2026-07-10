/* Barcode scanning: native BarcodeDetector where available (ChromeOS, Android
   Chrome), Quagga2 fallback elsewhere (iOS Safari has no BarcodeDetector).
   Quagga2 replaced html5-qrcode after the latter repeatedly failed to decode
   1D grocery barcodes on the iPhone 13 / 13 Pro Max — Quagga2's locator is
   built specifically for 1D codes. The fallback is 1D-only (EAN/UPC/Code),
   which is everything the shop sells; QR never decoded on that path anyway.
   Camera access requires a secure context — the app must be served over HTTPS
   at its Tailscale MagicDNS name for this to work on the iPhones.
   On devices with more than one camera a front/rear switch appears on the
   overlay; the choice is remembered for the session and defaults to the rear. */
"use strict";

const scannerModal = document.getElementById("scanner-modal");
const scannerVideo = document.getElementById("scanner-video");
const scannerStatus = document.getElementById("scanner-status");
const quaggaRegion = document.getElementById("quagga-region");
const scannerSwitch = document.getElementById("scanner-switch");
const scannerManualInput = document.getElementById("scanner-manual-input");

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];
// Same set in Quagga2's reader naming.
const QUAGGA_READERS = ["ean_reader", "ean_8_reader", "upc_reader", "upc_e_reader", "code_128_reader", "code_39_reader"];

let nativeStream = null;
let nativeLoopId = null;
let quaggaActive = false;
let scanning = false;
let currentOnScan = null;
let preferredFacing = "environment"; // remembered for the session; rear by default

function startScanner(onScan) {
  currentOnScan = onScan;
  scannerModal.hidden = false;
  scannerStatus.textContent = t("startingCamera");
  scannerSwitch.hidden = true; // shown only once we confirm 2+ cameras exist
  scannerManualInput.value = "";
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

/* TEMPORARY diagnostic: a small suffix showing which engine + camera resolution
   is in use, so we can see per-device what the iPhones actually do. Remove once
   scanning is confirmed working on the iPhones. */
function cameraInfoSuffix(engine, video) {
  const w = video && video.videoWidth;
  const h = video && video.videoHeight;
  return w && h ? ` · ${engine} ${w}×${h}` : ` · ${engine}`;
}

function startCameraStream() {
  if ("BarcodeDetector" in window) {
    startNativeScanner();
  } else if (window.Quagga) {
    startQuaggaScanner();
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
    quaggaRegion.hidden = true;
    scannerVideo.srcObject = nativeStream;
    await scannerVideo.play();
    scannerStatus.textContent = t("pointCamera") + cameraInfoSuffix("native", scannerVideo);
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

/* Accept a Quagga detection only when the decode is clean: EAN/UPC checksums
   already gate a lot, but Code 39/128 misreads happen on blurry frames, so
   (a) the average per-digit decode error must be low, and (b) the same code
   must be seen twice in a row before it's accepted. */
let lastQuaggaCode = null;

function quaggaDecodeError(codeResult) {
  const errs = (codeResult.decodedCodes || [])
    .filter((d) => d.error !== undefined)
    .map((d) => d.error);
  if (errs.length === 0) return 0;
  return errs.reduce((a, b) => a + b, 0) / errs.length;
}

function onQuaggaDetected(result) {
  if (!scanning || !result || !result.codeResult || !result.codeResult.code) return;
  if (quaggaDecodeError(result.codeResult) > 0.16) return; // too blurry — wait
  const code = result.codeResult.code;
  if (code !== lastQuaggaCode) {
    lastQuaggaCode = code; // first sighting — require a confirming frame
    return;
  }
  handleResult(code);
}

function startQuaggaScanner() {
  scannerVideo.hidden = true;
  quaggaRegion.hidden = false;
  lastQuaggaCode = null;

  Quagga.init(
    {
      inputStream: {
        type: "LiveStream",
        target: quaggaRegion,
        constraints: {
          facingMode: preferredFacing,
          // High-res ideal — small 1D bars need the pixels; the browser
          // negotiates down if the camera can't do it.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      },
      locator: { patchSize: "medium", halfSample: true },
      numOfWorkers: 0, // workers don't function in the bundled build
      frequency: 10,
      decoder: { readers: QUAGGA_READERS },
      locate: true, // find the barcode anywhere in the frame, any angle
    },
    (err) => {
      if (!scanning) return;
      if (err) {
        scannerStatus.textContent = cameraErrorMessage(err);
        return;
      }
      Quagga.onDetected(onQuaggaDetected);
      Quagga.start();
      quaggaActive = true;
      scannerStatus.textContent = t("pointCamera");
      updateSwitchVisibility();
      // Read the actual resolution once Quagga has injected its video.
      setTimeout(() => {
        if (!scanning) return;
        const v = quaggaRegion.querySelector("video");
        scannerStatus.textContent = t("pointCamera") + cameraInfoSuffix("quagga", v);
      }, 900);
    }
  );
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
  if (quaggaActive) {
    quaggaActive = false;
    // stop() can throw if the camera never actually started (e.g. permission
    // denied) — guard so manual entry and Close still work on such devices.
    try {
      Quagga.offDetected(onQuaggaDetected);
      const stopped = Quagga.stop();
      const cleanup = () => { quaggaRegion.innerHTML = ""; };
      return Promise.resolve(stopped).then(cleanup, cleanup);
    } catch {
      quaggaRegion.innerHTML = "";
      return Promise.resolve();
    }
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

/* Manual barcode entry: when the camera won't scan, staff can type the number.
   It goes through the exact same pipeline as a real scan (handleResult ->
   the onScan callback), so a match is added to the bill and a miss opens
   Quick Add with the barcode attached. Works even if the camera never started. */
function submitManualBarcode() {
  const code = scannerManualInput.value.trim();
  if (!code || !scanning) return;
  scannerManualInput.value = "";
  handleResult(code);
}
document.getElementById("scanner-manual-add").addEventListener("click", submitManualBarcode);
scannerManualInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitManualBarcode();
  }
});
