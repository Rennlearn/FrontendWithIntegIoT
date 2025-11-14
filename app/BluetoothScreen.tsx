import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import BluetoothService, { BluetoothDevice } from './services/BluetoothService';

const BluetoothScreen = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null);
  const [ledStatus, setLedStatus] = useState(false);
  const [buzzerStatus, setBuzzerStatus] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('+1234567890');
  const [locateBoxActive, setLocateBoxActive] = useState(false);
  const [syncingRtc, setSyncingRtc] = useState(false);

  useEffect(() => {
    checkBluetoothPermissions();
    checkCurrentConnectionStatus();
    // Don't auto-disconnect when component unmounts - keep connection persistent
  }, []);

  const checkCurrentConnectionStatus = async () => {
    try {
      const isConnected = await BluetoothService.isConnectionActive();
      const currentDevice = BluetoothService.getCurrentDeviceInfo();
      
      if (isConnected && currentDevice) {
        setIsConnected(true);
        setSelectedDevice(currentDevice);
        console.log(`Restored connection to ${currentDevice.name}`);
      } else {
        setIsConnected(false);
        setSelectedDevice(null);
      }
    } catch (error) {
      console.error('Error checking current connection status:', error);
    }
  };

  const checkBluetoothPermissions = async () => {
    try {
      // Check if Bluetooth is available
      const isAvailable = await BluetoothService.isBluetoothAvailable();
      if (!isAvailable) {
        Alert.alert(
          'Bluetooth Required', 
          'Your phone\'s Bluetooth is currently off. Would you like to turn it on?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Turn On Bluetooth', onPress: () => enableBluetooth() }
          ]
        );
        return;
      }

      // Request permissions
      const granted = await BluetoothService.requestPermissions();
      if (granted) {
        console.log('Bluetooth permissions granted');
      } else {
        Alert.alert('Permission Required', 'Bluetooth permissions are required to connect to IoT devices');
      }
    } catch (error) {
      console.error('Permission error:', error);
      Alert.alert('Error', 'Failed to check Bluetooth permissions');
    }
  };

  const enableBluetooth = async () => {
    try {
      const success = await BluetoothService.enableBluetooth();
      if (success) {
        Alert.alert(
          'Bluetooth Enabled', 
          'Bluetooth has been turned on! You can now scan for devices.',
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', 'Failed to enable Bluetooth. Please check your phone settings.');
      }
    } catch (error) {
      console.error('Failed to enable Bluetooth:', error);
      Alert.alert('Error', 'Failed to enable Bluetooth. Please check your phone settings.');
    }
  };

  const scanForDevices = async (): Promise<void> => {
    try {
      setIsScanning(true);
      
      // First get paired devices
      const pairedDevices = await BluetoothService.getPairedDevices();
      setDevices(pairedDevices);
      
      // Then start discovery for new devices
      const discoveredDevices = await BluetoothService.startDiscovery();
      setDevices((prevDevices: BluetoothDevice[]) => [...prevDevices, ...discoveredDevices]);
      
      setIsScanning(false);
    } catch (error) {
      console.error('Scan error:', error);
      setIsScanning(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Error', `Failed to scan for devices: ${message}`);
    }
  };

  const connectToDevice = async (device: BluetoothDevice): Promise<void> => {
    try {
      const success = await BluetoothService.connectToDevice(device);
      if (success) {
        setIsConnected(true);
        setSelectedDevice(device);
        Alert.alert(
          'Connected Successfully!', 
          `Real Bluetooth connection established with ${device.name}!\n\nYou can now control your IoT hardware.`,
          [{ text: 'Great!' }]
        );
        console.log(`Real connection established with ${device.name}`);
      } else {
        Alert.alert('Connection Failed', 'Failed to establish real Bluetooth connection. Please try again.');
      }
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Error', 'Failed to connect to device');
    }
  };

  const disconnectDevice = async () => {
    try {
      await BluetoothService.disconnect();
      setIsConnected(false);
      setSelectedDevice(null);
      setLedStatus(false);
      setBuzzerStatus(false);
      setLocateBoxActive(false);
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };

  const sendCommand = async (command: string): Promise<void> => {
    if (!isConnected) {
      Alert.alert('Not Connected', 'Please connect to a device first');
      return;
    }

    try {
      console.log(`Sending real command "${command}" to HC-05...`);
      const success = await BluetoothService.sendCommand(command);
      if (success) {
        console.log(`Real command "${command}" sent successfully to Arduino via HC-05`);
        Alert.alert('Command Sent!', `"${command}" sent to your Arduino hardware!`);
      } else {
        Alert.alert('Command Failed', 'Failed to send command to hardware. Check connection.');
      }
    } catch (error) {
      console.error('Command error:', error);
      Alert.alert('Command Error', 'Failed to send command to hardware.');
    }
  };

  const handleConnect = () => {
    if (isConnected) {
      disconnectDevice();
    } else {
      scanForDevices();
    }
  };

  const toggleLED = () => {
    const command = ledStatus ? 'TURN OFF' : 'TURN ON';
    sendCommand(command);
    setLedStatus(!ledStatus);
  };

  const toggleBuzzer = () => {
    const command = buzzerStatus ? 'TURN OFF' : 'TURN ON';
    sendCommand(command);
    setBuzzerStatus(!buzzerStatus);
  };

  const triggerAlert = () => {
    sendCommand('s'); // Send SMS command (triggers LED and buzzer)
    setLedStatus(true);
    setBuzzerStatus(true);
    Alert.alert('Alert Sent', 'SMS sent and LED/Buzzer activated!');
  };

  const stopAlert = () => {
    sendCommand('TURN OFF');
    setLedStatus(false);
    setBuzzerStatus(false);
  };

  const sendSMS = () => {
    sendCommand('s'); // Send SMS command (triggers LED and buzzer)
    setLedStatus(true);
    setBuzzerStatus(true);
    Alert.alert('SMS Sent', 'SMS sent and LED/Buzzer activated!');
  };

  const startReceivingSMS = () => {
    sendCommand('r'); // Start receiving SMS
    Alert.alert('SMS Listening', 'Device is now listening for SMS commands');
  };

  const makeCall = () => {
    sendCommand('c'); // Make a call
    Alert.alert('Call Initiated', 'Calling the registered number...');
  };

  const startLocateBox = () => {
    sendCommand('LOCATE'); // Start locate box (buzzer will buzz)
    setLocateBoxActive(true);
    Alert.alert('Locate Box Started', 'Buzzer is now buzzing to help you find the box!');
  };

  const stopLocateBox = () => {
    sendCommand('STOP_LOCATE'); // Stop locate box (buzzer will stop)
    setLocateBoxActive(false);
    Alert.alert('Locate Box Stopped', 'Buzzer has been turned off.');
  };

  const syncRtc = async () => {
    setSyncingRtc(true);
    try {
      const now = new Date();
      const Y = now.getFullYear();
      const M = String(now.getMonth() + 1).padStart(2, '0');
      const D = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const msg = `SETTIME ${Y}-${M}-${D} ${hh}:${mm}:${ss}`;
      await sendCommand(msg);
      Alert.alert('RTC Sync', 'Phone time sent to Arduino!');
    } catch (err) {
      Alert.alert('Error', 'Failed to sync RTC');
    } finally {
      setSyncingRtc(false);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary }]}>
          IOT <Text style={[styles.highlight, { color: theme.primary }]}>CONTROL</Text>
        </Text>
      </View>

      {/* Connection Status */}
      <View style={[styles.statusContainer, { backgroundColor: theme.card }]}>
        <Ionicons 
          name="bluetooth" 
          size={60} 
          color={isConnected ? theme.success : theme.textSecondary} 
        />
        <Text style={[styles.statusText, { color: theme.text }]}>
          {isConnected ? `Connected to ${selectedDevice?.name}` : 'Disconnected'}
        </Text>
        {isConnected && (
          <Text style={[styles.persistentText, { color: theme.success }]}>
            🔗 Connection will persist until manually disconnected
          </Text>
        )}
        <TouchableOpacity 
          style={[
            styles.connectButton, 
            { backgroundColor: isConnected ? theme.warning : theme.primary }
          ]}
          onPress={handleConnect}
        >
          <Text style={[styles.buttonText, { color: theme.card }]}>
            {isScanning ? 'SCANNING...' : isConnected ? 'DISCONNECT' : 'SCAN & CONNECT'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Device List */}
      {!isConnected && devices.length > 0 && (
        <View style={[styles.deviceList, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Available Devices:</Text>
          {devices.map((device, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.deviceItem, { borderColor: theme.border }]}
              onPress={() => connectToDevice(device)}
            >
              <Ionicons name="bluetooth" size={24} color={theme.primary} />
              <Text style={[styles.deviceName, { color: theme.text }]}>{device.name}</Text>
              <Text style={[styles.deviceAddress, { color: theme.textSecondary }]}>{device.address}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* IoT Controls */}
      {isConnected && (
        <View style={[styles.controlsContainer, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>IoT Device Controls</Text>
          
          {/* Test Connection */}
          <View style={styles.controlRow}>
            <Ionicons name="checkmark-circle" size={30} color={theme.success} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Test ON (s)</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.success }]}
              onPress={() => sendCommand('s')}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>TEST ON</Text>
            </TouchableOpacity>
          </View>

          {/* Test OFF */}
          <View style={styles.controlRow}>
            <Ionicons name="close-circle" size={30} color={theme.error} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Test OFF (r)</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.error }]}
              onPress={() => sendCommand('r')}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>TEST OFF</Text>
            </TouchableOpacity>
          </View>

          {/* LED Control */}
          <View style={styles.controlRow}>
            <Ionicons 
              name="bulb" 
              size={30} 
              color={ledStatus ? theme.success : theme.textSecondary} 
            />
            <Text style={[styles.controlLabel, { color: theme.text }]}>LED</Text>
            <TouchableOpacity 
              style={[
                styles.controlButton, 
                { backgroundColor: ledStatus ? theme.success : theme.primary }
              ]}
              onPress={toggleLED}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>
                {ledStatus ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Buzzer Control */}
          <View style={styles.controlRow}>
            <Ionicons 
              name="volume-high" 
              size={30} 
              color={buzzerStatus ? theme.success : theme.textSecondary} 
            />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Buzzer</Text>
            <TouchableOpacity 
              style={[
                styles.controlButton, 
                { backgroundColor: buzzerStatus ? theme.success : theme.primary }
              ]}
              onPress={toggleBuzzer}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>
                {buzzerStatus ? 'ON' : 'OFF'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Alert Control */}
          <View style={styles.controlRow}>
            <Ionicons name="notifications" size={30} color={theme.warning} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Medication Alert</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.warning }]}
              onPress={triggerAlert}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>ALERT</Text>
            </TouchableOpacity>
          </View>

          {/* Stop Alert */}
          <View style={styles.controlRow}>
            <Ionicons name="stop-circle" size={30} color={theme.error} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Stop Alert</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.error }]}
              onPress={stopAlert}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>STOP</Text>
            </TouchableOpacity>
          </View>

          {/* SMS Control */}
          <View style={styles.controlRow}>
            <Ionicons name="mail" size={30} color={theme.primary} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Send SMS</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.primary }]}
              onPress={sendSMS}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>SMS</Text>
            </TouchableOpacity>
          </View>

          {/* Receive SMS Control */}
          <View style={styles.controlRow}>
            <Ionicons name="mail-open" size={30} color={theme.secondary} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Listen for SMS</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.secondary }]}
              onPress={startReceivingSMS}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>LISTEN</Text>
            </TouchableOpacity>
          </View>

          {/* Call Control */}
          <View style={styles.controlRow}>
            <Ionicons name="call" size={30} color={theme.success} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Make Call</Text>
            <TouchableOpacity 
              style={[styles.controlButton, { backgroundColor: theme.success }]}
              onPress={makeCall}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>CALL</Text>
            </TouchableOpacity>
          </View>

          {/* Locate Box Control */}
          <View style={styles.controlRow}>
            <Ionicons 
              name="location" 
              size={30} 
              color={locateBoxActive ? theme.warning : theme.primary} 
            />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Locate Box</Text>
            <TouchableOpacity 
              style={[
                styles.controlButton, 
                { backgroundColor: locateBoxActive ? theme.warning : theme.primary }
              ]}
              onPress={locateBoxActive ? stopLocateBox : startLocateBox}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>
                {locateBoxActive ? 'DONE' : 'LOCATE'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sync RTC Control */}
          <View style={styles.controlRow}>
            <Ionicons name="calendar" size={30} color={theme.primary} />
            <Text style={[styles.controlLabel, { color: theme.text }]}>Sync RTC (SETTIME)</Text>
            <TouchableOpacity
              style={[styles.controlButton, { backgroundColor: theme.primary }]}
              onPress={syncRtc}
              disabled={syncingRtc}
            >
              <Text style={[styles.controlButtonText, { color: theme.card }]}>
                {syncingRtc ? 'SYNCING...' : 'SYNC RTC'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    marginTop: 40,
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  backButton: {
    padding: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  highlight: {
    color: '#4A90E2',
  },
  statusContainer: {
    alignItems: 'center',
    padding: 20,
    borderRadius: 15,
    marginVertical: 20,
    elevation: 5,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginVertical: 10,
    textAlign: 'center',
  },
  persistentText: {
    fontSize: 12,
    fontWeight: 'normal',
    marginBottom: 10,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  connectButton: {
    padding: 15,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
    elevation: 3,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  deviceList: {
    padding: 15,
    borderRadius: 15,
    marginVertical: 10,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 10,
    flex: 1,
  },
  deviceAddress: {
    fontSize: 12,
    marginLeft: 10,
  },
  controlsContainer: {
    padding: 20,
    borderRadius: 15,
    marginVertical: 10,
    elevation: 5,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  controlLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
    marginLeft: 15,
  },
  controlButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    elevation: 2,
  },
  controlButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});

export default BluetoothScreen;