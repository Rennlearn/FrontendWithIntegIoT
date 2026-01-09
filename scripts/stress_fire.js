// Stress test: fire many debug schedule calls and confirm MQTT publishes are made without server errors
// Usage: node scripts/stress_fire.js
/* eslint-env node */

const mqtt = require('mqtt');
const axios = require('axios');

const BACKEND = process.env.BACKEND_URL || 'http://localhost:5001';
const MQTT_HOST = process.env.MQTT_HOST || 'mqtt://127.0.0.1:1883';
const TOPICS = ['pillnow/container1/cmd', 'pillnow/container2/cmd', 'pillnow/container3/cmd'];

async function main() {
  console.log('Starting stress test: firing many /debug/fire-schedule requests');
  const client = mqtt.connect(MQTT_HOST, { reconnectPeriod: 0 });

  const received = [];

  client.on('connect', async () => {
    console.log('MQTT connected');
    client.subscribe(TOPICS, (err) => {
      if (err) { console.error('Subscribe error', err); process.exit(1); }
    });

    client.on('message', (t, m) => {
      try { received.push({ topic: t, payload: JSON.parse(String(m)) }); } catch (e) { }
    });

    const containers = ['container1','container2','container3'];
    const totalRequests = 60;
    const concurrency = 6;

    const q = [];
    for (let i=0;i<totalRequests;i++) {
      const c = containers[i % containers.length];
      q.push(async () => {
        try {
          await axios.post(`${BACKEND}/debug/fire-schedule/${c}`);
        } catch (e) {
          console.error('Fire error', e?.response?.status, e?.message || e);
        }
      });
    }

    // run with limited concurrency
    const workers = Array.from({length: concurrency}, () => (async () => {
      while (q.length) {
        const fn = q.shift();
        if (!fn) break;
        await fn();
        await new Promise(r => setTimeout(r, 80));
      }
    })());

    await Promise.all(workers);

    // wait a moment for messages to arrive
    await new Promise(r => setTimeout(r, 3000));

    console.log('Stress test complete. Messages received:', received.length);
    const counts = TOPICS.reduce((acc, t) => (acc[t] = received.filter(m => m.topic === t).length, acc), {});
    console.log('Per-topic counts:', counts);
    client.end();
    process.exit(0);
  });

  client.on('error', (e) => { console.error('MQTT error', e); process.exit(1); });
}

main().catch(e => { console.error(e); process.exit(2); });