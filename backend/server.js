const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mqtt = require('mqtt');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost';
const VERIFIER_URL = process.env.VERIFIER_URL || 'http://127.0.0.1:8000/verify';

// (Optional) Additional routes can be mounted here when available

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
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

// 2. Schedule confirmation handler
app.post('/set-schedule', async (req, res) => {
  const { container_id, pill_config, times } = req.body;
  schedules[container_id] = { pill_config, times };
  // Immediately trigger ESP32-CAM to capture now via standardized topic
  const payload = { action: 'capture', container: container_id, expected: pill_config };
  mqttClient.publish(`pillnow/${container_id}/cmd`, JSON.stringify(payload));
  res.send({ ok: true, message: 'Schedule set and capture triggered', topic: `pillnow/${container_id}/cmd` });
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

    // Persist latest verification per container
    verifications[container] = {
      deviceId,
      container,
      expected,
      result,
      timestamp: new Date().toISOString()
    };

    // Notify via MQTT status topic
    mqttClient.publish(`pillnow/${deviceId}/status`, JSON.stringify({ state: 'verified', container, pass: !!result?.pass }));

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
