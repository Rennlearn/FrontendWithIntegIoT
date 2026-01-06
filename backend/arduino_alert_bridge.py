#!/usr/bin/env python3
"""
MQTT to Arduino Serial Bridge
Subscribes to pillnow/*/cmd MQTT topics and forwards alert commands to Arduino via Serial
"""
import paho.mqtt.client as mqtt
import os
import serial
import json
import sys
import time
import threading

# Configuration
MQTT_BROKER = "127.0.0.1"  # Local Mosquitto broker
MQTT_PORT = 1883
MQTT_TOPIC = "pillnow/+/cmd"  # Subscribe to all container commands
ARDUINO_SERIAL_PORT = "/dev/tty.usbmodem*"  # Change to your Arduino's serial port
ARDUINO_BAUD = 9600

# Try common serial ports
SERIAL_PORTS = [
    "/dev/cu.usbmodem*",  # macOS write port (preferred)
    "/dev/tty.usbmodem*",  # macOS read port
    "/dev/cu.usbserial*",  # macOS write port (alternative)
    "/dev/tty.usbserial*",  # macOS read port (alternative)
    "/dev/ttyUSB0",  # Linux
    "/dev/ttyACM0",  # Linux
    "COM3",  # Windows
    "COM4",  # Windows
]

arduino_serial = None
arduino_lock = threading.Lock()
last_connect_attempt = 0
CONNECT_RETRY_SECONDS = 5

def find_arduino_port():
    """Try to find Arduino serial port"""
    import glob
    for pattern in SERIAL_PORTS:
        if '*' in pattern:
            ports = glob.glob(pattern)
            if ports:
                return ports[0]
        else:
            try:
                ser = serial.Serial(pattern, ARDUINO_BAUD, timeout=1)
                ser.close()
                return pattern
            except:
                continue
    return None

def connect_arduino():
    """Connect to Arduino via Serial"""
    global arduino_serial
    global last_connect_attempt

    # Rate limit connection attempts (avoids log spam + port hammering)
    now = time.time()
    if now - last_connect_attempt < CONNECT_RETRY_SECONDS:
        return False
    last_connect_attempt = now

    port = find_arduino_port()
    if not port:
        print("⚠️  Arduino not found. Alert commands will be logged but not sent.", flush=True)
        print("   Connect Arduino and update SERIAL_PORTS in this script.", flush=True)
        return False
    
    try:
        # Close any existing handle first
        try:
            if arduino_serial and arduino_serial.is_open:
                arduino_serial.close()
        except Exception:
            pass

        arduino_serial = serial.Serial(port, ARDUINO_BAUD, timeout=1)
        time.sleep(2)  # Wait for Arduino to reset
        print(f"✅ Connected to Arduino on {port}", flush=True)
        return True
    except Exception as e:
        error_msg = str(e)
        if "Resource busy" in error_msg or "could not open port" in error_msg:
            print(f"⚠️  Arduino port is busy (Serial Monitor may be open): {e}", flush=True)
            print(f"   Please close Arduino Serial Monitor (or any app using the port).", flush=True)
            print(f"   💡 This bridge will auto-retry connecting every {CONNECT_RETRY_SECONDS}s.", flush=True)
        else:
            print(f"❌ Failed to connect to Arduino: {e}", flush=True)
        return False

def send_to_arduino(command):
    """Send command to Arduino via Serial"""
    # Ensure we have a connection (auto-retry)
    with arduino_lock:
        if not (arduino_serial and arduino_serial.is_open):
            connect_arduino()

    if arduino_serial and arduino_serial.is_open:
        try:
            # Ensure command ends with newline
            cmd_with_newline = f"{command}\n"
            # Write in chunks to ensure reliable transmission for long commands
            data = cmd_with_newline.encode('utf-8')
            chunk_size = 64  # Send in 64-byte chunks
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i+chunk_size]
                arduino_serial.write(chunk)
                arduino_serial.flush()  # Flush after each chunk
                time.sleep(0.01)  # Small delay between chunks
            print(f"📤 Sent to Arduino ({len(data)} bytes): {command[:80]}...", flush=True)
            return True
        except Exception as e:
            print(f"❌ Failed to send to Arduino: {e}", flush=True)
            # Mark as disconnected; will reconnect on next send
            try:
                with arduino_lock:
                    if arduino_serial:
                        arduino_serial.close()
            except Exception:
                pass
            return False
    else:
        print(f"⚠️  Arduino not connected. Would send: {command[:100]}...", flush=True)
        print(f"   💡 TIP: Close Arduino Serial Monitor. This bridge will auto-retry.", flush=True)
        return False

