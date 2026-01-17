import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter, DeviceEventEmitter, Linking, Alert } from 'react-native';

const isDevEnv = typeof globalThis !== 'undefined' && Boolean((globalThis as any).__DEV__);

export interface BluetoothDevice {
  name: string;
  address: string;
  connected: boolean;
}

class BluetoothService {
  private isConnected: boolean = false;
  private currentDevice: BluetoothDevice | null = null;
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    // Initialize native module if available and supports event emission
    // Check if the module implements the required event emitter methods to avoid warnings
    // Note: BluetoothManager may not exist or may not implement event emitter interface
    if (NativeModules.BluetoothManager) {
      const module = NativeModules.BluetoothManager;
      // Only create emitter if module has addListener method (indicates it supports events)
      // This prevents NativeEventEmitter warnings about missing addListener/removeListeners
      if (module && typeof module.addListener === 'function' && typeof module.removeListeners === 'function') {
        this.eventEmitter = new NativeEventEmitter(module);
      } else {
        // Module doesn't support events - don't create emitter to avoid warnings
        // onBluetoothStateChanged will check if eventEmitter exists before using it
        this.eventEmitter = null;
      }
    }
  }

  // Request Bluetooth permissions for Android
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);

        const allGranted = Object.values(granted).every(
          permission => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        return allGranted;
      } catch (error) {
        console.error('Permission request error:', error);
        return false;
      }
    }
    return true; // iOS permissions are handled differently
  }

  // Check if Bluetooth is available and enabled
  async isBluetoothAvailable(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        // Use native Android Bluetooth adapter
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          const isEnabled = await BluetoothAdapter.isEnabled();
          return isEnabled;
        }
      }
      // Fallback: assume Bluetooth is available
      return true;
    } catch (error) {
      console.error('Bluetooth availability check failed:', error);
      return false;
    }
  }

  // Enable Bluetooth (turns on phone's Bluetooth)
  async enableBluetooth(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        // Ensure required permissions (Android 12+)
        try {
          const connectGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
          );
          const scanGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
          );
          const fineGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
          );
          const coarseGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
          );

          const allGranted = [connectGranted, scanGranted, fineGranted, coarseGranted]
            .every(result => result === PermissionsAndroid.RESULTS.GRANTED);
          if (!allGranted) {
            console.warn('Bluetooth permissions not fully granted');
          }
        } catch (permErr) {
          console.error('Bluetooth permission request failed:', permErr);
        }
        
        // Try to enable Bluetooth directly
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          const result = await BluetoothAdapter.enable();
          if (result) {
            console.log('Bluetooth enabled successfully');
            return true;
          }
        }
        
        // If direct enable fails, open Bluetooth settings
        console.log('Opening Bluetooth settings...');
        await Linking.openSettings();
        
        // Show alert to user
        Alert.alert(
          'Enable Bluetooth',
          'Please turn on Bluetooth in the settings that just opened, then return to the app.',
          [{ text: 'OK' }]
        );
        return true;
      }
      return true;
    } catch (error) {
      console.error('Failed to enable Bluetooth:', error);
      return false;
    }
  }

  // Get paired devices
  async getPairedDevices(): Promise<BluetoothDevice[]> {
    try {
      if (Platform.OS === 'android') {
        // Try to get real paired devices
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          const devices = await BluetoothAdapter.getBondedDevices();
          const bluetoothDevices: BluetoothDevice[] = devices.map((device: any) => ({
            name: device.name || 'Unknown Device',
            address: device.address,
            connected: false
          }));
          
          console.log('Found real paired devices:', bluetoothDevices);
          return bluetoothDevices;
        }
      }
      
      // Fallback: return simulated devices
      const devices: BluetoothDevice[] = [
        {
          name: 'HC-05',
          address: '00:18:E4:34:XX:XX',
          connected: false
        },
        {
          name: 'Arduino-BT',
          address: '98:D3:31:XX:XX:XX',
          connected: false
        }
      ];
      
      console.log('Found simulated paired devices:', devices);
      return devices;
    } catch (error) {
      console.error('Failed to get paired devices:', error);
      return [];
    }
  }

  // Start device discovery (scan for new devices)
  async startDiscovery(): Promise<BluetoothDevice[]> {
    try {
      console.log('Starting real Bluetooth device discovery...');
      
      if (Platform.OS === 'android') {
        // Try to start real Bluetooth discovery
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          // Start discovery
          const discoveryStarted = await BluetoothAdapter.startDiscovery();
          if (discoveryStarted) {
            console.log('Bluetooth discovery started successfully');
            
            // Wait for discovery to complete (typically 10-12 seconds)
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            // Get discovered devices
            const devices = await BluetoothAdapter.getDiscoveredDevices();
            const discoveredDevices: BluetoothDevice[] = devices.map((device: any) => ({
              name: device.name || 'Unknown Device',
              address: device.address,
              connected: false
            }));
            
            console.log('Discovery completed, found real devices:', discoveredDevices);
            return discoveredDevices;
          }
        }
      }
      
      // Fallback: simulate device discovery
      console.log('Using simulated device discovery...');
      const discoveredDevices: BluetoothDevice[] = [
        {
          name: 'HC-05',
          address: '00:18:E4:34:XX:XX',
          connected: false
        },
        {
          name: 'Unknown Device',
          address: '12:34:56:78:90:AB',
          connected: false
        }
      ];

      // Simulate discovery delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('Simulated discovery completed, found devices:', discoveredDevices);
      return discoveredDevices;
    } catch (error) {
      console.error('Device discovery failed:', error);
      return [];
    }
  }

          // Connect to a device
        async connectToDevice(device: BluetoothDevice): Promise<boolean> {
          try {
            console.log(`Attempting to connect to ${device.name} (${device.address})...`);

            if (Platform.OS === 'android') {
              // Use real Bluetooth connection
              const BluetoothAdapter = NativeModules.BluetoothAdapter;
              console.log('BluetoothAdapter module:', BluetoothAdapter);
              console.log('Available methods:', BluetoothAdapter ? Object.keys(BluetoothAdapter) : 'Module not found');

              // Test if module is working
              if (BluetoothAdapter && BluetoothAdapter.testModule) {
                try {
                  const testResult = await BluetoothAdapter.testModule();
                  console.log('Module test result:', testResult);
                } catch (error) {
                  console.error('Module test failed:', error);
                }
              }

              // Debug: Log all available methods
              if (BluetoothAdapter) {
                console.log('All available methods in BluetoothAdapter:', Object.keys(BluetoothAdapter));
                console.log('Method types:', Object.keys(BluetoothAdapter).map(key => typeof BluetoothAdapter[key]));
              }

              // Try different method name variations for connectToDevice
              const connectMethod = BluetoothAdapter.connectToDevice || BluetoothAdapter.connecttodevice || BluetoothAdapter.connect;
              if (BluetoothAdapter && connectMethod) {
                console.log('Calling native connect method...');
                try {
                  const connected = await connectMethod(device.address);
                  if (connected) {
                    this.currentDevice = device;
                    this.isConnected = true;
                    console.log(`✅ Successfully connected to ${device.name} via real Bluetooth`);
                    console.log('✅ HC-05 LED should now be slower (connected state)');
                    return true;
                  } else {
                    console.error('❌ Real Bluetooth connection failed (returned false)');
                    console.warn('   💡 This usually means the device rejected the connection');
                    console.warn('      • Make sure HC-05 is in pairing mode');
                    console.warn('      • Try unpairing and re-pairing in phone Bluetooth settings');
                    return false;
                  }
                } catch (nativeError: any) {
                  // IOT COMMUNICATION STABILITY: Catch and log native module errors with details
                  const nativeErrorMsg = nativeError?.message || String(nativeError) || 'Unknown native error';
                  const nativeErrorCode = nativeError?.code || 'NATIVE_ERROR';
                  
                  console.error('❌ Native Bluetooth connection error:', nativeError);
                  console.error(`   Error code: ${nativeErrorCode}`);
                  console.error(`   Error message: ${nativeErrorMsg}`);
                  
                  // CRITICAL: Reset connection state on any connection error
                  // This prevents the app from thinking it's still connected
                  this.isConnected = false;
                  this.currentDevice = null;
                  
                  // Provide specific troubleshooting based on error
                  if (nativeErrorMsg.includes('read failed') || nativeErrorMsg.includes('socket might closed') || nativeErrorMsg.includes('timeout')) {
                    console.warn('   💡 Socket timeout/closed error detected');
                    console.warn('      • HC-05 may be disconnected or unreachable');
                    console.warn('      • Connection state has been reset');
                    console.warn('      • Try: 1) Unpair device in phone settings, 2) Power cycle HC-05, 3) Re-pair and try again');
                  } else if (nativeErrorCode === 'CONNECTION_FAILED') {
                    console.warn('   💡 All connection methods failed');
                    console.warn('      • Device may not be in pairing mode');
                    console.warn('      • Check HC-05 LED: fast blink = not paired, slow blink = connected');
                    console.warn('      • Try unpairing and re-pairing in phone Bluetooth settings');
                  } else if (nativeErrorCode === 'SECURITY_ERROR') {
                    console.warn('   💡 Bluetooth permissions issue');
                    console.warn('      • Grant Bluetooth permissions in phone settings');
                    console.warn('      • Restart app after granting permissions');
                  }
                  
                  return false;
                }
              } else {
                console.log('❌ BluetoothAdapter module or connect method not available');
                console.log('Available methods:', BluetoothAdapter ? Object.keys(BluetoothAdapter) : 'Module not found');
                return false;
              }
            }

            // No fallback - force real connection
            console.error('❌ No real Bluetooth connection available');
            return false;
          } catch (error: any) {
            // IOT COMMUNICATION STABILITY: Provide detailed error information for troubleshooting
            const errorMessage = error?.message || String(error) || 'Unknown error';
            const errorCode = error?.code || 'UNKNOWN';
            
            console.error('❌ Connection failed:', error);
            console.error(`   Error code: ${errorCode}`);
            console.error(`   Error message: ${errorMessage}`);
            
            // Provide specific troubleshooting hints based on error type
            if (errorMessage.includes('read failed') || errorMessage.includes('socket might closed') || errorMessage.includes('timeout')) {
              console.warn('   💡 Troubleshooting: Socket timeout/closed - device may be disconnected or unreachable');
              console.warn('      • Check if HC-05 is powered on and in pairing mode');
              console.warn('      • Try unpairing and re-pairing the device in phone Bluetooth settings');
              console.warn('      • Make sure device is not connected to another phone/computer');
              console.warn('      • Restart the HC-05 module if possible');
            } else if (errorCode === 'SECURITY_ERROR' || errorMessage.includes('permission')) {
              console.warn('   💡 Troubleshooting: Bluetooth permissions issue');
              console.warn('      • Grant Bluetooth permissions in phone settings');
              console.warn('      • Restart the app after granting permissions');
            } else if (errorCode === 'CONNECTION_FAILED') {
              console.warn('   💡 Troubleshooting: All connection methods failed');
              console.warn('      • Device may not be in pairing mode');
              console.warn('      • Try unpairing and re-pairing in phone Bluetooth settings');
              console.warn('      • Check if HC-05 LED is blinking (should blink when ready to pair)');
            }
            
            return false;
          }
        }

  // Disconnect from current device (manual disconnect only)
  async disconnect(): Promise<boolean> {
    try {
      if (this.currentDevice) {
        console.log(`Manually disconnecting from ${this.currentDevice.name}...`);
      }
      
      if (Platform.OS === 'android') {
        // Use real Bluetooth disconnection
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          await BluetoothAdapter.disconnect();
          console.log('Real Bluetooth disconnection completed');
        }
      }
      
      this.currentDevice = null;
      this.isConnected = false;
      console.log('Manually disconnected from device');
      return true;
    } catch (error) {
      console.error('Disconnection failed:', error);
      return false;
    }
  }

  // Check if connection is still active (without disconnecting)
  async isConnectionActive(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          const isActive = await BluetoothAdapter.isConnected();
          this.isConnected = isActive;
          console.log(`Connection status check: ${isActive ? 'Connected' : 'Disconnected'}`);
          return isActive;
        }
      }
      if (isDevEnv) {
        console.log(`Connection status (fallback): ${this.isConnected ? 'Connected' : 'Disconnected'}`);
      }
      return this.isConnected;
    } catch (error) {
      console.error('Failed to check connection status:', error);
      return this.isConnected;
    }
  }

  // Get current connection status without checking hardware
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Get current device info
  getCurrentDeviceInfo(): BluetoothDevice | null {
    return this.currentDevice;
  }

  // Send command to connected device with timeout protection
  async sendCommand(command: string, timeoutMs: number = 5000): Promise<boolean> {
    // DATA INTEGRITY: Validate command input
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      console.error('[BluetoothService] Invalid command: empty or non-string');
      return false;
    }
    
    // IOT COMMUNICATION STABILITY: Check connection status first to avoid timeout spam
    const isActive = await this.isConnectionActive();
    if (!isActive) {
      // Don't log error if not connected - this is expected when Bluetooth is off/disconnected
      // Only log at debug level to reduce console spam
      if (isDevEnv) {
        console.log('[BluetoothService] No device connected, skipping command send');
      }
      return false;
    }

    try {
      if (isDevEnv) {
        console.log(`[BluetoothService] Sending command "${command}" to connected device`);
      }
      
      // IOT COMMUNICATION STABILITY: Wrap native call in cancellable promise
      // Note: In React Native, setTimeout returns a number, not NodeJS.Timeout
      let timeoutId: number | null = null;
      let isResolved = false;
      
      const timeoutPromise = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            // Only log timeout if we actually tried to send (connection was active)
            console.warn(`[BluetoothService] ⚠️ Command send timeout after ${timeoutMs}ms (Bluetooth may be slow or disconnected)`);
            resolve(false);
          }
        }, timeoutMs);
      });
      
      const sendPromise = (async () => {
        try {
          if (Platform.OS === 'android') {
            // Use real Bluetooth data transmission
            const BluetoothAdapter = NativeModules.BluetoothAdapter;
            
            if (!BluetoothAdapter) {
              if (isDevEnv) {
                console.warn('[BluetoothService] BluetoothAdapter module not found');
              }
              return false;
            }
            
            // Try different method name variations
            const sendMethod = BluetoothAdapter.sendData || BluetoothAdapter.senddata || BluetoothAdapter.send;
            if (!sendMethod) {
              if (isDevEnv) {
                console.warn('[BluetoothService] No send method found in BluetoothAdapter');
              }
              return false;
            }
            
            if (isDevEnv) {
              console.log('[BluetoothService] Sending command to HC-05:', command.substring(0, 50));
            }
            
            // Wrap native call in promise - handle both sync and async returns
            let nativeResult: any;
            if (typeof sendMethod === 'function') {
              try {
                nativeResult = sendMethod(command);
                // If it returns a promise, await it; otherwise use the value directly
                if (nativeResult && typeof nativeResult.then === 'function') {
                  nativeResult = await nativeResult;
                }
              } catch (nativeError) {
                console.error('[BluetoothService] Native method error:', nativeError);
                return false;
              }
            } else {
              console.error('[BluetoothService] sendMethod is not a function');
              return false;
            }
            
            // Clear timeout if we got a result
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            
            if (isResolved) {
              // Timeout already fired, ignore result
              return false;
            }
            
            isResolved = true;
            
            if (nativeResult) {
              if (isDevEnv) {
                console.log(`[BluetoothService] ✅ Command sent successfully via Bluetooth`);
              }
              return true;
            } else {
              if (isDevEnv) {
                console.warn('[BluetoothService] ⚠️ Native method returned false');
              }
              return false;
            }
          }
          
          // iOS or other platforms - not implemented
          if (isDevEnv) {
            console.warn('[BluetoothService] Bluetooth send not implemented for this platform');
          }
          return false;
        } catch (error) {
          // Clear timeout on error
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          isResolved = true;
          console.error('[BluetoothService] Send promise error:', error);
          return false;
        }
      })();
      
      // Race between send and timeout
      const result = await Promise.race([sendPromise, timeoutPromise]);
      
      // Clean up timeout if still active
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      return result;
    } catch (error) {
      console.error('[BluetoothService] Command send failed:', error);
      return false;
    }
  }

  // Get connection status
  isDeviceConnected(): boolean {
    return this.isConnected;
  }

  // Listen for incoming data from Bluetooth device
  onDataReceived(callback: (data: string) => void): () => void {
    console.log('[BluetoothService] Setting up onDataReceived listener...');
    
    if (Platform.OS === 'android' && NativeModules.BluetoothAdapter) {
      const BluetoothAdapter = NativeModules.BluetoothAdapter;
      console.log('[BluetoothService] BluetoothAdapter module found:', !!BluetoothAdapter);
      console.log('[BluetoothService] Available methods:', BluetoothAdapter ? Object.keys(BluetoothAdapter) : 'none');
      
      // Use DeviceEventEmitter to listen for BluetoothDataReceived events
      // The native module emits events via DeviceEventManagerModule.RCTDeviceEventEmitter,
      // which is the global event emitter, so we use DeviceEventEmitter directly
      try {
        console.log('[BluetoothService] ✅ Setting up DeviceEventEmitter listener for BluetoothDataReceived...');
        
        // Use DeviceEventEmitter directly - this is the global event emitter that native modules use
        // This avoids NativeEventEmitter warnings when the module doesn't implement addListener
        const subscription = DeviceEventEmitter.addListener('BluetoothDataReceived', (event: any) => {
          // Java emits the data as a string directly, but React Native might wrap it
          let dataString: string;
          if (typeof event === 'string') {
            dataString = event;
          } else if (event?.data) {
            dataString = String(event.data);
          } else if (event?.message) {
            dataString = String(event.message);
          } else {
            dataString = String(event);
          }
          
          console.log('[BluetoothService] 📡 Raw event received:', event);
          console.log('[BluetoothService] 📡 Extracted data string:', dataString);
          
          if (dataString && dataString.trim().length > 0) {
            // Call callback with trimmed data
            callback(dataString.trim());
          } else {
            console.warn('[BluetoothService] ⚠️ Received empty or invalid data:', event);
          }
        });
        
        console.log('[BluetoothService] ✅ DeviceEventEmitter listener registered successfully');
        
        return () => {
          console.log('[BluetoothService] Cleaning up DeviceEventEmitter listener...');
          subscription.remove();
        };
      } catch (error) {
        console.error('[BluetoothService] ❌ Error setting up DeviceEventEmitter:', error);
      }
    } else {
      console.warn('[BluetoothService] ⚠️ BluetoothAdapter native module not available');
      if (Platform.OS !== 'android') {
        console.warn('[BluetoothService] Platform is not Android:', Platform.OS);
      }
    }
    
    // Return empty cleanup function if no listener available
    console.warn('[BluetoothService] ⚠️ Returning empty cleanup - listener not set up');
    return () => {
      console.log('[BluetoothService] Empty cleanup called');
    };
  }

  // Check real connection status
  async checkRealConnectionStatus(): Promise<boolean> {
    try {
      if (Platform.OS === 'android') {
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        if (BluetoothAdapter) {
          const realStatus = await BluetoothAdapter.isConnected();
          this.isConnected = realStatus;
          return realStatus;
        }
      }
      return this.isConnected;
    } catch (error) {
      console.error('Failed to check connection status:', error);
      return this.isConnected;
    }
  }

  // Get current device
  getCurrentDevice(): BluetoothDevice | null {
    return this.currentDevice;
  }

  // Listen for Bluetooth events
  onBluetoothStateChanged(callback: (enabled: boolean) => void): void {
    if (this.eventEmitter) {
      this.eventEmitter.addListener('BluetoothStateChanged', callback);
    }
  }


  // Remove event listeners
  removeAllListeners(): void {
    if (this.eventEmitter) {
      this.eventEmitter.removeAllListeners('BluetoothStateChanged');
    }
  }
}

export default new BluetoothService();
