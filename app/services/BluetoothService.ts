import { Platform, PermissionsAndroid, NativeModules, NativeEventEmitter, Linking, Alert } from 'react-native';

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
    // Initialize native module if available
    if (NativeModules.BluetoothManager) {
      this.eventEmitter = new NativeEventEmitter(NativeModules.BluetoothManager);
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
                const connected = await connectMethod(device.address);
                if (connected) {
                  this.currentDevice = device;
                  this.isConnected = true;
                  console.log(`✅ Successfully connected to ${device.name} via real Bluetooth`);
                  console.log('✅ HC-05 LED should now be slower (connected state)');
                  return true;
                } else {
                  console.error('❌ Real Bluetooth connection failed');
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
          } catch (error) {
            console.error('❌ Connection failed:', error);
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
      console.log(`Connection status (fallback): ${this.isConnected ? 'Connected' : 'Disconnected'}`);
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

  // Send command to connected device
  async sendCommand(command: string): Promise<boolean> {
    // Check if we have an active connection
    const isActive = await this.isConnectionActive();
    if (!isActive) {
      console.error('No device connected');
      return false;
    }

    try {
      console.log(`Sending command "${command}" to connected device`);
      
      if (Platform.OS === 'android') {
        // Use real Bluetooth data transmission
        const BluetoothAdapter = NativeModules.BluetoothAdapter;
        console.log('Available methods for sendData:', BluetoothAdapter ? Object.keys(BluetoothAdapter) : 'Module not found');
        
        if (BluetoothAdapter) {
          // Try different method name variations
          const sendMethod = BluetoothAdapter.sendData || BluetoothAdapter.senddata || BluetoothAdapter.send;
          if (sendMethod) {
            console.log('Using send method:', sendMethod);
            console.log('Sending command to HC-05:', command);
            console.log('Command type:', typeof command);
            console.log('Command length:', command.length);
            
            const sent = await sendMethod(command);
            if (sent) {
              console.log(`✅ Command "${command}" sent successfully via real Bluetooth to HC-05`);
              console.log('✅ Data transmission completed - check Arduino Serial Monitor');
              return true;
            } else {
              console.error('❌ Real Bluetooth data transmission failed');
              return false;
            }
          } else {
            console.log('❌ No send method found, available methods:', Object.keys(BluetoothAdapter));
            return false;
          }
        }
      }
      
      // No fallback - force real data transmission
      console.error('❌ No real Bluetooth data transmission available');
      return false;
    } catch (error) {
      console.error('Command send failed:', error);
      return false;
    }
  }

  // Get connection status
  isDeviceConnected(): boolean {
    return this.isConnected;
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
