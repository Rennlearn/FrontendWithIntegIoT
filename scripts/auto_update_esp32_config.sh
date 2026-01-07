#!/bin/bash

# Auto-update ESP32-CAM configuration when Mac IP address changes
# This script monitors the Mac's IP address and publishes config updates to ESP32-CAM devices

MQTT_BROKER="127.0.0.1"
MQTT_PORT=1883
MQTT_BACKEND_PORT=5001

# Get the primary network interface (usually en0 on Mac)
INTERFACE=$(route get default | grep interface | awk '{print $2}')

# Function to get current IP address
get_current_ip() {
    ifconfig "$INTERFACE" | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1
}

# Function to publish config to all containers
publish_config() {
    local ip=$1
    echo "[$(date)] Publishing config update: IP=$ip"
    
    for container in container1 container2 container3; do
        mosquitto_pub -h "$MQTT_BROKER" -p "$MQTT_PORT" \
            -t "pillnow/$container/config" \
            -m "{\"mqtt_host\":\"$ip\",\"mqtt_port\":$MQTT_PORT,\"backend_host\":\"$ip\",\"backend_port\":$MQTT_BACKEND_PORT}" \
            -r
        echo "  ✅ Updated config for $container"
    done
}

# Main loop
LAST_IP=""
CHECK_INTERVAL=10  # Check every 10 seconds (optimized for phone hotspot - IPs change frequently)

echo "🔍 ESP32-CAM Auto-Config Service Started"
echo "   Monitoring interface: $INTERFACE"
echo "   Check interval: ${CHECK_INTERVAL}s"
echo ""

# Publish initial IP immediately on startup (so ESP32-CAMs get current IP even if they connect later)
INITIAL_IP=$(get_current_ip)
if [ -n "$INITIAL_IP" ]; then
    echo "[$(date)] 📡 Publishing initial IP on startup: $INITIAL_IP"
    publish_config "$INITIAL_IP"
    LAST_IP="$INITIAL_IP"
else
    echo "[$(date)] ⚠️  No initial IP found, will publish when IP is detected"
fi

while true; do
    CURRENT_IP=$(get_current_ip)
    
    if [ -z "$CURRENT_IP" ]; then
        echo "[$(date)] ⚠️  No IP address found on $INTERFACE"
        sleep $CHECK_INTERVAL
        continue
    fi
    
    if [ "$CURRENT_IP" != "$LAST_IP" ]; then
        if [ -n "$LAST_IP" ]; then
            echo "[$(date)] 🔄 IP address changed: $LAST_IP -> $CURRENT_IP"
        else
            echo "[$(date)] 📡 Initial IP detected: $CURRENT_IP"
        fi
        
        publish_config "$CURRENT_IP"
        LAST_IP="$CURRENT_IP"
    fi
    
    sleep $CHECK_INTERVAL
done