def arduino_reconnect_loop():
    """Background loop to reconnect Arduino when port becomes available."""
    while True:
        try:
            with arduino_lock:
                if not (arduino_serial and arduino_serial.is_open):
                    connect_arduino()
        except Exception as e:
            print(f"⚠️  Arduino reconnect loop error: {e}", flush=True)
        time.sleep(CONNECT_RETRY_SECONDS)

def on_connect(client, userdata, flags, rc):
    """MQTT connection callback"""
    sys.stdout.flush()
    if rc == 0:
        print(f"✅ Connected to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}", flush=True)
        print(f"📡 Subscribing to {MQTT_TOPIC}...", flush=True)
        result = client.subscribe(MQTT_TOPIC)
        print(f"📡 Subscribe result: {result}", flush=True)
        print(f"📡 Successfully subscribed to {MQTT_TOPIC}", flush=True)
    else:
        print(f"❌ Failed to connect to MQTT broker. Return code: {rc}", flush=True)
        sys.exit(1)

def on_message(client, userdata, msg):
    """MQTT message callback"""
    try:
        print(f"📨 Received MQTT message on topic: {msg.topic}", flush=True)
        print(f"   Payload: {msg.payload.decode()}", flush=True)
        payload = json.loads(msg.payload.decode())
        topic = msg.topic
        
        action = payload.get("action")

        # Alert action from verifier/backend (pill mismatch, etc.)
        if action == "alert":
            print(f"🚨 Alert received from {topic}")
            print(f"   Reason: {payload.get('reason', 'unknown')}")
            container = payload.get('container', 'unknown')
            print(f"   Container: {container}")
            print(f"   Expected: {payload.get('expected', {})}")
            print(f"   Detected: {payload.get('detected', [])}")
            
            # Extract container number from container string (e.g., "container2" -> "2")
            container_num = "0"  # Default to 0 if can't parse
            try:
                if container and isinstance(container, str):
                    # Extract digits from container string
                    container_num = ''.join([c for c in container if c.isdigit()])
                    if not container_num:
                        container_num = "0"
                elif isinstance(container, int):
                    container_num = str(container)
            except Exception as e:
                print(f"⚠️ Error parsing container number: {e}")
                container_num = "0"
            
            # Send PILLALERT command to Arduino with container number
            # Format: PILLALERT C<number> (e.g., "PILLALERT C2")
            cmd = f"PILLALERT C{container_num}"
            print(f"📤 Sending to Arduino: {cmd}")
            send_to_arduino(cmd)

        # Alarm trigger action (for app modal via Bluetooth)
        elif action == "alarm_triggered":
            container = payload.get("container", "container1")
            date_str = payload.get("date", "")  # optional YYYY-MM-DD
            time_str = payload.get("time", "00:00")
            # Expect container like "container1" → extract digit(s)
            try:
                container_num = ''.join([c for c in str(container) if c.isdigit()])
                if not container_num:
                    container_num = "1"
            except Exception:
                container_num = "1"
            # Include date to help the app match the correct cloud schedule (prevents wrong/late status updates)
            # Format supported by Arduino sketch (we parse last HH:MM token):
            #   ALARM_TRIGGERED C2 2025-12-14 23:07
            cmd = f"ALARM_TRIGGERED C{container_num} {date_str} {time_str}" if date_str else f"ALARM_TRIGGERED C{container_num} {time_str}"
            print(f"⏰ Alarm trigger -> sending to Arduino/Bluetooth: {cmd}")
            send_to_arduino(cmd)

        # SMS sending action
        elif action == "send_sms":
            phone = payload.get("phone", "")
            message = payload.get("message", "")
            print(f"📱 SMS action detected!", flush=True)
            print(f"   Phone: {phone}", flush=True)
            print(f"   Message length: {len(message) if message else 0}", flush=True)
            if phone and message:
                print(f"📱 SMS request received from {topic}", flush=True)
                print(f"   Phone: {phone}", flush=True)
                print(f"   Message: {message[:50]}...", flush=True)
                
                # Send SENDSMS command to Arduino: SENDSMS <phone> <message>
                command = f"SENDSMS {phone} {message}"
                print(f"📤 Sending command to Arduino: {command[:80]}...", flush=True)
                result = send_to_arduino(command)
                if result:
                    print(f"✅ Command sent to Arduino successfully", flush=True)
                else:
                    print(f"❌ Failed to send command to Arduino", flush=True)
            else:
                print(f"⚠️  Invalid SMS payload: missing phone or message", flush=True)
                print(f"   Phone present: {bool(phone)}, Message present: {bool(message)}", flush=True)
        else:
            print(f"📨 Message from {topic}: {payload}")
    except Exception as e:
        print(f"❌ Error processing MQTT message: {e}")

