Arduino bridge notes

This bridge listens to Arduino serial for ALARM_STOPPED messages and forwards a post-capture request to the backend if configured.

If your Arduino prints `ALARM_STOPPED` to Serial when the user stops the alarm, ensure the bridge is running and has access to the serial device (close Serial Monitor).

To verify bridge->backend post-stop capture calls, run:

  curl -v -X POST http://localhost:5001/alarm/stopped/container1 -H 'Content-Type: application/json' -d '{"capture":true}'

The bridge will also log when it detects ALARM_STOPPED and when it calls the backend.

Tips & test scripts

- Ensure the Serial Monitor is closed so the bridge can open the serial device (if the serial port is "Resource busy", close Serial Monitor and restart the bridge).
- Use the provided integration test to simulate a full flow (fire schedule -> receive MQTT capture request -> upload -> verify):

    node scripts/integration_post_stop_test.js

- Use the stress test to exercise many schedule fires and verify publishes:

    node scripts/stress_fire.js

- Check runtime metrics to observe captures/publishes/suppressions:

    curl http://localhost:5001/metrics | jq .
