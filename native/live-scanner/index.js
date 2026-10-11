// JavaScript side of the native LiveScanner plugin. The heavy lifting is
// native (android/…/LiveScannerPlugin.java, ios/Sources/…/LiveScannerPlugin.swift);
// this only gives it a name the app can call.
//
//   start({ backgroundColor })  camera preview goes BEHIND the WebView, the
//                               WebView turns transparent, recognition starts.
//                               backgroundColor is what the WebView gets back
//                               on stop().
//   stop()                      tears it all down again.
//   setTorch({ enabled })       flashlight, where there is one.
//   focus({ x, y })             tap-to-focus; x/y are 0..1 of the screen.
//   checkPermissions() / requestPermissions() → { camera: "granted" | "denied" | "prompt" }
//
// Event "textRecognized": { frameWidth, frameHeight, lines: [{ text, left,
// top, right, bottom }] } — box edges are 0..1 of the UPRIGHT camera frame,
// top-left origin, a few times a second while running.
//
// There is no web implementation on purpose: in a browser the app keeps its
// Tesseract photo scanner (src/lib/ocr.js).
import { registerPlugin } from "@capacitor/core";

export const LiveScanner = registerPlugin("LiveScanner");