def serial_read_loop():
    """Read lines from Arduino Serial and handle ALARM_STOPPED events."""
    global arduino_serial
    last_stop_ts = {}
    BACKEND_HTTP = os.environ.get('BACKEND_HTTP', 'http://127.0.0.1:5001')

    while True:
        try:
            if not (arduino_serial and arduino_serial.is_open):
                time.sleep(1)
                continue
            try:
                line = arduino_serial.readline().decode('utf-8', errors='ignore').strip()
            except Exception:
                line = ""
            if not line:
                time.sleep(0.1)
                continue
            print(f"📟 Serial <- {line}", flush=True)

            # Detect ALARM_STOPPED (we added a short tag from the sketch)
            if 'ALARM_STOPPED' in line.upper():
                # Try to extract container number (C<number>)
                container_num = None
                import re
                m = re.search(r'C(\d+)', line.upper())
                if m:
                    container_num = int(m.group(1))
                if not container_num:
                    # fallback to 1
                    container_num = 1
                container_id = f"container{container_num}"

                now = time.time()
                last = last_stop_ts.get(container_id, 0)
                if now - last < 5:
                    print(f"⚠️  Ignoring duplicate ALARM_STOPPED for {container_id} (throttled)", flush=True)
                    continue
                last_stop_ts[container_id] = now

                print(f"📣 Detected ALARM_STOPPED for {container_id}, calling backend for post-capture...", flush=True)
                try:
                    import urllib.request, json
                    url = f"{BACKEND_HTTP}/alarm/stopped/{container_id}"
                    data = json.dumps({}).encode('utf-8')
                    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=8) as resp:
                        text = resp.read().decode('utf-8')
                        print(f"📤 Backend /alarm/stopped response: {text}", flush=True)
                except Exception as e:
                    print(f"❌ Failed to call backend /alarm/stopped: {e}", flush=True)
        except Exception as e:
            print(f"⚠️ Serial read loop error: {e}", flush=True)
            time.sleep(1)


def main():
    """Main function"""
    print("🔌 Starting MQTT to Arduino Alert Bridge...", flush=True)
    sys.stdout.flush()
    
    # Connect to Arduino
    connect_arduino()
    # Start reconnect loop so alarms/mismatch resume automatically after closing Serial Monitor
    t = threading.Thread(target=arduino_reconnect_loop, daemon=True)
    t.start()

    # Start serial reader thread that listens for ALARM_STOPPED messages and triggers post-capture
    serial_reader_thread = threading.Thread(target=serial_read_loop, daemon=True)
    serial_reader_thread.start()

    sys.stdout.flush()
    
    # Connect to MQTT
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    
    try:
        print(f"🔗 Connecting to MQTT broker at {MQTT_BROKER}:{MQTT_PORT}...", flush=True)
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        print("🔄 Starting MQTT loop...", flush=True)
        sys.stdout.flush()
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n🛑 Stopping bridge...")
        if arduino_serial:
            arduino_serial.close()
        client.disconnect()
        sys.exit(0)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

