package eu.arinvault.binderwyrm.livescanner;

import android.Manifest;
import android.graphics.Color;
import android.graphics.Rect;
import android.media.Image;
import android.os.SystemClock;
import android.util.Size;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.MeteringPoint;
import androidx.camera.core.Preview;
import androidx.camera.core.resolutionselector.AspectRatioStrategy;
import androidx.camera.core.resolutionselector.ResolutionSelector;
import androidx.camera.core.resolutionselector.ResolutionStrategy;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Live card scanner for Binderwyrm.
 *
 * The camera preview is a native view placed BEHIND the Capacitor WebView,
 * and the WebView is made transparent while scanning — so the app's own
 * React UI (guide frame, status, buttons) draws on top of a real, full-speed
 * camera feed. Frames go to ML Kit's on-device text recogniser a few times a
 * second, and every recognised line is sent to JavaScript as a
 * "textRecognized" event. Deciding what a collector number looks like stays
 * in JS (src/lib/ocr.js parseCollectorLine), shared with the web scanner.
 */
@CapacitorPlugin(name = "LiveScanner", permissions = { @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }) })
public class LiveScannerPlugin extends Plugin {

    private static final String TAG = "LiveScanner";
    // How often a frame is handed to the recogniser. ML Kit takes ~50-200 ms
    // per 1080p frame on current phones; this keeps the phone cool and the
    // event stream readable without making the scanner feel laggy.
    private static final long MIN_INTERVAL_MS = 80;

    private PreviewView previewView;
    private ProcessCameraProvider cameraProvider;
    private Camera camera;
    private ExecutorService analysisExecutor;
    private TextRecognizer recognizer;
    private volatile boolean running = false;
    private long lastAnalyzedAt = 0;
    private int restoreBackground = Color.BLACK;

