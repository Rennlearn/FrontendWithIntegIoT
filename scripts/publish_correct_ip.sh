#!/bin/bash

# Helper script to manually publish the correct Mac IP to ESP32 devices
# Usage: ./scripts/publish_correct_ip.sh [IP_ADDRESS]
# If IP_ADDRESS is not provided, will try to detect it automatically

MQTT_BROKER="127.0.0.1"
MQTT_PORT=1883
MQTT_BACKEND_PORT=5001

# Get IP from argument or try to detect it
if [ -n "$1" ]; then
    MAC_IP="$1"
    echo "📡 Using provided IP: $MAC_IP"
else
    # Try to detect Mac IP
    INTERFACE=$(route get default 2>/dev/null | grep interface | awk '{print $2}')
    if [ -z "$INTERFACE" ]; then
        echo "❌ Could not detect network interface"
        echo "Usage: $0 [IP_ADDRESS]"
        echo "Example: $0 10.165.11.91"
        exit 1
    fi
    
    MAC_IP=$(ifconfig "$INTERFACE" 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    
    if [ -z "$MAC_IP" ]; then
        echo "❌ Could not detect Mac IP address"
        echo "Usage: $0 [IP_ADDRESS]"
        echo "Example: $0 10.165.11.91"
        exit 1
    fi
    
    echo "📡 Detected Mac IP: $MAC_IP"
fi

# Validate IP format (basic check)
if ! [[ $MAC_IP =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
    echo "❌ Invalid IP address format: $MAC_IP"
    exit 1
fi

echo ""
echo "🔧 Publishing config to ESP32 devices..."
echo "   MQTT Broker: $MQTT_BROKER:$MQTT_PORT"
echo "   Mac IP: $MAC_IP"
echo ""

# Publish config to all containers
for container in container1 container2 container3; do
    echo -n "   Publishing to $container... "
    
    mosquitto_pub -h "$MQTT_BROKER" -p "$MQTT_PORT" \
        -t "pillnow/$container/config" \
        -m "{\"mqtt_host\":\"$MAC_IP\",\"mqtt_port\":$MQTT_PORT,\"backend_host\":\"$MAC_IP\",\"backend_port\":$MQTT_BACKEND_PORT}" \
        -r 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅"
    else
        echo "❌ Failed (is MQTT broker running?)"
    fi
done

echo ""
echo "✅ Config published to all containers"
echo ""
echo "ESP32 devices should receive the config and reconnect automatically."
echo "Check ESP32 serial monitor to verify connection."
