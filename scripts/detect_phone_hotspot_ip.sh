#!/bin/bash

# Detect phone hotspot IP address automatically
# This script finds the phone's IP by checking the default gateway

# Get default gateway (usually the phone's IP when using hotspot)
get_phone_ip() {
    # Method 1: Get default gateway IP
    GATEWAY_IP=$(route -n get default 2>/dev/null | grep gateway | awk '{print $2}')
    
    if [ -n "$GATEWAY_IP" ]; then
        echo "$GATEWAY_IP"
        return 0
    fi
    
    # Method 2: Get router IP from network interface
    INTERFACE=$(route get default | grep interface | awk '{print $2}')
    if [ -n "$INTERFACE" ]; then
        ROUTER_IP=$(networksetup -getinfo "$INTERFACE" 2>/dev/null | grep "Router:" | awk '{print $2}')
        if [ -n "$ROUTER_IP" ]; then
            echo "$ROUTER_IP"
            return 0
        fi
    fi
    
    # Method 3: Use arp to find gateway
    GATEWAY_IP=$(arp -a | grep "$(route -n get default | grep gateway | awk '{print $2}')" | awk '{print $2}' | tr -d '()')
    if [ -n "$GATEWAY_IP" ]; then
        echo "$GATEWAY_IP"
        return 0
    fi
    
    return 1
}

PHONE_IP=$(get_phone_ip)

if [ -n "$PHONE_IP" ]; then
    echo "$PHONE_IP"
    exit 0
else
    echo "Could not detect phone IP"
    exit 1
fi

