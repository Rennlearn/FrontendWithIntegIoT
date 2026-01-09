// Simple integration script to test schedule -> MQTT publish -> simulated ESP32 ingest -> verifier workflow
// Usage: node scripts/integration_post_stop_test.js
/* eslint-env node */

const mqtt = require('mqtt');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5001';
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt://127.0.0.1:1883';

async function main() {
  console.log('Starting integration test...');

  const client = mqtt.connect(MQTT_HOST, { reconnectPeriod: 0 });

  client.on('connect', async () => {
    console.log('MQTT connected');

    const topic = 'pillnow/container1/cmd';

    client.subscribe(topic, (err) => {
      if (err) {
        console.error('Failed to subscribe to topic', err);
        process.exit(1);
      }
      console.log('Subscribed to', topic);
    });

    client.on('message', async (t, msg) => {
      try {
        const payload = JSON.parse(String(msg));
        console.log('MQTT message:', payload);
        if (payload.action === 'capture') {
          console.log('Capture requested - simulating device upload...');

          const imgPath = path.join(__dirname, '..', 'backend', 'captures', 'annotated_1765223928830.jpg');
          if (!fs.existsSync(imgPath)) {
            console.error('Test image not found:', imgPath);
            process.exit(1);
          }

          const form = new (require('form-data'))();
          form.append('image', fs.createReadStream(imgPath));
          form.append('meta', JSON.stringify(payload.expected || {}));

          const uploadUrl = `${BACKEND}/ingest/container1/container1`;
          const res = await axios.post(uploadUrl, form, { headers: form.getHeaders(), timeout: 30000 });
          console.log('Upload response:', res.data);

          // Poll for verification
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            try {
              const vr = await axios.get(`${BACKEND}/containers/container1/verification`, { timeout: 5000 });
              console.log('Verification result:', vr.data);
              client.end();
              process.exit(0);
            } catch (err) {
              await new Promise(r => setTimeout(r, 1500));
            }
          }

          console.error('Verification timed out');
          client.end();
          process.exit(2);
        }
      } catch (e) {
        console.warn('Invalid MQTT message received', e);
      }
    });

    // Fire the schedule
    console.log('Triggering /debug/fire-schedule/container1');
    await axios.post(`${BACKEND}/debug/fire-schedule/container1`);
  });

  client.on('error', (e) => {
    console.error('MQTT connection error', e);
    process.exit(1);
  });
}

main().catch(e => { console.error('Test failed', e); process.exit(1); });
