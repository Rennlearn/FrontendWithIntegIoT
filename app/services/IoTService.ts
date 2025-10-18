import RNBluetoothClassic from 'react-native-bluetooth-classic';
// Use a permissive type to avoid TypeScript mismatches with native module typings
const BluetoothModule: any = RNBluetoothClassic as any;

export interface IoTDevice {
  name: string;
  address: string;
  connected: boolean;
}

export interface IoTStatus {
  led: boolean;
  buzzer: boolean;
  connected: boolean;
  lastCommand: string;
  smsEnabled: boolean;
}

class IoTService {
  private currentDevice: IoTDevice | null = null;
  private isConnected: boolean = false;
  private status: IoTStatus = {
    led: false,
    buzzer: false,
    connected: false,
    lastCommand: '',
    smsEnabled: true
  };

  // Initialize the IoT service
  async initialize(): Promise<boolean> {
    try {
      // Check if Bluetooth is enabled
      const isEnabled = await BluetoothModule.isBluetoothEnabled();
      if (!isEnabled) {
        throw new Error('Bluetooth is not enabled');
      }

      // Request permissions
      const granted = await BluetoothModule.requestPermissions?.();
      if (!granted) {
        throw new Error('Bluetooth permissions not granted');
      }
      return true;
    } catch (error) {
      console.error('IoT Service initialization failed:', error);
      return false;
    }
  }

  // Scan for available devices
  async scanForDevices(): Promise<IoTDevice[]> {
    try {
      // Check if Bluetooth is enabled
      const isEnabled = await BluetoothModule.isBluetoothEnabled();
      if (!isEnabled) {
        throw new Error('Bluetooth is not enabled');
      }

      // Get bonded devices first
      const bondedDevices = await BluetoothModule.getBondedDevices();
      const bondedDeviceList = bondedDevices.map((device: any) => ({
        name: device.name || 'Unknown Device',
        address: device.address,
        connected: false
      }));

      // Then discover new devices
      const discoveredDevices = await BluetoothModule.startDiscovery();
      const discoveredDeviceList = discoveredDevices.map((device: any) => ({
        name: device.name || 'Unknown Device',
        address: device.address,
        connected: false
      }));

      return [...bondedDeviceList, ...discoveredDeviceList];
    } catch (error) {
      console.error('Device scan failed:', error);
      throw error;
    }
  }

  // Connect to a specific device
  async connectToDevice(device: IoTDevice): Promise<boolean> {
    try {
      await BluetoothModule.connectToDevice(device.address);
      this.currentDevice = device;
      this.isConnected = true;
      this.status.connected = true;
      this.status.lastCommand = 'Connected';
      
      // Send initial status check
      await this.sendCommand('STATUS');
      
      return true;
    } catch (error) {
      console.error('Device connection failed:', error);
      this.isConnected = false;
      this.status.connected = false;
      throw error;
    }
  }

  // Disconnect from current device
  async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        await BluetoothModule.disconnect?.();
      }
      this.currentDevice = null;
      this.isConnected = false;
      this.status = {
        led: false,
        buzzer: false,
        connected: false,
        lastCommand: 'Disconnected',
        smsEnabled: true
      };
    } catch (error) {
      console.error('Device disconnection failed:', error);
      throw error;
    }
  }

  // Send command to IoT device
  async sendCommand(command: string): Promise<void> {
    if (!this.isConnected || !this.currentDevice) {
      throw new Error('No device connected');
    }

    try {
      await BluetoothModule.writeToDevice(this.currentDevice.address, command);
      this.status.lastCommand = command;
      
      // Update local status based on command
      this.updateLocalStatus(command);
      
      console.log('Command sent successfully:', command);
    } catch (error) {
      console.error('Command sending failed:', error);
      throw error;
    }
  }

  // Update local status based on sent commands
  private updateLocalStatus(command: string): void {
    switch (command) {
      case 's': // Send SMS command
        this.status.led = true;
        this.status.buzzer = true;
        break;
      case 'r': // Receive SMS command
        this.status.smsEnabled = true;
        break;
      case 'c': // Call command
        break;
      case 'TURN ON':
        this.status.led = true;
        this.status.buzzer = true;
        break;
      case 'TURN OFF':
        this.status.led = false;
        this.status.buzzer = false;
        break;
    }
  }

  // Send SMS (triggers LED and buzzer)
  async sendSMS(_message?: string): Promise<void> {
    // Hardware protocol uses 's' to trigger SMS/alert logic; optional message is ignored here
    await this.sendCommand('s');
  }

  // Start receiving SMS
  async startReceivingSMS(): Promise<void> {
    await this.sendCommand('r');
  }

  // Make a call
  async makeCall(): Promise<void> {
    await this.sendCommand('c');
  }

  // Turn ON LED and buzzer (via SMS command)
  async turnOnLED(): Promise<void> {
    await this.sendCommand('TURN ON');
  }

  // Turn OFF LED and buzzer (via SMS command)
  async turnOffLED(): Promise<void> {
    await this.sendCommand('TURN OFF');
  }

  // Trigger medication alert (same as sendSMS)
  async triggerAlert(): Promise<void> {
    await this.sendCommand('s');
  }

  // Stop alert
  async stopAlert(): Promise<void> {
    await this.sendCommand('TURN OFF');
  }

  // Get current status
  getStatus(): IoTStatus {
    return { ...this.status };
  }

  // Get current device
  getCurrentDevice(): IoTDevice | null {
    return this.currentDevice;
  }

  // Check if connected
  isDeviceConnected(): boolean {
    return this.isConnected;
  }

  // Listen for data from device
  onDataReceived(callback: (data: string) => void): void {
    BluetoothModule.onDataReceived?.((data: any) => {
      console.log('Data received from device:', data);
      callback(String(data));
    });
  }

  // Listen for connection state changes
  onConnectionStateChanged(callback: (connected: boolean) => void): void {
    BluetoothModule.onConnectionStateChanged?.((state: any) => {
      const isConnected = Boolean(state?.connected);
      this.isConnected = isConnected;
      this.status.connected = isConnected;
      callback(isConnected);
    });
  }

  // Remove listeners
  removeListeners(): void {
    BluetoothModule.removeAllListeners?.();
  }
}

// Export singleton instance
export const iotService = new IoTService();
export default iotService;










