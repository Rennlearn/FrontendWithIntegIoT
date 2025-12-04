const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mqtt = require('mqtt');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001; // Changed to 5001 to avoid AirTunes conflict
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost';
const VERIFIER_URL = process.env.VERIFIER_URL || 'http://127.0.0.1:8000/verify';
const CAPTURE_DIR = path.join(__dirname, 'captures');

if (!fs.existsSync(CAPTURE_DIR)) {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
}

// (Optional) Additional routes can be mounted here when available

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// CORS configuration - allow all origins for React Native development
app.use(cors({
  origin: '*', // Allow all origins for React Native (mobile apps don't have a fixed origin)
  credentials: false, // Set to false when using wildcard origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 1. MQTT SETUP
const mqttClient = mqtt.connect(MQTT_BROKER_URL);
mqttClient.on('connect', () => {
  console.log('MQTT connected');
});

// In-memory schedule store (replace this with DB in production)
const schedules = {};

// Multer memory storage for image uploads
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

// In-memory verification results (replace with DB persistence later)
const verifications = {};

// Store before/after images for comparison (key: container, value: { before: path, after: path, timestamp })
const imageHistory = {};

// Store notifications (key: container, value: array of notifications)
const notifications = {};

// Store before/after images for comparison (key: container, value: { before: path, after: path, timestamp })
const imageHistory = {};

// Store notifications (key: container, value: array of notifications)
const notifications = {};

// 2. Schedule confirmation handler
app.post('/set-schedule', async (req, res) => {
  const { container_id, pill_config, times } = req.body;
  schedules[container_id] = { pill_config, times };
  // Immediately trigger ESP32-CAM to capture now via standardized topic
  const payload = { action: 'capture', container: container_id, expected: pill_config };
  mqttClient.publish(`pillnow/${container_id}/cmd`, JSON.stringify(payload));
  res.send({ ok: true, message: 'Schedule set and capture triggered', topic: `pillnow/${container_id}/cmd` });
});

// Get pill config for a container (for alarm-triggered captures)
app.get('/get-pill-config/:containerId', async (req, res) => {
  const { containerId } = req.params;
  console.log(`[get-pill-config] Requested for: ${containerId}`);
  
  // First try in-memory schedules
  const schedule = schedules[containerId];
  if (schedule && schedule.pill_config) {
    console.log(`[get-pill-config] Found in memory:`, schedule.pill_config);
    return res.json({ ok: true, pill_config: schedule.pill_config });
  }
  
  // If not in memory, try to get from database
  try {
    const MedicationSchedule = mongoose.model('MedicationSchedule');
    // Get the latest schedule for this container (extract container number)
    const containerNum = containerId.replace('container', ''); // e.g., "container1" -> "1"
    console.log(`[get-pill-config] Looking up in database for container: ${containerNum}`);
    
    const latestSchedule = await MedicationSchedule.findOne({ 
      container: containerNum
    }).sort({ createdAt: -1 }).exec();
    
    if (latestSchedule && latestSchedule.pill_config) {
      console.log(`[get-pill-config] Found in database:`, latestSchedule.pill_config);
      return res.json({ ok: true, pill_config: latestSchedule.pill_config });
    } else {
      console.log(`[get-pill-config] No schedule found in database for container ${containerNum}`);
    }
  } catch (dbError) {
    console.warn('[get-pill-config] Database lookup failed:', dbError.message);
  }
  
  // Fallback to default
  console.log(`[get-pill-config] Using default: { count: 0 }`);
  res.json({ ok: false, pill_config: { count: 0 } });
});

// Trigger ESP32-CAM capture for a container (for alarm-triggered captures)
app.post('/trigger-capture/:containerId', async (req, res) => {
  const { containerId } = req.params;
  let { expected } = req.body; // Allow pill config to be passed in request body
  
  console.log(`[trigger-capture] Request for ${containerId}, body:`, JSON.stringify(req.body));
  
  // Parse expected if it's a string
  if (expected && typeof expected === 'string') {
    try {
      expected = JSON.parse(expected);
    } catch (e) {
      console.warn('[trigger-capture] Failed to parse expected as JSON, using as object');
      expected = { count: parseInt(expected) || 0 };
    }
  }
  
  let pill_config = expected || { count: 0 };
  
  // If not provided in request, try to get from in-memory schedules
  if (!expected) {
    const schedule = schedules[containerId];
    if (schedule && schedule.pill_config) {
      pill_config = schedule.pill_config;
      console.log(`[trigger-capture] Using pill_config from in-memory schedules:`, pill_config);
    } else {
      console.log(`[trigger-capture] No pill_config in memory for ${containerId}, using default: { count: 0 }`);
    }
  } else {
    console.log(`[trigger-capture] Using pill_config from request body:`, pill_config);
  }
  
  const payload = { action: 'capture', container: containerId, expected: pill_config };
  console.log(`[trigger-capture] Publishing to MQTT: pillnow/${containerId}/cmd with payload:`, JSON.stringify(payload));
  
  try {
    if (!mqttClient.connected) {
      console.error('[trigger-capture] MQTT client not connected!');
      return res.status(500).json({ ok: false, message: 'MQTT client not connected' });
    }
    
    const published = mqttClient.publish(`pillnow/${containerId}/cmd`, JSON.stringify(payload));
    if (published) {
      console.log(`[trigger-capture] ✅ MQTT message published successfully to pillnow/${containerId}/cmd`);
      res.json({ ok: true, message: 'Capture triggered', container: containerId, pill_config });
    } else {
      console.error('[trigger-capture] MQTT publish returned false');
      res.status(500).json({ ok: false, message: 'Failed to publish MQTT message - publish returned false' });
    }
  } catch (mqttError) {
    console.error('[trigger-capture] MQTT publish error:', mqttError);
    res.status(500).json({ ok: false, message: 'Failed to publish MQTT message', error: mqttError.message });
  }
});

// 3. Image ingest endpoint (from ESP32-CAM)
// Route params: deviceId (e.g., morning|noon|evening or actual device ID), container label
// Multipart fields: image (file), meta (optional JSON string)
app.post('/ingest/:deviceId/:container', upload.single('image'), async (req, res, next) => {
  try {
    console.log('[INGEST] received', JSON.stringify(req.params), 'file?', !!req.file, 'file size?', req.file?.size);
    const { deviceId, container } = req.params;
    console.log('[INGEST] parsed deviceId:', deviceId, 'container:', container);
    const metaRaw = req.body?.meta;
    const meta = (() => { try { return metaRaw ? JSON.parse(metaRaw) : {}; } catch (_) { return {}; } })();
    const expected = meta.expected || schedules[container]?.pill_config || {};

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, message: 'Missing image file under field name "image"' });
    }

    // Save a copy of the image locally for later retrieval
    const safeDeviceId = (deviceId || 'device').replace(/[^a-z0-9_-]/gi, '_');
    const safeContainer = (container || 'container').replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${safeDeviceId}_${safeContainer}_${Date.now()}.jpg`;
    const filePath = path.join(CAPTURE_DIR, filename);
    try {
      await fs.promises.writeFile(filePath, req.file.buffer);
      console.log('[INGEST] image saved to', filePath);
    } catch (saveErr) {
      console.error('[INGEST] failed to save image copy:', saveErr.message);
    }

    // Forward to verifier service
    const formData = new FormData();
    formData.append('image', req.file.buffer, { 
      filename: 'capture.jpg', 
      contentType: req.file.mimetype || 'image/jpeg' 
    });
    formData.append('expected', JSON.stringify(expected));

    console.log('[INGEST] sending to verifier, image size:', req.file.buffer.length, 'expected:', JSON.stringify(expected));
    
    const verifyResponse = await axios.post(VERIFIER_URL, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
    
    console.log('[INGEST] verifier response status:', verifyResponse.status, 'data:', JSON.stringify(verifyResponse.data));

    const result = verifyResponse.data;

    // Get previous image for comparison
    const previousVerification = verifications[container];
    const previousImagePath = previousVerification?.savedImagePath;
    let changes = null;

    // Compare with previous image if available
    if (previousImagePath && fs.existsSync(previousImagePath)) {
      try {
        changes = await compareImages(previousImagePath, filePath, previousVerification.result, result);
        console.log('[INGEST] Image comparison result:', JSON.stringify(changes));
      } catch (compareErr) {
        console.error('[INGEST] Error comparing images:', compareErr);
      }
    }

    // Use annotated image if available, otherwise use original
    const imagePathToSave = result?.annotatedImagePath || filePath;
    
    // Persist latest verification per container
    verifications[container] = {
      deviceId,
      container,
      expected,
      result,
      timestamp: new Date().toISOString(),
      savedImagePath: imagePathToSave,
      originalImagePath: filePath, // Keep original for comparison
      changes: changes // Add detected changes
    };

    // Create notification if changes detected
    if (changes && (changes.countChanged || changes.pillsChanged || changes.typesChanged)) {
      const notification = {
        id: `notif_${container}_${Date.now()}`,
        type: 'verification',
        container: container,
        title: 'Pill Verification Update',
        message: generateChangeMessage(changes, container),
        timestamp: new Date().toISOString(),
        changes: changes,
        beforeImage: previousImagePath,
        afterImage: filePath
      };

      if (!notifications[container]) {
        notifications[container] = [];
      }
      notifications[container].unshift(notification); // Add to beginning
      
      // Keep only last 50 notifications per container
      if (notifications[container].length > 50) {
        notifications[container] = notifications[container].slice(0, 50);
      }

      console.log('[INGEST] Created notification:', notification.id);
    }

    // Notify via MQTT status topic
    mqttClient.publish(`pillnow/${deviceId}/status`, JSON.stringify({ state: 'verified', container, pass: !!result?.pass, changes: changes }));

    return res.json({ success: true, ...verifications[container] });
  } catch (err) {
    console.error('Ingest error:', err?.message);
    mqttClient.publish(`pillnow/error`, JSON.stringify({ scope: 'ingest', message: err?.message || 'unknown' }));
    return next(err);
  }
});

// 4. Fetch latest verification for a container
app.get('/containers/:containerId/verification', (req, res) => {
  const { containerId } = req.params;
  const data = verifications[containerId];
  if (!data) return res.status(404).json({ success: false, message: 'No verification found' });
  return res.json({ success: true, ...data });
});

// 5. Image comparison function (using pill count and type comparison)
async function compareImages(beforePath, afterPath, beforeResult, afterResult) {
  try {
    // Compare pill counts
    const beforeCount = beforeResult?.count || 0;
    const afterCount = afterResult?.count || 0;
    const countChanged = beforeCount !== afterCount;
    const countDiff = afterCount - beforeCount;

    // Compare pill types detected
    const beforeTypes = (beforeResult?.classesDetected || []).map(c => c.label).sort();
    const afterTypes = (afterResult?.classesDetected || []).map(c => c.label).sort();
    const typesChanged = JSON.stringify(beforeTypes) !== JSON.stringify(afterTypes);

    // Compare individual pill counts by type
    const beforeTypeCounts = {};
    (beforeResult?.classesDetected || []).forEach(c => {
      beforeTypeCounts[c.label] = (beforeTypeCounts[c.label] || 0) + c.n;
    });
    const afterTypeCounts = {};
    (afterResult?.classesDetected || []).forEach(c => {
      afterTypeCounts[c.label] = (afterTypeCounts[c.label] || 0) + c.n;
    });

    const pillsChanged = [];
    const allTypes = new Set([...Object.keys(beforeTypeCounts), ...Object.keys(afterTypeCounts)]);
    allTypes.forEach(type => {
      const beforeCount = beforeTypeCounts[type] || 0;
      const afterCount = afterTypeCounts[type] || 0;
      if (beforeCount !== afterCount) {
        pillsChanged.push({
          type: type,
          before: beforeCount,
          after: afterCount,
          change: afterCount - beforeCount
        });
      }
    });

    return {
      countChanged,
      countDiff,
      beforeCount,
      afterCount,
      typesChanged,
      pillsChanged: pillsChanged.length > 0 ? pillsChanged : null,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error('[INGEST] Error in compareImages:', err);
    return null;
  }
}

// 6. Generate human-readable change message
function generateChangeMessage(changes, container) {
  if (!changes) return 'No changes detected';
  
  const parts = [];
  
  if (changes.countChanged) {
    if (changes.countDiff > 0) {
      parts.push(`${changes.countDiff} pill(s) added`);
    } else {
      parts.push(`${Math.abs(changes.countDiff)} pill(s) removed`);
    }
  }
  
  if (changes.pillsChanged && changes.pillsChanged.length > 0) {
    const pillChanges = changes.pillsChanged.map(p => {
      if (p.change > 0) {
        return `${p.type}: +${p.change}`;
      } else {
        return `${p.type}: ${p.change}`;
      }
    }).join(', ');
    parts.push(`Type changes: ${pillChanges}`);
  }
  
  if (changes.typesChanged) {
    parts.push('Pill types changed');
  }
  
  if (parts.length === 0) {
    return 'No significant changes detected';
  }
  
  return `Container ${container}: ${parts.join('; ')}`;
}

// 7. Get notifications for a container
app.get('/notifications/:containerId', (req, res) => {
  const { containerId } = req.params;
  const containerNotifications = notifications[containerId] || [];
  return res.json({ success: true, notifications: containerNotifications });
});

// 8. Get all notifications
app.get('/notifications', (req, res) => {
  const allNotifications = [];
  Object.keys(notifications).forEach(container => {
    notifications[container].forEach(notif => {
      allNotifications.push(notif);
    });
  });
  // Sort by timestamp (newest first)
  allNotifications.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return res.json({ success: true, notifications: allNotifications });
});

// 9. Delete a notification
app.delete('/notifications/:notificationId', (req, res) => {
  const { notificationId } = req.params;
  let deleted = false;
  
  Object.keys(notifications).forEach(container => {
    const index = notifications[container].findIndex(n => n.id === notificationId);
    if (index !== -1) {
      notifications[container].splice(index, 1);
      deleted = true;
    }
  });
  
  if (deleted) {
    return res.json({ success: true, message: 'Notification deleted' });
  } else {
    return res.status(404).json({ success: false, message: 'Notification not found' });
  }
});

// 10. Create schedule notification (called when schedule events occur)
app.post('/notifications/schedule', (req, res) => {
  const { type, container, message, scheduleId } = req.body; // type: 'alarm_triggered', 'alarm_stopped', 'schedule_added', 'schedule_deleted'
  
  const notification = {
    id: `schedule_${container}_${Date.now()}`,
    type: 'schedule',
    scheduleType: type,
    container: container,
    title: getScheduleNotificationTitle(type),
    message: message || getScheduleNotificationMessage(type, container),
    timestamp: new Date().toISOString(),
    scheduleId: scheduleId
  };

  if (!notifications[container]) {
    notifications[container] = [];
  }
  notifications[container].unshift(notification);
  
  // Keep only last 50 notifications per container
  if (notifications[container].length > 50) {
    notifications[container] = notifications[container].slice(0, 50);
  }

  console.log('[NOTIFICATIONS] Created schedule notification:', notification.id);
  return res.json({ success: true, notification });
});

function getScheduleNotificationTitle(type) {
  const titles = {
    'alarm_triggered': '⏰ Alarm Triggered',
    'alarm_stopped': '✅ Alarm Stopped',
    'schedule_added': '📅 Schedule Added',
    'schedule_deleted': '🗑️ Schedule Deleted',
    'schedule_updated': '✏️ Schedule Updated'
  };
  return titles[type] || 'Schedule Notification';
}

function getScheduleNotificationMessage(type, container) {
  const messages = {
    'alarm_triggered': `Container ${container} alarm has been triggered`,
    'alarm_stopped': `Container ${container} alarm has been stopped`,
    'schedule_added': `New schedule added for Container ${container}`,
    'schedule_deleted': `Schedule deleted for Container ${container}`,
    'schedule_updated': `Schedule updated for Container ${container}`
  };
  return messages[type] || `Container ${container} schedule event`;
}


// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pillnow', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// API Routes placeholder (no external route files mounted)

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'PillNow API is running',
    timestamp: new Date().toISOString()
  });
});

// Simple connectivity test endpoint (for React Native app)
app.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Connection successful',
    serverTime: new Date().toISOString()
  });
});

// Health check at root level too
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!' 
  });
});

// 404 handler (Express 5 compatible)
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Accessible at http://0.0.0.0:${PORT} or http://localhost:${PORT}`);
  console.log(`Network access: http://<your-ip>:${PORT}`);
});

module.exports = app;
