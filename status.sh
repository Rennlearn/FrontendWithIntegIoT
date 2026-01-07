#!/bin/bash

# PillNow Service Status Check Script

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}=== PillNow Service Status ===${NC}"
echo ""

# Check MQTT Broker
echo -n "MQTT Broker (port 1883): "
if lsof -i :1883 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
    echo -e "   ${YELLOW}Start with: brew services start mosquitto${NC}"
fi

# Check Backend
echo -n "Backend Server (port 5001): "
if curl -s http://localhost:5001/test > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
    # Get current IP from backend
    IP_RESPONSE=$(curl -s http://localhost:5001/current-ip 2>/dev/null)
    if echo "$IP_RESPONSE" | grep -q '"ok":true'; then
        IP=$(echo "$IP_RESPONSE" | grep -o '"ip":"[^"]*"' | cut -d'"' -f4)
        echo -e "   ${BLUE}Backend URL: http://${IP}:5001${NC}"
    fi
else
    echo -e "${RED}❌ Not running${NC}"
    echo -e "   ${YELLOW}Start with: pm2 start backend/server.js --name pillnow-backend${NC}"
fi

# Check Verifier
echo -n "Verifier Service (port 8000): "
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
    echo -e "   ${YELLOW}Start with: pm2 start 'python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000' --name pillnow-verifier --interpreter python3${NC}"
fi

# Check Arduino Bridge
echo -n "Arduino Bridge: "
if pgrep -f "arduino_alert_bridge.py" > /dev/null; then
    PID=$(pgrep -f "arduino_alert_bridge.py")
    echo -e "${GREEN}✅ Running (PID: $PID)${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
    echo -e "   ${YELLOW}Start with: python3 backend/arduino_alert_bridge.py &${NC}"
fi

# Check ESP32-CAM Auto-Config
echo -n "ESP32-CAM Auto-Config: "
if pgrep -f "auto_update_esp32_config.sh" > /dev/null; then
    PID=$(pgrep -f "auto_update_esp32_config.sh")
    echo -e "${GREEN}✅ Running (PID: $PID)${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
    echo -e "   ${YELLOW}Start with: ./scripts/start_auto_config.sh${NC}"
fi

# Check PM2 services
if command -v pm2 &> /dev/null; then
    echo ""
    echo -e "${BLUE}PM2 Services:${NC}"
    pm2 list | grep -E "pillnow-backend|pillnow-verifier" || echo -e "${YELLOW}No PM2 services found${NC}"
fi

# Show current Mac IP
echo ""
echo -n "Current Mac IP: "
MAC_IP=$(ifconfig en0 2>/dev/null | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
if [ -n "$MAC_IP" ]; then
    echo -e "${GREEN}$MAC_IP${NC}"
else
    # Try other interfaces
    MAC_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    if [ -n "$MAC_IP" ]; then
        echo -e "${GREEN}$MAC_IP${NC}"
    else
        echo -e "${RED}Not found${NC}"
    fi
fi

echo ""
echo -e "${BLUE}=== Quick Commands ===${NC}"
echo "  Start all: ${GREEN}./start-all.sh${NC}"
echo "  Stop all:  ${GREEN}./stop-all.sh${NC}"
echo "  Check logs: ${GREEN}pm2 logs${NC}"
