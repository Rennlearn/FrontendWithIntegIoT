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
        
        # Run YOLOv8 detection
        results = yolo_model(img_cv, conf=0.25, verbose=False)
        
        # Process detection results
        detections_by_class: Dict[str, int] = {}
        all_confidences: List[float] = []
        
        for result in results:
            boxes = result.boxes
            if boxes is not None:
                for box in boxes:
                    # Get class ID and confidence
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    all_confidences.append(conf)
                    
                    # Get class name from model
                    class_name = result.names[cls_id] if hasattr(result, 'names') else f"pill_{cls_id}"
                    
                    # Count detections by class
                    if class_name in detections_by_class:
                        detections_by_class[class_name] += 1
                    else:
                        detections_by_class[class_name] = 1
        
        # Convert to ClassCount format
        detected_count = sum(detections_by_class.values())
        for label, count in detections_by_class.items():
            detected_classes.append(ClassCount(label=label, n=count))
        
        # Calculate average confidence
        confidence = np.mean(all_confidences) if all_confidences else 0.0
        
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
        )

    return VerifyResponse(
        pass_=pass_,
        count=detected_count,
        classesDetected=detected_classes,
        confidence=float(confidence),
    )


@app.get("/health")
def health():
    return {"status": "ok"}