    @Override
    public void load() {
        analysisExecutor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String bg = call.getString("backgroundColor");
        if (bg != null) {
            try {
                restoreBackground = Color.parseColor(bg);
            } catch (IllegalArgumentException e) {
                Logger.warn(TAG, "Ignoring backgroundColor " + bg);
            }
        }
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermsCallback");
            return;
        }
        startCamera(call);
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            startCamera(call);
        } else {
            call.reject("Camera permission was denied", "PERMISSION_DENIED");
        }
    }

    private void startCamera(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                try {
                    if (previewView == null) {
                        WebView webView = getBridge().getWebView();
                        ViewGroup parent = (ViewGroup) webView.getParent();
                        previewView = new PreviewView(getContext());
                        // TextureView-backed: composes correctly underneath a
                        // transparent WebView on every device, unlike the
                        // SurfaceView the default "performance" mode may pick.
                        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
                        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
                        parent.addView(
                            previewView,
                            parent.indexOfChild(webView),
                            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                        );
                        webView.setBackgroundColor(Color.TRANSPARENT);
                    }
                    ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(getContext());
                    future.addListener(
                        () -> {
                            try {
                                cameraProvider = future.get();
                                bindUseCases();
                                running = true;
                                call.resolve();
                            } catch (Exception e) {
                                Logger.error(TAG, "Camera start failed", e);
                                teardown();
                                call.reject("Couldn't start the camera: " + e.getMessage(), "CAMERA_FAILED", e);
                            }
                        },
                        ContextCompat.getMainExecutor(getContext())
                    );
                } catch (Exception e) {
                    Logger.error(TAG, "Camera start failed", e);
                    teardown();
                    call.reject("Couldn't start the camera: " + e.getMessage(), "CAMERA_FAILED", e);
                }
            });
    }

    private void bindUseCases() {
        // Preview and analysis share one aspect ratio so what the recogniser
        // sees is what's on screen (JS maps boxes to the screen assuming a
        // centre crop of the same frame).
        AspectRatioStrategy ratio = AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY;
        Preview preview = new Preview.Builder().setResolutionSelector(new ResolutionSelector.Builder().setAspectRatioStrategy(ratio).build()).build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        // 1080p: the collector line is some of the smallest print on a card,
        // and ML Kit wants roughly 16px+ per character to read it.
        ResolutionSelector analysisRes = new ResolutionSelector.Builder()
            .setAspectRatioStrategy(ratio)
            .setResolutionStrategy(new ResolutionStrategy(new Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
            .build();
        ImageAnalysis analysis = new ImageAnalysis.Builder()
            .setResolutionSelector(analysisRes)
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build();
        analysis.setAnalyzer(analysisExecutor, this::analyze);

        cameraProvider.unbindAll();
        camera = cameraProvider.bindToLifecycle(getActivity(), CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyze(@NonNull ImageProxy imageProxy) {
        long now = SystemClock.elapsedRealtime();
        Image media = imageProxy.getImage();
        if (!running || media == null || now - lastAnalyzedAt < MIN_INTERVAL_MS) {
            imageProxy.close();
            return;
        }
        lastAnalyzedAt = now;
        int rotation = imageProxy.getImageInfo().getRotationDegrees();
        // ML Kit reports boxes in the UPRIGHT image (rotation applied), so the
        // frame size sent along must be the upright one too.
        final int w = rotation % 180 == 0 ? imageProxy.getWidth() : imageProxy.getHeight();
        final int h = rotation % 180 == 0 ? imageProxy.getHeight() : imageProxy.getWidth();
        InputImage input = InputImage.fromMediaImage(media, rotation);
        recognizer
            .process(input)
            .addOnSuccessListener((text) -> emit(text, w, h, now))
            .addOnFailureListener((e) -> Logger.error(TAG, "Recognition failed", e))
            .addOnCompleteListener((task) -> imageProxy.close());
    }

    private void emit(Text text, int w, int h, long startedAt) {
        if (!running) return;
        JSArray lines = new JSArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                Rect box = line.getBoundingBox();
                if (box == null) continue;
                JSObject l = new JSObject();
                l.put("text", line.getText());
                l.put("left", box.left / (double) w);
                l.put("top", box.top / (double) h);
                l.put("right", box.right / (double) w);
                l.put("bottom", box.bottom / (double) h);
                lines.put(l);
            }
        }
        JSObject data = new JSObject();
        data.put("frameWidth", w);
        data.put("frameHeight", h);
        data.put("ms", SystemClock.elapsedRealtime() - startedAt);
        data.put("lines", lines);
        notifyListeners("textRecognized", data);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity()
            .runOnUiThread(() -> {
                teardown();
                call.resolve();
            });
    }

    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity()
            .runOnUiThread(() -> {
                if (camera == null || !camera.getCameraInfo().hasFlashUnit()) {
                    call.reject("No flashlight available", "NO_TORCH");
                    return;
                }
                camera.getCameraControl().enableTorch(enabled);
                call.resolve();
            });
    }

    @PluginMethod
    public void focus(PluginCall call) {
        Double x = call.getDouble("x");
        Double y = call.getDouble("y");
        if (x == null || y == null) {
            call.reject("x and y are required");
            return;
        }
        getActivity()
            .runOnUiThread(() -> {
                if (camera == null || previewView == null) {
                    call.resolve();
                    return;
                }
                MeteringPoint point = previewView
                    .getMeteringPointFactory()
                    .createPoint((float) (x * previewView.getWidth()), (float) (y * previewView.getHeight()));
                FocusMeteringAction action = new FocusMeteringAction.Builder(point).setAutoCancelDuration(3, TimeUnit.SECONDS).build();
                camera.getCameraControl().startFocusAndMetering(action);
                call.resolve();
            });
    }

    // Must run on the UI thread.
    private void teardown() {
        running = false;
        if (cameraProvider != null) cameraProvider.unbindAll();
        camera = null;
        if (previewView != null) {
            ViewGroup parent = (ViewGroup) previewView.getParent();
            if (parent != null) parent.removeView(previewView);
            previewView = null;
        }
        WebView webView = getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(restoreBackground);
    }

    @Override
    protected void handleOnDestroy() {
        running = false;
        if (analysisExecutor != null) analysisExecutor.shutdown();
        if (recognizer != null) recognizer.close();
        super.handleOnDestroy();
    }
}
