import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, Loader2, RotateCcw, ScanLine, Upload } from "lucide-react";
import { C, NOTCH } from "../../../lib/tokens";
import { recognizeCollectorLine, sourceToCanvas } from "../../../lib/ocr";
import { isNativeApp } from "../../../lib/platform";
import { LiveScanOverlay } from "./LiveScanOverlay";

const btnBase = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  border: `1px solid ${C.border}`,
  borderRadius: 0,
  clipPath: NOTCH,
  padding: "12px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: C.parchment,
};

// Camera capture + file-upload fallback + OCR of the collector-number/
// set-code line, reading a physical card via the device camera instead of
// typing its code by hand. Deliberately dumb about *what* it detected —
// it hands the top candidate up via onDetected(set, number) and the parent
// (AddCardModal, "code"/"scan" shared block) does the actual Scryfall
// lookup and shows the result, exactly as if it had been typed.
// In the Android/iOS app the photo-and-Tesseract flow below is replaced by
// the live scanner: the phone's own text recognition (ML Kit / Apple Vision)
// reading straight from the camera feed. Same contract — onDetected(set,
// number) — so AddCardModal doesn't know or care which one ran.
export function ScanCardTab({ onDetected, autoStart = false, livePlugin, resolver, onScanned }) {
  if (livePlugin || (isNativeApp() && globalThis.Capacitor?.isPluginAvailable?.("LiveScanner"))) {
    return <NativeScanPanel onDetected={onDetected} autoStart={autoStart} plugin={livePlugin} resolver={resolver} onScanned={onScanned} />;
  }
  return <PhotoScanPanel onDetected={onDetected} />;
}

function NativeScanPanel({ onDetected, autoStart, plugin: injected, resolver, onScanned }) {
  const [plugin, setPlugin] = useState(injected || null);
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState(null);

  async function openScanner() {
    if (!plugin) {
      const m = await import("@binderwyrm/live-scanner");
      setPlugin(m.LiveScanner);
    }
    setOpen(true);
  }

  // After a card is added, AddCardModal remounts this tab for the next one —
  // go straight back to the camera so a stack can be scanned card by card.
  useEffect(() => {
    if (autoStart) openScanner();
  }, []);

  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0 }}>
        Point the camera at a card — the set code and collector number along its bottom edge (e.g.{" "}
        <span className="mono">245/264 U FDN</span>) are read live, on the phone, and looked up as soon as
        they come through clearly.
      </p>
      <button
        data-testid="live-scan-open"
        style={{ ...btnBase, width: "100%", background: C.accentFill, borderColor: C.accent, color: C.goldBright }}
        onClick={openScanner}
      >
        <ScanLine size={16} /> {detected ? "Scan another card" : "Scan with camera"}
      </button>
      {detected && (
        <div style={{ color: C.greenBright, fontWeight: 600, fontSize: 12.5, marginTop: 10 }}>
          ✓ Detected {detected.set} #{detected.number}
        </div>
      )}
      {open && plugin && (
        <LiveScanOverlay
          plugin={plugin}
          resolver={resolver}
          onScanned={onScanned}
          onClose={() => setOpen(false)}
          onDetected={(set, number) => {
            setDetected({ set, number });
            onDetected(set, number);
          }}
        />
      )}
    </div>
  );
}

