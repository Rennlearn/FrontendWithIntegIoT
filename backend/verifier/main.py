from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from io import BytesIO
import json
import os
import time
from pathlib import Path

# Mock verifier mode flag - when true, skip heavy ML imports and return deterministic responses
MOCK_VERIFIER = str(os.environ.get('MOCK_VERIFIER', '')).lower() in ('1', 'true', 'yes')

# Conditional heavy imports (skip when MOCK_VERIFIER to make CI lightweight)
if not MOCK_VERIFIER:
    from PIL import Image
    import pickle
    import cv2
    import numpy as np
    from ultralytics import YOLO
    from sklearn.neighbors import KNeighborsClassifier
else:
    # Provide light fallback types in mock mode
    Image = None
    np = None
    cv2 = None
    YOLO = None
    KNeighborsClassifier = None
    pickle = None

app = FastAPI(title="PillNow Verifier", version="0.1.0")

# Load models on startup
MODEL_DIR = Path(__file__).parent / "models"
YOLO_MODEL_PATH = MODEL_DIR / "best_new.pt"
KNN_MODEL_PATH = MODEL_DIR / "knn_pills_2.pkl"

yolo_model = None
knn_model = None
knn_scaler = None  # Feature scaler if KNN model uses one

@app.on_event("startup")
async def load_models():
    """Load YOLOv8 and KNN models on server startup (skipped in MOCK mode)"""
    global yolo_model, knn_model, knn_scaler
    if MOCK_VERIFIER:
        print("⚡ MOCK_VERIFIER enabled — skipping heavy model loads")
        yolo_model = None
        knn_model = None
        knn_scaler = None
        return

    try:
        # Load YOLOv8 model
        if YOLO_MODEL_PATH.exists():
            print(f"Loading YOLOv8 model from {YOLO_MODEL_PATH}")
            yolo_model = YOLO(str(YOLO_MODEL_PATH))
            print("YOLOv8 model loaded successfully")
        else:
            print(f"Warning: YOLOv8 model not found at {YOLO_MODEL_PATH}")
            
        # Load KNN classifier - DISABLED FOR TESTING (YOLO only)
        # KNN verification is disabled to test YOLO-only performance
        knn_model = None
        knn_scaler = None
        print("KNN model loading disabled - using YOLO only for testing")
        # if KNN_MODEL_PATH.exists():
        #     print(f"Loading KNN model from {KNN_MODEL_PATH}")
        #     try:
        #         # Some sklearn artifacts are saved with joblib, others with raw pickle.
        #         # Your `knn_pills_2.pkl` loads via joblib but fails with pickle.
        #         knn_data = None
        #         try:
        #             with open(KNN_MODEL_PATH, 'rb') as f:
        #                 knn_data = pickle.load(f)
        #         except Exception as pickle_err:
        #             try:
        #                 import joblib  # type: ignore
        #                 knn_data = joblib.load(str(KNN_MODEL_PATH))
        #                 print(f"KNN model loaded via joblib (pickle failed: {pickle_err})")
        #             except Exception as joblib_err:
        #                 raise Exception(f"Failed to load KNN model. pickle_err={pickle_err} joblib_err={joblib_err}")
        #
        #             # Handle different KNN model formats
        #             if isinstance(knn_data, dict):
        #                 knn_model = knn_data.get('model') or knn_data.get('classifier') or knn_data.get('knn')
        #                 knn_scaler = knn_data.get('scaler') or knn_data.get('feature_scaler')
        #                 print(f"KNN model loaded: {type(knn_model)}")
        #                 if knn_scaler:
        #                     print("KNN scaler loaded")
        #             elif hasattr(knn_data, 'predict'):  # Direct KNN model
        #                 knn_model = knn_data
        #                 print("KNN model loaded (direct)")
        #             else:
        #                 print(f"Warning: Unknown KNN model format: {type(knn_data)}")
        #                 knn_model = None
        #     except Exception as e:
        #         print(f"Error loading KNN model: {e}")
        #         knn_model = None
        # else:
        #     print(f"Warning: KNN model not found at {KNN_MODEL_PATH}")
            
    except Exception as e:
        print(f"Error loading models: {e}")
        print("Server will start but verification may not work properly")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def extract_pill_features(pill_roi: np.ndarray) -> Optional[np.ndarray]:
    """
    Extract features from a pill region for KNN classification.
    Features include: color (mean RGB), shape (aspect ratio, area), texture (variance)
    """
    try:
        # Be permissive: ESP32-CAM images can be blurry and YOLO boxes can be tight.
        # If ROI is tiny, we can still extract coarse color/texture features after resizing.
        if pill_roi.size == 0:
            return None

        # Ensure 3-channel BGR
        if len(pill_roi.shape) == 2:
            pill_roi = cv2.cvtColor(pill_roi, cv2.COLOR_GRAY2BGR)
        elif pill_roi.shape[2] == 4:
            pill_roi = cv2.cvtColor(pill_roi, cv2.COLOR_BGRA2BGR)

        h0, w0 = pill_roi.shape[:2]
        # If ROI is extremely small, upsample it so feature extraction is stable.
        if h0 < 10 or w0 < 10:
            target = 32
            pill_roi = cv2.resize(pill_roi, (target, target), interpolation=cv2.INTER_LINEAR)

        # Some trained KNN models expect a very high-dimensional feature vector.
        # Your current `knn_pills_2.pkl` expects 2051 features (StandardScaler n_features_in_ = 2051).
        # We support that by building:
        #  - 3 color means (BGR)
        #  - 2048 grayscale pixels from a fixed 32x64 resize (32*64=2048)
        # Total = 2051 features.
        expected_dim = None
        try:
            if 'knn_scaler' in globals() and knn_scaler is not None and hasattr(knn_scaler, 'n_features_in_'):
                expected_dim = int(getattr(knn_scaler, 'n_features_in_', 0) or 0)
            elif 'knn_model' in globals() and knn_model is not None and hasattr(knn_model, 'n_features_in_'):
                expected_dim = int(getattr(knn_model, 'n_features_in_', 0) or 0)
        except Exception:
            expected_dim = None

        if expected_dim and expected_dim >= 1000:
            # High-dimensional feature mode (2051)
            mean_bgr = np.mean(pill_roi.reshape(-1, 3), axis=0).astype(np.float32)  # 3
            gray = cv2.cvtColor(pill_roi, cv2.COLOR_BGR2GRAY)
            gray_rs = cv2.resize(gray, (64, 32), interpolation=cv2.INTER_LINEAR)  # (h=32,w=64) => 2048
            flat = (gray_rs.reshape(-1).astype(np.float32) / 255.0)  # 2048
            feats = np.concatenate([mean_bgr, flat], axis=0)  # 2051
            # If model expects a slightly different dim, pad/trim.
            if feats.shape[0] != expected_dim:
                if feats.shape[0] > expected_dim:
                    feats = feats[:expected_dim]
                else:
                    feats = np.pad(feats, (0, expected_dim - feats.shape[0]), mode='constant')
            return feats.astype(np.float32)
        
        features = []
        
        # 1. Color features (mean RGB values)
        mean_bgr = np.mean(pill_roi.reshape(-1, 3), axis=0)
        features.extend(mean_bgr.tolist())  # B, G, R
        
        # 2. Color variance (texture indicator)
        std_bgr = np.std(pill_roi.reshape(-1, 3), axis=0)
        features.extend(std_bgr.tolist())  # B, G, R std
        
        # 3. Shape features
        height, width = pill_roi.shape[:2]
        aspect_ratio = width / height if height > 0 else 1.0
        area = width * height
        features.append(aspect_ratio)
        features.append(area)
        
        # 4. Color histogram features (dominant colors)
        # Convert to HSV for better color analysis
        hsv = cv2.cvtColor(pill_roi, cv2.COLOR_BGR2HSV)
        h_mean = np.mean(hsv[:, :, 0])
        s_mean = np.mean(hsv[:, :, 1])
        v_mean = np.mean(hsv[:, :, 2])
        features.extend([h_mean, s_mean, v_mean])
        
        # 5. Edge features (texture)
        gray = cv2.cvtColor(pill_roi, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)
        edge_density = np.sum(edges > 0) / (width * height) if (width * height) > 0 else 0
        features.append(edge_density)
        
        # 6. Additional texture features (local binary pattern approximation)
        # Simple variance of gray values as texture measure
        gray_variance = np.var(gray)
        features.append(gray_variance)
        
        # Total: 3 (BGR mean) + 3 (BGR std) + 2 (shape) + 3 (HSV) + 2 (texture) = 13 features
        return np.array(features, dtype=np.float32)
        
    except Exception as e:
        print(f"[KNN DEBUG] Error extracting features: {e}")
        return None


