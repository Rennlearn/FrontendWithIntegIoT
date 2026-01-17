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
    import cv2
    import numpy as np
    from ultralytics import YOLO
else:
    # Provide light fallback types in mock mode
    # Import numpy for type hints even in mock mode
    import numpy as np
    Image = None
    cv2 = None
    YOLO = None

app = FastAPI(title="PillNow Verifier", version="0.1.0")

# Load models on startup
MODEL_DIR = Path(__file__).parent / "models"
YOLO_MODEL_PATH = MODEL_DIR / "best_new.pt"

yolo_model = None

@app.on_event("startup")
async def load_models():
    """Load YOLOv8 model on server startup (skipped in MOCK mode)"""
    global yolo_model
    
    import sys
    print("[Verifier] Starting YOLO model loading...", flush=True)
    sys.stdout.flush()
    
    if MOCK_VERIFIER:
        print("⚡ MOCK_VERIFIER enabled — skipping model load", flush=True)
        yolo_model = None
        print("[Verifier] ✅ Server ready (MOCK mode)", flush=True)
        sys.stdout.flush()
        return

    try:
        print("[Verifier] Loading YOLO model (this may take 10-30 seconds)...", flush=True)
        sys.stdout.flush()
        # Load YOLOv8 model
        if YOLO_MODEL_PATH.exists():
            print(f"[Verifier] Loading YOLOv8 model from {YOLO_MODEL_PATH}", flush=True)
            yolo_model = YOLO(str(YOLO_MODEL_PATH))
            print("[Verifier] ✅ YOLOv8 model loaded successfully", flush=True)
        else:
            print(f"[Verifier] ⚠️ Warning: YOLOv8 model not found at {YOLO_MODEL_PATH}", flush=True)
            yolo_model = None
            
    except Exception as e:
        import traceback
        import sys
        print(f"[Verifier] ❌ Error loading YOLO model: {e}", flush=True)
        print(f"[Verifier] Traceback: {traceback.format_exc()}", flush=True)
        print("[Verifier] ⚠️ Server will start but verification may not work properly", flush=True)
        sys.stdout.flush()
        sys.stderr.flush()
        # Ensure server still starts even if model fails
        yolo_model = None
    
    print("[Verifier] ✅ Server startup complete", flush=True)
    sys.stdout.flush()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClassCount(BaseModel):
    label: str
    n: int


class VerifyResponse(BaseModel):
    pass_: bool
    count: int
    classesDetected: List[ClassCount]
    confidence: float
    annotatedImagePath: Optional[str] = None
    annotatedImage: Optional[str] = None  # Base64 encoded annotated image
    knnVerification: Optional[Dict[str, Any]] = None  # KNN verification results