function PhotoScanPanel({ onDetected }) {
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState("");
  const [photo, setPhoto] = useState(null); // data URL, for the thumbnail preview
  const [status, setStatus] = useState("idle"); // idle | scanning | done | error
  const [statusMsg, setStatusMsg] = useState("");
  const [rawText, setRawText] = useState("");

  const videoRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    // Stop the camera if this tab (or the whole modal) unmounts mid-capture.
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  async function startCamera() {
    setCameraError("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setStream(s);
    } catch (e) {
      console.error("[Binderwyrm] camera failed:", e);
      const detail = (e && (e.message || e.name)) || (typeof e === "string" ? e : "") || "unknown error";
      setCameraError(
        e?.name === "NotAllowedError"
          ? "Camera access was blocked — allow it in the browser's site settings, or upload a photo instead."
          : `Couldn't start the camera — ${detail}. Try uploading a photo instead.`
      );
    }
  }

  function stopCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = sourceToCanvas(video, video.videoWidth, video.videoHeight);
    stopCamera();
    setPhoto(canvas.toDataURL("image/jpeg", 0.9));
    runOcr(canvas);
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      const canvas = sourceToCanvas(img, img.naturalWidth, img.naturalHeight);
      setPhoto(canvas.toDataURL("image/jpeg", 0.9));
      runOcr(canvas);
    };
    img.onerror = () => {
      setStatus("error");
      setStatusMsg("Couldn't read that image file.");
    };
    img.src = URL.createObjectURL(file);
  }

  async function runOcr(canvas) {
    setStatus("scanning");
    setStatusMsg("Reading the collector number…");
    setRawText("");
    try {
      const { text, candidates } = await recognizeCollectorLine(canvas, (stage) => {
        if (stage === "full") setStatusMsg("Didn't catch it along the bottom edge — checking the whole card…");
      });
      setRawText(text.trim());
      if (candidates.length > 0) {
        setStatus("done");
        setStatusMsg(`Detected ${candidates[0].set} #${candidates[0].number}`);
        onDetected(candidates[0].set, candidates[0].number);
      } else {
        setStatus("error");
        setStatusMsg("Couldn't make out a code from that photo — check it below, or retake with better light and less glare.");
      }
    } catch (e) {
      // Logged for anyone who opens devtools -- the on-screen message below
      // is deliberately generic-safe (never assumes e is a real Error; some
      // browser/canvas failures throw something else entirely) so the UI
      // never ends up showing an empty error with no text.
      console.error("[Binderwyrm] scan failed:", e);
      const detail = (e && (e.message || e.name)) || (typeof e === "string" ? e : "") || "unknown error";
      setStatus("error");
      setStatusMsg(`Scan failed — ${detail}`);
    }
  }

  function retake() {
    setPhoto(null);
    setStatus("idle");
    setStatusMsg("");
    setRawText("");
    setCameraError("");
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        data-testid="scan-file-input"
        onChange={onFileChosen}
        style={{ display: "none" }}
      />

      {!stream && !photo && (
        <>
          <p style={{ fontSize: 12, color: C.parchmentDim, marginTop: 0 }}>
            Photograph the whole card in good light — the collector number and set code along the
            bottom edge (e.g. <span className="mono">245/264 U FDN</span>) get read automatically.
            If that strip doesn't come through (glare, an unusual frame), the whole photo gets a
            second look before giving up.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <button style={{ ...btnBase, flex: "1 1 160px" }} onClick={startCamera}>
              <Camera size={16} /> Use camera
            </button>
            <button style={{ ...btnBase, flex: "1 1 160px" }} onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} /> Upload photo
            </button>
          </div>
          {cameraError && (
            <div style={{ color: C.redBright, fontSize: 12.5, marginBottom: 12, display: "flex", gap: 6 }}>
              <AlertCircle size={14} /> {cameraError}
            </div>
          )}
        </>
      )}

      {stream && !photo && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}`, background: "#000" }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", display: "block", maxHeight: 320, objectFit: "contain" }} />
            <div
              style={{
                position: "absolute",
                left: "6%",
                right: "6%",
                bottom: "8%",
                height: "14%",
                border: `2px dashed ${C.accent}`,
                borderRadius: 4,
                pointerEvents: "none",
              }}
              aria-hidden="true"
            />
          </div>
          <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, textAlign: "center", margin: "6px 0" }}>
            for the fastest read, align the collector number line inside the box
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={{ ...btnBase, flex: 2, background: C.accentFill, borderColor: C.accent, color: C.goldBright }} onClick={capturePhoto}>
              Capture
            </button>
            <button style={{ ...btnBase, flex: 1 }} onClick={stopCamera}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {photo && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
            <img
              src={photo}
              alt="Captured card"
              style={{ width: 74, borderRadius: 4, border: `1px solid ${C.border}`, flexShrink: 0 }}
            />
            <div style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>
              {status === "scanning" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.parchmentDim }}>
                  <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
                  {statusMsg || "Reading the collector number…"}
                </div>
              )}
              {status === "done" && (
                <div style={{ color: C.greenBright, fontWeight: 600 }}>✓ {statusMsg}</div>
              )}
              {status === "error" && (
                <div style={{ color: C.redBright, display: "flex", gap: 6 }}>
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {statusMsg}
                </div>
              )}
              {rawText && (
                <div className="mono" style={{ fontSize: 10, color: C.parchmentDim, marginTop: 6, wordBreak: "break-word" }}>
                  read: "{rawText}"
                </div>
              )}
            </div>
          </div>
          <button style={{ ...btnBase, width: "100%" }} onClick={retake}>
            <RotateCcw size={14} /> Retake / new photo
          </button>
        </div>
      )}
    </div>
  );
}
