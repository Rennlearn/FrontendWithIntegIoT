from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, List, Optional
from io import BytesIO
from PIL import Image
import json
import os
import pickle
import cv2
import numpy as np
import time
from ultralytics import YOLO
from pathlib import Path

app = FastAPI(title="PillNow Verifier", version="0.1.0")

# Load models on startup
MODEL_DIR = Path(__file__).parent / "models"
YOLO_MODEL_PATH = MODEL_DIR / "best.pt"
KNN_MODEL_PATH = MODEL_DIR / "knn_pills_updated.pkl"

yolo_model = None
knn_model = None

@app.on_event("startup")
async def load_models():
    """Load YOLOv8 and KNN models on server startup"""
    global yolo_model, knn_model
    try:
        # Load YOLOv8 model
        if YOLO_MODEL_PATH.exists():
            print(f"Loading YOLOv8 model from {YOLO_MODEL_PATH}")
            yolo_model = YOLO(str(YOLO_MODEL_PATH))
            print("YOLOv8 model loaded successfully")
        else:
            print(f"Warning: YOLOv8 model not found at {YOLO_MODEL_PATH}")
            
        # Load KNN classifier
        if KNN_MODEL_PATH.exists():
            print(f"Loading KNN model from {KNN_MODEL_PATH}")
            with open(KNN_MODEL_PATH, 'rb') as f:
                knn_model = pickle.load(f)
            print("KNN model loaded successfully")
        else:
            print(f"Warning: KNN model not found at {KNN_MODEL_PATH}")
            
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


class ClassCount(BaseModel):
    label: str
    n: int


class VerifyResponse(BaseModel):
    pass_: bool
    count: int
    classesDetected: List[ClassCount]
    confidence: float
    annotatedImagePath: Optional[str] = None


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
    if isinstance(expected_obj, dict) and "count" in expected_obj:
        try:
            expected_count = int(expected_obj["count"])
        except Exception:
            expected_count = 0

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
        
        # Run YOLOv8 detection with higher confidence threshold to reduce false positives
        results = yolo_model(img_cv, conf=0.3, verbose=True)  # Increased to 0.3 to reduce false positives
        
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
        # Pass ONLY if detected count exactly matches expected count when provided
        count_match = (detected_count == expected_count) if expected_count > 0 else True
        confidence_threshold = 0.5  # Minimum confidence threshold
        pass_ = count_match and confidence >= confidence_threshold
        
        # If KNN model is available, we could use it for additional classification
        # For now, YOLOv8 provides both detection and classification
        
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

    return VerifyResponse(
        pass_=pass_,
        count=detected_count,
        classesDetected=detected_classes,
        confidence=float(confidence),
        annotatedImagePath=annotated_path,
    )


@app.get("/health")
def health():
    return {"status": "ok"}




