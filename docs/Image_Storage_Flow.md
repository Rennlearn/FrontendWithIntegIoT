# Image Storage and Flow in Generated Reports

## 📍 Where Images Are Stored

### 1. **Backend Server Storage (Permanent)**
- **Location**: `backend/captures/` directory
- **Path**: `/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT/backend/captures/`
- **File Naming**:
  - Raw images: `{deviceId}_{containerId}_{timestamp}.jpg`
    - Example: `container1_container1_1737123456789.jpg`
  - Annotated images: `annotated_{containerId}_{timestamp}.jpg`
    - Example: `annotated_container1_1737123456789.jpg`
    - Example: `annotated_container3_1737123456789.jpg`

### 2. **How Images Are Accessed in Reports**

#### Step 1: Frontend Requests Image
- **Location**: `app/Generate.tsx` → `fetchScheduleImage()` function
- **API Endpoints Called**:
  1. First tries: `/captures/schedule/{container}?date=YYYY-MM-DD&time=HH:MM`
  2. Falls back to: `/captures/latest/{container}`

#### Step 2: Backend Returns Image Path
- **Backend**: `backend/server.js`
- **Returns**: HTTP path like `/captures/annotated_container1_1737123456789.jpg`
- **Full URL**: `http://{backend-ip}:5001/captures/annotated_container1_1737123456789.jpg`

#### Step 3: Frontend Downloads Image
- **Temporary Storage**: Mobile device cache directory
- **Path**: `FileSystem.cacheDirectory` (React Native/Expo managed)
- **Temporary Filename**: `container_{containerId}_{date}_{time}_{timestamp}_{random}.jpg`
- **Code Location**: `app/Generate.tsx` line 150-153

#### Step 4: Convert to Base64
- **Process**: Image is read from temporary file and converted to base64
- **Code Location**: `app/Generate.tsx` line 157-159
- **Format**: `data:image/jpeg;base64,{base64String}`

#### Step 5: Embed in PDF
- **Process**: Base64 image is embedded directly in the HTML/PDF
- **Code Location**: `app/Generate.tsx` line 417-418
- **Result**: Image is permanently embedded in the PDF file

#### Step 6: Cleanup
- **Process**: Temporary file is deleted immediately after conversion
- **Code Location**: `app/Generate.tsx` line 162-165
- **Result**: No temporary files remain on device

## 🔄 Complete Image Flow Diagram

```
ESP32-CAM Capture
    ↓
Backend /ingest endpoint
    ↓
Saved to: backend/captures/annotated_container1_timestamp.jpg
    ↓
Frontend requests: GET /captures/schedule/container1?date=...&time=...
    ↓
Backend returns: /captures/annotated_container1_timestamp.jpg
    ↓
Frontend downloads to: FileSystem.cacheDirectory/temp_file.jpg
    ↓
Converted to base64: data:image/jpeg;base64,{...}
    ↓
Embedded in PDF HTML
    ↓
Temporary file deleted
    ↓
PDF generated with embedded images
```

## 📂 File Locations Summary

| Stage | Location | Purpose | Persistence |
|-------|----------|---------|-------------|
| **Original Storage** | `backend/captures/` | Permanent storage of all captured images | ✅ Permanent |
| **Temporary Download** | `FileSystem.cacheDirectory/` | Temporary storage during PDF generation | ❌ Deleted immediately |
| **PDF Embedding** | Base64 in PDF HTML | Embedded in generated PDF | ✅ Permanent (in PDF) |
| **Final PDF** | User's device (shared/downloaded) | Generated report file | ✅ Permanent |

## 🔍 How to Find Images

### On Backend Server:
```bash
# Navigate to captures directory
cd backend/captures/

# List all images
ls -la

# Find images for specific container
ls -la annotated_container1_*
ls -la annotated_container3_*

# View image count
ls annotated_*.jpg | wc -l
```

### In Generated PDF:
- Images are embedded as base64 strings
- They are part of the PDF file itself
- No external files needed to view the PDF

## ⚠️ Important Notes

1. **Images are NOT stored on the mobile device permanently**
   - Only temporarily during PDF generation
   - Deleted immediately after conversion

2. **Images ARE stored permanently on the backend server**
   - In `backend/captures/` directory
   - Accessible via HTTP: `http://{backend-ip}:5001/captures/{filename}`

3. **PDF contains embedded images**
   - Images are converted to base64 and embedded in the PDF
   - PDF is self-contained (no external image files needed)

4. **Container-specific filtering**
   - Each container only gets images matching its container ID
   - Format: `annotated_container1_*`, `annotated_container3_*`, etc.
   - No cross-container image mixing