@app.post("/verify", response_model=VerifyResponse)
async def verify(image: UploadFile = File(...), expected: str = Form("{}")):
    """Verify pills in an image using YOLO model"""
    try:
        try:
            expected_obj: Dict[str, Any] = json.loads(expected) if expected else {}
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="expected must be JSON string")
        except Exception as e:
            print(f"[VERIFY] Error parsing request: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")

        # Load image into memory
        content = await image.read()
        try:
            # Load image preserving original color profile and brightness
            img_pil = Image.open(BytesIO(content))
            # Convert to RGB if needed, but preserve original appearance
            if img_pil.mode != 'RGB':
                img_pil = img_pil.convert("RGB")
            # Convert PIL to OpenCV format (numpy array)
            # Keep in RGB format for original (preserves brightness)
            img_np_rgb = np.array(img_pil, dtype=np.uint8)
            
            # Store original image in RGB format (preserves original brightness)
            img_original_rgb = img_np_rgb.copy()
            
            # Convert to BGR only for OpenCV processing
            img_cv = cv2.cvtColor(img_np_rgb, cv2.COLOR_RGB2BGR)
            
            # Image preprocessing for better detection accuracy
            # 1. Enhance contrast using CLAHE (Contrast Limited Adaptive Histogram Equalization)
            # Reduced clipLimit to prevent over-darkening
            lab = cv2.cvtColor(img_cv, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))  # Reduced from 2.0 to prevent darkening
            l = clahe.apply(l)
            img_cv = cv2.merge([l, a, b])
            img_cv = cv2.cvtColor(img_cv, cv2.COLOR_LAB2BGR)
            
            # 2. Apply slight sharpening to enhance edges (reduced intensity)
            kernel = np.array([[-1, -1, -1],
                             [-1,  9, -1],
                             [-1, -1, -1]])
            img_cv = cv2.filter2D(img_cv, -1, kernel * 0.05)  # Reduced from 0.1 to prevent artifacts
            
            # 3. Denoise to reduce false positives (lighter denoising)
            img_cv = cv2.bilateralFilter(img_cv, 3, 30, 30)  # Reduced parameters for less blur
            
            print(f"[YOLO DEBUG] Image preprocessing applied: CLAHE contrast enhancement (reduced), sharpening (reduced), denoising (lighter)")
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

            return VerifyResponse(
                pass_=True,
                count=cnt,
                classesDetected=classes,
                confidence=0.95,
                annotatedImagePath=None,
                annotatedImage=None,
                knnVerification=None,
            )

        # Run inference with YOLOv8 model
        detected_classes: List[ClassCount] = []
        detected_count = 0
        confidence = 0.0
        pass_ = False
        annotated_path = None

        try:
            if yolo_model is None:
                raise Exception("YOLOv8 model not loaded")

            # Debug: Print model class names

            if hasattr(yolo_model, 'names'):
                print(f"[YOLO DEBUG] Model classes: {yolo_model.names}")

            # Run YOLOv8 detection with optimized parameters for higher accuracy
            # Using lower confidence threshold initially to catch all potential detections,
            # then filtering more aggressively in post-processing
            
            # conf: confidence threshold (0.25 = lower to catch more pills, filter later)
            # iou: IoU threshold for NMS (0.4 = slightly more aggressive to remove overlapping detections)
            # imgsz: Use optimal image size (640 is YOLOv8 default, but can be adjusted)
            # verbose: print detailed detection info
            
            # Get optimal image size (YOLOv8 works best with multiples of 32)
            original_height, original_width = img_cv.shape[:2]
            optimal_size = 640  # YOLOv8 default, good balance of speed and accuracy
            
            # Initialize scale factors (default to 1.0 if no resizing)
            scale_x = 1.0
            scale_y = 1.0
            
            # Resize if image is too large or too small (maintains aspect ratio)
            if max(original_width, original_height) > 1280:
                scale = 1280 / max(original_width, original_height)
                new_width = int(original_width * scale)
                new_height = int(original_height * scale)
                # Round to nearest multiple of 32 for optimal YOLO performance
                new_width = (new_width // 32) * 32
                new_height = (new_height // 32) * 32
                img_cv_resized = cv2.resize(img_cv, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
                # Calculate scale factors for coordinate mapping
                scale_x = original_width / new_width
                scale_y = original_height / new_height
                print(f"[YOLO DEBUG] Resized image from {original_width}x{original_height} to {new_width}x{new_height} for optimal detection (scale: {scale_x:.3f}x, {scale_y:.3f}y)")
            else:
                img_cv_resized = img_cv
            
            # Run detection with optimized parameters
            results = yolo_model(img_cv_resized, conf=0.25, iou=0.4, imgsz=optimal_size, verbose=False)
            
            # Scale detection boxes back to original image size if resized
            scale_x = original_width / img_cv_resized.shape[1] if img_cv_resized.shape[1] != original_width else 1.0
            scale_y = original_height / img_cv_resized.shape[0] if img_cv_resized.shape[0] != original_height else 1.0

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
                        
                        # Scale boxes back to original image size if image was resized
                        x1 = x1 * scale_x
                        y1 = y1 * scale_y
                        x2 = x2 * scale_x
                        y2 = y2 * scale_y
                        
                        # Get class name from model
                        class_name = result.names[cls_id] if hasattr(result, 'names') else f"pill_{cls_id}"
                        
                        # Calculate detection area and aspect ratio for quality filtering
                        area = (x2 - x1) * (y2 - y1)
                        aspect_ratio = (x2 - x1) / (y2 - y1) if (y2 - y1) > 0 else 1.0
                        
                        print(f"[YOLO DEBUG] Detected: class={class_name} (id={cls_id}), confidence={conf:.3f}, box=({x1:.1f},{y1:.1f},{x2:.1f},{y2:.1f}), area={area:.0f}")

                        all_detections.append({
                            'class_name': class_name,
                            'confidence': conf,
                            'box': (x1, y1, x2, y2),
                            'area': area,
                            'aspect_ratio': aspect_ratio
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

            # Filter detections by quality criteria before duplicate removal
            # 1. Minimum confidence threshold (higher than initial detection threshold)
            min_confidence = 0.35  # Higher threshold for final detections
            # 2. Minimum area (filter out very small detections that are likely false positives)
            min_area = 100  # Minimum pixel area for a valid detection
            # 3. Reasonable aspect ratio (pills are roughly circular/oval, not extremely elongated)
            min_aspect_ratio = 0.3
            max_aspect_ratio = 3.0
            
            quality_filtered = []
            for det in all_detections:
                if det['confidence'] < min_confidence:
                    print(f"[YOLO DEBUG] Filtering low confidence: {det['class_name']} (conf={det['confidence']:.3f} < {min_confidence})")
                    continue
                if det['area'] < min_area:
                    print(f"[YOLO DEBUG] Filtering small detection: {det['class_name']} (area={det['area']:.0f} < {min_area})")
                    continue
                if not (min_aspect_ratio <= det['aspect_ratio'] <= max_aspect_ratio):
                    print(f"[YOLO DEBUG] Filtering invalid aspect ratio: {det['class_name']} (ratio={det['aspect_ratio']:.2f})")
                    continue
                quality_filtered.append(det)
            
            print(f"[YOLO DEBUG] Quality filtering: {len(all_detections)} -> {len(quality_filtered)} detections")
            
            # Sort by confidence (highest first)
            quality_filtered.sort(key=lambda x: x['confidence'], reverse=True)

            # Remove overlapping detections (keep highest confidence)
            # Use more aggressive IoU threshold for better duplicate removal
            filtered_detections = []
            for det in quality_filtered:
                is_duplicate = False
                for existing in filtered_detections:
                    iou = calculate_iou(det['box'], existing['box'])
                    # More aggressive duplicate filtering: 40% overlap threshold
                    if iou > 0.4:
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

            # Calculate weighted average confidence (weighted by detection area)
            # Larger detections are more reliable, so weight them more
            if all_confidences:
                total_weighted_confidence = sum(det['confidence'] * det['area'] for det in filtered_detections)
                total_area = sum(det['area'] for det in filtered_detections)
                confidence = total_weighted_confidence / total_area if total_area > 0 else np.mean(all_confidences)
            else:
                confidence = 0.0
            print(f"[YOLO DEBUG] Weighted average confidence: {confidence:.3f}")

            # Draw bounding boxes and labels on the image (using filtered detections)
            # Use original image in BGR format for OpenCV drawing functions
            # OpenCV drawing functions (rectangle, putText) require BGR format
            # We'll convert back to RGB at the end for web display
            annotated_img_bgr = cv2.cvtColor(img_original_rgb, cv2.COLOR_RGB2BGR)  # Convert to BGR for drawing
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

                # Draw bounding box (OpenCV expects BGR, so (0, 255, 0) = green in BGR)
                cv2.rectangle(annotated_img_bgr, (x1, y1), (x2, y2), (0, 255, 0), 2)

                # Prepare label text with count - make it bigger and more readable
                label = f"{class_name} ({current_count}) {conf:.2f}"

                # Use larger font size for better visibility
                font_scale = 1.2  # Increased from 0.6 to 1.2
                font_thickness = 3  # Increased from 2 to 3 for better visibility
                
                # Get text size for background
                (text_width, text_height), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness)

                # Draw label background with padding
                padding = 8
                cv2.rectangle(annotated_img_bgr, 
                             (x1 - padding, y1 - text_height - padding - 5), 
                             (x1 + text_width + padding, y1 + padding), 
                             (0, 255, 0), -1)

                # Draw label text with larger font
                cv2.putText(annotated_img_bgr, label, (x1, y1 - padding), 
                           cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), font_thickness)

            # Add total count text at top of image - make it bigger
            if detected_count > 0:
                total_text = f"Total Pills: {detected_count}"
                total_font_scale = 1.5  # Increased from 0.8 to 1.5
                total_font_thickness = 4  # Increased from 2 to 4
                (total_text_width, total_text_height), _ = cv2.getTextSize(total_text, cv2.FONT_HERSHEY_SIMPLEX, total_font_scale, total_font_thickness)
                # Draw background for total count with padding
                padding = 10
                cv2.rectangle(annotated_img_bgr, 
                             (padding, padding), 
                             (padding + total_text_width + padding, padding + total_text_height + padding), 
                             (0, 255, 0), -1)
                # Draw total count text with larger font
                cv2.putText(annotated_img_bgr, total_text, (padding + 5, padding + total_text_height), 
                           cv2.FONT_HERSHEY_SIMPLEX, total_font_scale, (0, 0, 0), total_font_thickness)

            # Save annotated image to backend captures directory and encode as base64
            annotated_image_base64 = None
            try:
                # Save to backend/captures directory (one level up from verifier)
                captures_dir = Path(__file__).parent.parent / "captures"
                captures_dir.mkdir(exist_ok=True)
                annotated_filename = f"annotated_{int(time.time() * 1000)}.jpg"
                annotated_path = str(captures_dir / annotated_filename)
                # Save with high quality JPEG (95/100) to preserve image clarity
                # annotated_img_bgr is already in BGR format (OpenCV's native format)
                cv2.imwrite(annotated_path, annotated_img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
                print(f"[YOLO DEBUG] Annotated image saved to: {annotated_path} (quality: 95/100)")
                
                # Encode annotated image as base64 for inclusion in response
                # Convert BGR back to RGB for web display (browsers/mobile apps expect RGB)
                annotated_img_rgb = cv2.cvtColor(annotated_img_bgr, cv2.COLOR_BGR2RGB)
                # Use high quality JPEG encoding (95/100) to preserve image clarity
                import base64
                encode_params = [cv2.IMWRITE_JPEG_QUALITY, 95]  # High quality (0-100, 95 = very high quality)
                # Encode RGB image for web display (browsers/mobile apps expect RGB)
                _, buffer = cv2.imencode('.jpg', annotated_img_rgb, encode_params)
                annotated_image_base64 = base64.b64encode(buffer).decode('utf-8')
                print(f"[YOLO DEBUG] Annotated image encoded as base64 with high quality (95/100) (size: {len(annotated_image_base64)} bytes)")
            except Exception as e:
                print(f"[YOLO DEBUG] Failed to save/encode annotated image: {e}")
            
            # Determine if verification passes
            # PillNow requirement: alert when pill TYPE is wrong OR pill COUNT is wrong.
            # IMPORTANT: If container should have ONLY one type of pill, ANY foreign pill = MISMATCH
            confidence_threshold = 0.4  # Higher threshold for verification (ensures quality detections)
            
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
                    pass_ = True  # Only set to True if all checks pass
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
            
            # Return YOLO-only verification result
            return VerifyResponse(
                pass_=pass_,
                count=detected_count,
                classesDetected=detected_classes,
                confidence=float(confidence),
                annotatedImagePath=annotated_path,
                annotatedImage=annotated_image_base64,
                knnVerification=None,
            )
            
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
                annotatedImage=None,
                knnVerification=None,
            )
    except HTTPException:
        # Re-raise HTTP exceptions (they're already properly formatted)
        raise
    except Exception as e:
        # Catch any other unexpected errors and return a failure response
        import traceback
        print(f"[VERIFY] Unexpected error in verify endpoint: {e}")
        print(f"[VERIFY] Traceback: {traceback.format_exc()}")
        return VerifyResponse(
            pass_=False,
            count=0,
            classesDetected=[],
            confidence=0.0,
            annotatedImagePath=None,
            annotatedImage=None,
            knnVerification=None,
        )


# Health check endpoints
@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "PillNow Verifier",
        "mock_mode": MOCK_VERIFIER,
        "yolo_loaded": yolo_model is not None,
    }

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "service": "PillNow Verifier"}




