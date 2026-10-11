import AVFoundation
import Capacitor
import Foundation
import UIKit
import Vision

/// Live card scanner for Binderwyrm (iOS).
///
/// Mirrors the Android plugin: the camera preview is a native view placed
/// BEHIND the Capacitor WebView, the WebView goes transparent while scanning,
/// and frames go to Apple's Vision text recogniser a few times a second. Every
/// recognised line is sent to JavaScript as a "textRecognized" event; what a
/// collector number looks like is decided in JS, shared with the web scanner.
@objc(LiveScannerPlugin)
public class LiveScannerPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureVideoDataOutputSampleBufferDelegate {
    public let identifier = "LiveScannerPlugin"
    public let jsName = "LiveScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "focus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise)
    ]

    /// A UIView whose backing layer IS the preview layer, so it follows the
    /// view's size (rotation, split view) without manual frame bookkeeping.
    private final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer {
            // swiftlint:disable:next force_cast
            layer as! AVCaptureVideoPreviewLayer
        }
    }

    private let sessionQueue = DispatchQueue(label: "eu.arinvault.binderwyrm.livescanner.session")
    private let visionQueue = DispatchQueue(label: "eu.arinvault.binderwyrm.livescanner.vision")
    private var session: AVCaptureSession?
    private var device: AVCaptureDevice?
    private var previewView: PreviewView?
    private var running = false
    private var busy = false
    private var lastAnalyzedAt = Date.distantPast
    // ~4 frames a second; Vision's accurate mode takes a few hundred ms per
    // 1080p frame, so asking more often would only queue work up.
    private let minInterval: TimeInterval = 0.1
    private var restoreBackground: UIColor?

    // MARK: permissions

    private func cameraState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["camera": cameraState()])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { _ in
            call.resolve(["camera": self.cameraState()])
        }
    }

    // MARK: start / stop

    @objc func start(_ call: CAPPluginCall) {
        if let hex = call.getString("backgroundColor") {
            restoreBackground = UIColor(bwHex: hex)
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCamera(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    self.startCamera(call)
                } else {
                    call.reject("Camera permission was denied", "PERMISSION_DENIED")
                }
            }
        default:
            call.reject("Camera permission was denied", "PERMISSION_DENIED")
        }
    }

    private func startCamera(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.session != nil {
                call.resolve()
                return
            }
            guard let webView = self.webView, let container = webView.superview else {
                call.reject("No web view to attach the camera to", "CAMERA_FAILED")
                return
            }
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
                  let input = try? AVCaptureDeviceInput(device: device) else {
                call.reject("No camera available", "CAMERA_FAILED")
                return
            }

            let session = AVCaptureSession()
            session.beginConfiguration()
            // 1080p: the collector line is some of the smallest print on a card.
            if session.canSetSessionPreset(.hd1920x1080) {
                session.sessionPreset = .hd1920x1080
            }
            guard session.canAddInput(input) else {
                call.reject("Couldn't use the camera", "CAMERA_FAILED")
                return
            }
            session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(self, queue: self.visionQueue)
            guard session.canAddOutput(output) else {
                call.reject("Couldn't read from the camera", "CAMERA_FAILED")
                return
            }
            session.addOutput(output)
            session.commitConfiguration()

            // Cards are held close: keep refocusing, and tell the lens to
            // favour near subjects where the hardware supports it.
            if (try? device.lockForConfiguration()) != nil {
                if device.isFocusModeSupported(.continuousAutoFocus) {
                    device.focusMode = .continuousAutoFocus
                }
                if device.isAutoFocusRangeRestrictionSupported {
                    device.autoFocusRangeRestriction = .near
                }
                device.unlockForConfiguration()
            }

            let preview = PreviewView(frame: container.bounds)
            preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            preview.previewLayer.session = session
            preview.previewLayer.videoGravity = .resizeAspectFill
            container.insertSubview(preview, belowSubview: webView)

            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear

            self.session = session
            self.device = device
            self.previewView = preview
            self.running = true
            // startRunning() blocks until the camera is up — never on main.
            self.sessionQueue.async {
                session.startRunning()
                call.resolve()
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        running = false
        let session = self.session
        self.session = nil
        sessionQueue.async {
            session?.stopRunning()
        }
        DispatchQueue.main.async {
            self.setTorchMode(false)
            self.device = nil
            self.previewView?.removeFromSuperview()
            self.previewView = nil
            if let webView = self.webView {
                let bg = self.restoreBackground ?? .black
                webView.isOpaque = true
                webView.backgroundColor = bg
                webView.scrollView.backgroundColor = bg
            }
            call.resolve()
        }
    }

    // MARK: torch / focus

    private func setTorchMode(_ on: Bool) {
        guard let device = device, device.hasTorch, (try? device.lockForConfiguration()) != nil else { return }
        device.torchMode = on ? .on : .off
        device.unlockForConfiguration()
    }

    @objc func setTorch(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            guard let device = self.device, device.hasTorch else {
                call.reject("No flashlight available", "NO_TORCH")
                return
            }
            self.setTorchMode(enabled)
            call.resolve()
        }
    }

    @objc func focus(_ call: CAPPluginCall) {
        guard let x = call.getDouble("x"), let y = call.getDouble("y") else {
            call.reject("x and y are required")
            return
        }
        DispatchQueue.main.async {
            guard let device = self.device, let preview = self.previewView else {
                call.resolve()
                return
            }
            let layerPoint = CGPoint(x: x * Double(preview.bounds.width), y: y * Double(preview.bounds.height))
            let point = preview.previewLayer.captureDevicePointConverted(fromLayerPoint: layerPoint)
            if (try? device.lockForConfiguration()) != nil {
                if device.isFocusPointOfInterestSupported {
                    device.focusPointOfInterest = point
                    device.focusMode = .autoFocus
                }
                if device.isExposurePointOfInterestSupported {
                    device.exposurePointOfInterest = point
                    device.exposureMode = .autoExpose
                }
                device.unlockForConfiguration()
            }
            // Back to continuous focus once that point has settled.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                guard let device = self.device, (try? device.lockForConfiguration()) != nil else { return }
                if device.isFocusModeSupported(.continuousAutoFocus) {
                    device.focusMode = .continuousAutoFocus
                }
                device.unlockForConfiguration()
            }
            call.resolve()
        }
    }

    // MARK: recognition

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = Date()
        guard running, !busy, now.timeIntervalSince(lastAnalyzedAt) >= minInterval,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        busy = true
        lastAnalyzedAt = now

        // The back camera's buffers are landscape; the app is held upright.
        // `.right` makes Vision read the frame the way it's shown on screen,
        // and its boxes come back in that upright frame.
        let bufferWidth = CVPixelBufferGetWidth(pixelBuffer)
        let bufferHeight = CVPixelBufferGetHeight(pixelBuffer)
        let uprightWidth = min(bufferWidth, bufferHeight)
        let uprightHeight = max(bufferWidth, bufferHeight)

        let request = VNRecognizeTextRequest { [weak self] request, _ in
            guard let self = self else { return }
            defer { self.busy = false }
            guard self.running, let observations = request.results as? [VNRecognizedTextObservation] else { return }
            var lines: [[String: Any]] = []
            for observation in observations {
                guard let candidate = observation.topCandidates(1).first else { continue }
                // Vision: normalised, origin bottom-left. JS wants top-left.
                let box = observation.boundingBox
                lines.append([
                    "text": candidate.string,
                    "left": Double(box.minX),
                    "right": Double(box.maxX),
                    "top": Double(1 - box.maxY),
                    "bottom": Double(1 - box.minY)
                ])
            }
            self.notifyListeners("textRecognized", data: [
                "frameWidth": Int(uprightWidth),
                "frameHeight": Int(uprightHeight),
                "lines": lines
            ])
        }
        request.recognitionLevel = .accurate
        // Set codes and collector numbers aren't words: autocorrect only
        // "fixes" FDN into something English.
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["en-US"]

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])
        do {
            try handler.perform([request])
        } catch {
            busy = false
        }
    }
}

private extension UIColor {
    /// "#RRGGBB" → UIColor; nil for anything else.
    convenience init?(bwHex: String) {
        var s = bwHex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }
}