class ClassCount(BaseModel):
    label: str
    n: int


class VerifyResponse(BaseModel):
    pass_: bool
    count: int
    classesDetected: List[ClassCount]
    confidence: float
    annotatedImagePath: Optional[str] = None
    knnVerification: Optional[Dict[str, Any]] = None  # KNN verification results


@app.post("/verify", response_model=VerifyResponse)
async def verify(image: UploadFile = File(...), expected: str = Form("{}")):
    try:
        expected_obj: Dict[str, Any] = json.loads(expected) if expected else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="expected must be JSON string")

    # Load image into memory
    content = await image.read()
    try:
        img_pil = Image.open(BytesIO(content)).convert("RGB")
        # Convert PIL to OpenCV format (numpy array)
        img_np = np.array(img_pil)
        img_cv = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid image: {str(e)}")

    # Get expected count from request
    expected_count = 0
    expected_label = None
    if isinstance(expected_obj, dict) and "count" in expected_obj:
        try:
            expected_count = int(expected_obj["count"])
        except Exception:
            expected_count = 0
    # Optional expected pill label/type (use any of these keys)
    print(f"[YOLO DEBUG] Raw expected_obj: {expected_obj}")
    if isinstance(expected_obj, dict):
        expected_label = expected_obj.get("label") or expected_obj.get("pill") or expected_obj.get("pillType") or expected_obj.get("pill_name")
        print(f"[YOLO DEBUG] Extracted expected_label (before processing): {expected_label}")
        if expected_label:
            expected_label_original = str(expected_label).strip()
            expected_label = expected_label_original.lower()
            print(f"[YOLO DEBUG] ✅ Expected pill label received: '{expected_label_original}' -> normalized to: '{expected_label}'")
        else:
            print(f"[YOLO DEBUG] ⚠️ No expected label found in expected_obj. Keys available: {list(expected_obj.keys())}")
    else:
        print(f"[YOLO DEBUG] ⚠️ expected_obj is not a dict, type: {type(expected_obj)}")

    # Mock verifier mode: return deterministic, fast response for CI and local dev
    if MOCK_VERIFIER:
        cnt = expected_count if (isinstance(expected_count, int) and expected_count > 0) else 1
        classes = []
        if expected_label:
            classes.append(ClassCount(label=expected_label, n=cnt))
        else:
            classes.append(ClassCount(label="pill_mock", n=cnt))

        knn_verification_data = {
            'enabled': False,
            'attempted': 0,
            'successful': 0,
            'total_verified': 0,
            'yolo_knn_matches': 0,
            'yolo_knn_match_rate': 0,
            'expected_matches': cnt if expected_label else 0,
            'expected_match_rate': 1.0 if expected_label else 0.0,
            'foreign_pills_detected': 0,
            'foreign_pills': [],
            'results': []
        }

        return VerifyResponse(
            pass_=True,
            count=cnt,
            classesDetected=classes,
            confidence=0.95,
            annotatedImagePath=None,
            knnVerification=knn_verification_data,
        )

    # Run inference with YOLOv8 model
    detected_classes: List[ClassCount] = []
    detected_count = 0
    confidence = 0.0
    pass_ = False

    try:
        if yolo_model is None:
            raise Exception("YOLOv8 model not loaded")
        
        # Debug: Print model class names
        if hasattr(yolo_model, 'names'):
            print(f"[YOLO DEBUG] Model classes: {yolo_model.names}")
        
        # Run YOLOv8 detection with optimized parameters for precision and accuracy
        # conf: confidence threshold (0.3 = balanced precision/recall)
        # iou: IoU threshold for NMS (0.45 = standard, helps remove overlapping detections)
        # verbose: print detailed detection info
        results = yolo_model(img_cv, conf=0.3, iou=0.45, verbose=True)
        
        # Process detection results and filter duplicates
        all_detections: List[Dict[str, Any]] = []
        
        print(f"[YOLO DEBUG] Number of result objects: {len(results)}")
        
        for result in results:
            boxes = result.boxes
            print(f"[YOLO DEBUG] Boxes object: {boxes}")
            if boxes is not None:
                print(f"[YOLO DEBUG] Number of boxes: {len(boxes)}")
                for box in boxes:
                    # Get class ID and confidence
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(float)
                    
                    # Get class name from model
                    class_name = result.names[cls_id] if hasattr(result, 'names') else f"pill_{cls_id}"
                    
                    print(f"[YOLO DEBUG] Detected: class={class_name} (id={cls_id}), confidence={conf:.3f}, box=({x1:.1f},{y1:.1f},{x2:.1f},{y2:.1f})")
                    
                    all_detections.append({
                        'class_name': class_name,
                        'confidence': conf,
                        'box': (x1, y1, x2, y2),
                        'area': (x2 - x1) * (y2 - y1)
                    })
            else:
                print(f"[YOLO DEBUG] No boxes found in result")
        
        # Filter overlapping detections (likely duplicates of the same pill)
        def calculate_iou(box1, box2):
            """Calculate Intersection over Union (IoU) of two boxes"""
            x1_1, y1_1, x2_1, y2_1 = box1
            x1_2, y1_2, x2_2, y2_2 = box2
            
            # Calculate intersection
            x1_i = max(x1_1, x1_2)
            y1_i = max(y1_1, y1_2)
            x2_i = min(x2_1, x2_2)
            y2_i = min(y2_1, y2_2)
            
            if x2_i <= x1_i or y2_i <= y1_i:
                return 0.0
            
            intersection = (x2_i - x1_i) * (y2_i - y1_i)
            area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
            area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
            union = area1 + area2 - intersection
            
            return intersection / union if union > 0 else 0.0
        
        # Sort by confidence (highest first)
        all_detections.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Remove overlapping detections (keep highest confidence)
        filtered_detections = []
        for det in all_detections:
            is_duplicate = False
            for existing in filtered_detections:
                iou = calculate_iou(det['box'], existing['box'])
                if iou > 0.5:  # If boxes overlap more than 50%, consider it a duplicate
                    print(f"[YOLO DEBUG] Filtering duplicate: {det['class_name']} (conf={det['confidence']:.3f}) overlaps with {existing['class_name']} (conf={existing['confidence']:.3f}), IoU={iou:.3f}")
                    is_duplicate = True
                    break
            if not is_duplicate:
                filtered_detections.append(det)
        
        print(f"[YOLO DEBUG] Filtered from {len(all_detections)} to {len(filtered_detections)} detections")
        
        # Count detections by class after filtering
        detections_by_class: Dict[str, int] = {}
        all_confidences: List[float] = []
        
        for det in filtered_detections:
            class_name = det['class_name']
            conf = det['confidence']
            all_confidences.append(conf)
            
            if class_name in detections_by_class:
                detections_by_class[class_name] += 1
            else:
                detections_by_class[class_name] = 1
        
        print(f"[YOLO DEBUG] Total detections after filtering: {sum(detections_by_class.values())}")
        print(f"[YOLO DEBUG] Detections by class: {detections_by_class}")
        
        # Convert to ClassCount format
        detected_count = sum(detections_by_class.values())
        for label, count in detections_by_class.items():
            detected_classes.append(ClassCount(label=label, n=count))
            print(f"[YOLO DEBUG] Detected class: '{label}' (count: {count})")
        
        # Calculate average confidence
        confidence = np.mean(all_confidences) if all_confidences else 0.0
        print(f"[YOLO DEBUG] Average confidence: {confidence:.3f}")
        
        # Draw bounding boxes and labels on the image (using filtered detections)
        annotated_img = img_cv.copy()
        # Track count per class for labeling
        class_counts = {}
        for det in filtered_detections:
            x1, y1, x2, y2 = [int(coord) for coord in det['box']]
            class_name = det['class_name']
            conf = det['confidence']
            
            # Count occurrences of this class
            if class_name not in class_counts:
                class_counts[class_name] = 0
            class_counts[class_name] += 1
            current_count = class_counts[class_name]
            
            # Draw bounding box
            cv2.rectangle(annotated_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
            
            # Prepare label text with count
            label = f"{class_name} ({current_count}) {conf:.2f}"
            
            # Get text size for background
            (text_width, text_height), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            
            # Draw label background
            cv2.rectangle(annotated_img, (x1, y1 - text_height - 10), (x1 + text_width, y1), (0, 255, 0), -1)
            
            # Draw label text
            cv2.putText(annotated_img, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
        
        # Add total count text at top of image
        if detected_count > 0:
            total_text = f"Total Pills: {detected_count}"
            (total_text_width, total_text_height), _ = cv2.getTextSize(total_text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
            # Draw background for total count
            cv2.rectangle(annotated_img, (10, 10), (20 + total_text_width, 30 + total_text_height), (0, 255, 0), -1)
            # Draw total count text
            cv2.putText(annotated_img, total_text, (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        
        # Save annotated image to backend captures directory
        annotated_path = None
        try:
            # Save to backend/captures directory (one level up from verifier)
            captures_dir = Path(__file__).parent.parent / "captures"
            captures_dir.mkdir(exist_ok=True)
            annotated_filename = f"annotated_{int(time.time() * 1000)}.jpg"
            annotated_path = str(captures_dir / annotated_filename)
            cv2.imwrite(annotated_path, annotated_img)
            print(f"[YOLO DEBUG] Annotated image saved to: {annotated_path}")
        except Exception as e:
            print(f"[YOLO DEBUG] Failed to save annotated image: {e}")
        
        # Determine if verification passes
        # PillNow requirement: alert when pill TYPE is wrong OR pill COUNT is wrong.
        # IMPORTANT: If container should have ONLY one type of pill, ANY foreign pill = MISMATCH
        confidence_threshold = 0.3  # Confidence threshold for verification (matches YOLO conf parameter)
        
        # Initialize pass_ based on confidence and basic detection
        pass_ = detected_count > 0 and confidence >= confidence_threshold
        
        # Pill type + count validation
        if expected_label:
            detected_labels = {c.label.lower() for c in detected_classes}
            # Get count of expected type pills vs foreign type pills
            expected_type_count = sum(c.n for c in detected_classes if c.label.lower() == expected_label)
            foreign_type_count = sum(c.n for c in detected_classes if c.label.lower() != expected_label)
            foreign_types = [c.label for c in detected_classes if c.label.lower() != expected_label]
            
            print(f"[YOLO DEBUG] ========== PILL TYPE CHECK ==========")
            print(f"   Expected label (lowercase): '{expected_label}'")
            print(f"   Expected count: {expected_count}")
            print(f"   Detected labels (lowercase): {detected_labels}")
            print(f"   Detected classes: {[(c.label, c.n) for c in detected_classes]}")
            print(f"   Pills of expected type: {expected_type_count}")
            print(f"   Foreign pills detected: {foreign_type_count} ({foreign_types})")
            
            # Check 1: No foreign pill types allowed in container
            has_foreign_pills = foreign_type_count > 0
            
            # Check 2: Expected pill type must exist
            has_expected_type = expected_label in detected_labels
            
            # Check 3: Count of expected type pills should match (if count specified)
            count_match = (expected_type_count == expected_count) if expected_count > 0 else True

            if has_foreign_pills:
                print(f"[YOLO DEBUG] ❌❌❌ FOREIGN PILL TYPE DETECTED ❌❌❌")
                print(f"   Container should only have '{expected_label}'")
                print(f"   But found foreign pills: {foreign_types} (count: {foreign_type_count})")
                print(f"   This is a MISMATCH - wrong pill in container!")
                pass_ = False  # Foreign pill type = fail, trigger alert
            elif not has_expected_type:
                print(f"[YOLO DEBUG] ❌❌❌ EXPECTED PILL TYPE NOT FOUND ❌❌❌")
                print(f"   Expected '{expected_label}' but got {detected_labels}")
                print(f"   Setting pass_ = False (will trigger buzzer alarm)")
                pass_ = False  # Expected pill type not found = fail
            elif not count_match:
                print(f"[YOLO DEBUG] ❌❌❌ PILL COUNT MISMATCH ❌❌❌")
                print(f"   Expected {expected_count} x '{expected_label}' but detected {expected_type_count}")
                print(f"   Setting pass_ = False (will trigger buzzer alarm)")
                pass_ = False  # Wrong count = fail, trigger alert
            else:
                print(f"[YOLO DEBUG] ✅✅✅ PILL TYPE + COUNT MATCH ✅✅✅")
                print(f"   Expected '{expected_label}' x {expected_count} - VERIFIED")
                print(f"   No foreign pills detected")
                pass_ = True
        else:
            # No expected label provided - use count/confidence check
            print(f"[YOLO DEBUG] No expected label provided - using count/confidence check")
            count_match = (detected_count == expected_count) if expected_count > 0 else True
            pass_ = count_match and confidence >= confidence_threshold
            print(f"[YOLO DEBUG] Count/confidence check: count_match={count_match}, confidence={confidence:.2f}")
        
        print(f"[YOLO DEBUG] ========== FINAL RESULT ==========")
        print(f"   pass_ = {pass_}")
        print(f"   detected_count = {detected_count}")
        print(f"   expected_count = {expected_count}")
        print(f"   confidence = {confidence:.2f}")
        print(f"   ==========================================")
        
        # KNN verification: DISABLED FOR TESTING (YOLO only)
        # KNN verification is disabled to test YOLO-only performance
        knn_verification_results = []
        knn_foreign_pills = []
        knn_attempted = 0
        knn_successful = 0
        
        # Skip KNN verification - using YOLO only
        print("[KNN DEBUG] KNN verification disabled - using YOLO only for testing")
        
        if False and knn_model is not None and len(filtered_detections) > 0:  # Disabled
            print(f"[KNN DEBUG] ========== KNN VERIFICATION ==========")
            print(f"[KNN DEBUG] Expected pill type: '{expected_label or 'any'}'")
            try:
                for i, det in enumerate(filtered_detections):
                    x1, y1, x2, y2 = det['box']
                    # Extract pill region (robust crop with padding + bounds clamp)
                    ih, iw = img_cv.shape[:2]
                    pad = 6  # pixels of padding around YOLO box to preserve pill edges
                    x1i = max(0, int(x1) - pad)
                    y1i = max(0, int(y1) - pad)
                    x2i = min(iw, int(x2) + pad)
                    y2i = min(ih, int(y2) + pad)
                    knn_attempted += 1
                    if x2i <= x1i or y2i <= y1i:
                        print(f"[KNN DEBUG] Skipping invalid ROI for detection {i}: ({x1i},{y1i})-({x2i},{y2i})")
                        knn_verification_results.append({
                            'detection_index': i,
                            'yolo_class': det.get('class_name'),
                            'yolo_confidence': det.get('confidence'),
                            'knn_class': None,
                            'knn_confidence': 0.0,
                            'matches_yolo': False,
                            'matches_expected': False if expected_label else True,
                            'status': 'skipped_invalid_roi',
                        })
                        continue
                    pill_roi = img_cv[y1i:y2i, x1i:x2i]
                    
                    if pill_roi.size == 0:
                        print(f"[KNN DEBUG] Skipping empty ROI for detection {i}")
                        knn_verification_results.append({
                            'detection_index': i,
                            'yolo_class': det.get('class_name'),
                            'yolo_confidence': det.get('confidence'),
                            'knn_class': None,
                            'knn_confidence': 0.0,
                            'matches_yolo': False,
                            'matches_expected': False if expected_label else True,
                            'status': 'skipped_empty_roi',
                        })
                        continue
                    
                    # Extract features from pill region
                    features = extract_pill_features(pill_roi)
                    if features is None:
                        print(f"[KNN DEBUG] Failed to extract features for detection {i}")
                        knn_verification_results.append({
                            'detection_index': i,
                            'yolo_class': det.get('class_name'),
                            'yolo_confidence': det.get('confidence'),
                            'knn_class': None,
                            'knn_confidence': 0.0,
                            'matches_yolo': False,
                            'matches_expected': False if expected_label else True,
                            'status': 'feature_extract_failed',
                        })
                        continue
                    
                    # Scale features if scaler is available
                    if knn_scaler is not None:
                        features = knn_scaler.transform([features])[0]
                    
                    # Predict with KNN
                    try:
                        knn_prediction = knn_model.predict([features])[0]
                        knn_class = str(knn_prediction).lower()
                        knn_proba = None
                        max_proba = 0.5
                        
                        if hasattr(knn_model, 'predict_proba'):
                            knn_proba = knn_model.predict_proba([features])[0]
                            max_proba = np.max(knn_proba)
                        
                        # Check if this pill matches expected type
                        matches_expected = (knn_class == expected_label) if expected_label else True
                        matches_yolo = det['class_name'].lower() == knn_class
                        
                        print(f"[KNN DEBUG] Pill {i+1}: YOLO='{det['class_name']}' KNN='{knn_class}' (conf: {max_proba:.2f}) " +
                              f"{'✅ matches expected' if matches_expected else '❌ FOREIGN PILL!'}")
                        
                        knn_verification_results.append({
                            'detection_index': i,
                            'yolo_class': det['class_name'],
                            'yolo_confidence': det['confidence'],
                            'knn_class': knn_class,
                            'knn_confidence': float(max_proba),
                            'matches_yolo': matches_yolo,
                            'matches_expected': matches_expected
                        })
                        knn_successful += 1
                        
                        # Track foreign pills (KNN says it's different from expected)
                        if expected_label and not matches_expected:
                            knn_foreign_pills.append({
                                'index': i,
                                'expected': expected_label,
                                'detected_knn': knn_class,
                                'detected_yolo': det['class_name'],
                                'confidence': max_proba
                            })
                            
                    except Exception as e:
                        print(f"[KNN DEBUG] Error during KNN prediction: {e}")
                        knn_verification_results.append({
                            'detection_index': i,
                            'yolo_class': det.get('class_name'),
                            'yolo_confidence': det.get('confidence'),
                            'knn_class': None,
                            'knn_confidence': 0.0,
                            'matches_yolo': False,
                            'matches_expected': False if expected_label else True,
                            'status': f'knn_predict_failed: {str(e)}',
                        })
                        continue
                
                # Analyze KNN results
                if knn_verification_results:
                    yolo_knn_matches = sum(1 for r in knn_verification_results if r['matches_yolo'])
                    expected_matches = sum(1 for r in knn_verification_results if r['matches_expected'])
                    total = len(knn_verification_results)
                    yolo_match_rate = yolo_knn_matches / total if total > 0 else 0
                    expected_match_rate = expected_matches / total if total > 0 else 0
                    
                    print(f"[KNN DEBUG] ========== KNN Summary ==========")
                    print(f"   ROIs attempted: {knn_attempted}")
                    print(f"   ROIs classified: {knn_successful}")
                    print(f"   Results recorded: {total}")
                    print(f"   YOLO-KNN agreement: {yolo_knn_matches}/{total} ({yolo_match_rate*100:.1f}%)")
                    if expected_label:
                        print(f"   Pills matching expected '{expected_label}': {expected_matches}/{total} ({expected_match_rate*100:.1f}%)")
                        print(f"   Foreign pills detected by KNN: {len(knn_foreign_pills)}")
                    
                    # KNN can override YOLO decision if it detects foreign pills
                    if expected_label and len(knn_foreign_pills) > 0:
                        print(f"[KNN DEBUG] ❌❌❌ KNN DETECTED FOREIGN PILLS ❌❌❌")
                        for fp in knn_foreign_pills:
                            print(f"   Pill {fp['index']+1}: Expected '{fp['expected']}' but KNN detected '{fp['detected_knn']}' (conf: {fp['confidence']:.2f})")
                        print(f"[KNN DEBUG] Setting pass_ = False due to KNN foreign pill detection")
                        pass_ = False
                    elif yolo_match_rate < 0.5:
                        # Low YOLO-KNN agreement - reduce confidence but don't fail
                        print(f"[KNN DEBUG] ⚠️ Low YOLO-KNN agreement ({yolo_match_rate*100:.1f}%) - reducing confidence")
                        confidence = confidence * 0.7
                    else:
                        print(f"[KNN DEBUG] ✅ KNN verification passed")
                        
            except Exception as e:
                print(f"[KNN DEBUG] Error during KNN verification: {e}")
                import traceback
                print(traceback.format_exc())
        # else:
        #     if knn_model is None:
        #         print(f"[KNN DEBUG] KNN model not available - using YOLO only")
        #     else:
        #         print(f"[KNN DEBUG] No detections to verify with KNN")
        
    except Exception as e:
        import traceback
        print(f"Error during inference: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        # Return failure result if inference fails
        return VerifyResponse(
            pass_=False,
            count=0,
            classesDetected=[],
            confidence=0.0,
            annotatedImagePath=None,
        )

    # Prepare KNN verification data for response
    knn_verification_data = None
    if knn_verification_results:
        expected_matches = sum(1 for r in knn_verification_results if r.get('matches_expected', True))
        yolo_matches = sum(1 for r in knn_verification_results if r.get('matches_yolo', False))
        total = len(knn_verification_results)
        
        knn_verification_data = {
            'enabled': True,
            # attempted/successful count is more meaningful than total results
            'attempted': int(knn_attempted) if 'knn_attempted' in locals() else total,
            'successful': int(knn_successful) if 'knn_successful' in locals() else 0,
            # Keep legacy key name used by app; map it to "successful" classifications
            'total_verified': int(knn_successful) if 'knn_successful' in locals() else total,
            'yolo_knn_matches': yolo_matches,
            'yolo_knn_match_rate': yolo_matches / total if total > 0 else 0,
            'expected_matches': expected_matches,
            'expected_match_rate': expected_matches / total if total > 0 else 0,
            'foreign_pills_detected': len(knn_foreign_pills) if 'knn_foreign_pills' in dir() else 0,
            'foreign_pills': knn_foreign_pills if 'knn_foreign_pills' in dir() else [],
            'results': knn_verification_results
        }
    else:
        knn_verification_data = {
            'enabled': knn_model is not None,
            'attempted': 0,
            'successful': 0,
            'total_verified': 0,
            'yolo_knn_matches': 0,
            'yolo_knn_match_rate': 0,
            'expected_matches': 0,
            'expected_match_rate': 0,
            'foreign_pills_detected': 0,
            'foreign_pills': [],
            'results': []
        }
    
    return VerifyResponse(
        pass_=pass_,
        count=detected_count,
        classesDetected=detected_classes,
        confidence=float(confidence),
        annotatedImagePath=annotated_path,
        knnVerification=knn_verification_data,
    )


@app.get("/health")
def health():
    return {"status": "ok"}




