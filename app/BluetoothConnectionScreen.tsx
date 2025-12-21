import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator, Modal, SafeAreaView, Platform, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService, { BluetoothDevice } from '@/services/BluetoothService';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const BluetoothConnectionScreen = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<BluetoothDevice | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [showDeviceModal, setShowDeviceModal] = useState<boolean>(false);

  useEffect(() => {
    checkBluetoothPermissions();
    checkCurrentConnectionStatus();
  }, []);

  const checkCurrentConnectionStatus = async () => {
    try {
      setCheckingConnection(true);
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
      setIsConnected(false);
    } finally {
      setCheckingConnection(false);
    }
  };

  const checkBluetoothPermissions = async () => {
    try {
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

      const granted = await BluetoothService.requestPermissions();
      if (granted) {
        console.log('Bluetooth permissions granted');
      } else {
        Alert.alert('Permission Required', 'Bluetooth permissions are required to connect to your pill container.');
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
      
      const isAvailable = await BluetoothService.isBluetoothAvailable();
      if (!isAvailable) {
        Alert.alert(
          'Bluetooth Required', 
          'Your phone\'s Bluetooth is currently off. Would you like to turn it on?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setIsScanning(false) },
            { 
              text: 'Turn On Bluetooth', 
              onPress: async () => {
                const enabled = await BluetoothService.enableBluetooth();
                if (enabled) {
                  setTimeout(() => scanForDevices(), 1000);
                } else {
                  setIsScanning(false);
                }
              }
            }
          ]
        );
        return;
      }
      
      const pairedDevices = await BluetoothService.getPairedDevices();
      setDevices(pairedDevices);
      
      const discoveredDevices = await BluetoothService.startDiscovery();
      const combined = [...pairedDevices, ...discoveredDevices];
      setDevices(combined);
      
      if (combined.length === 0) {
        Alert.alert(
          'No Devices Found',
          'No Bluetooth devices were found.\n\nPlease:\n1) Pair HC-05 in Android Settings (PIN 1234 or 0000)\n2) Keep HC-05 powered on (LED blinking)\n3) Then tap Scan again.',
          [{ text: 'OK' }]
        );
        setShowDeviceModal(false);
      } else {
        // Show devices in popup modal
        setShowDeviceModal(true);
      }
      
      setIsScanning(false);
    } catch (error) {
      console.error('Scan error:', error);
      setIsScanning(false);
      const message = error instanceof Error ? error.message : 'Unknown error';
      
      if (message.toLowerCase().includes('bluetooth is not enabled')) {
        Alert.alert(
          'Bluetooth Not Enabled',
          'Bluetooth needs to be turned on to scan for devices. Would you like to turn it on?',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Turn On Bluetooth', 
              onPress: async () => {
                const enabled = await BluetoothService.enableBluetooth();
                if (enabled) {
                  setTimeout(() => scanForDevices(), 1000);
                }
              }
            }
          ]
        );
      } else {
        Alert.alert('Error', `Failed to scan for devices: ${message}`);
      }
    }
  };

  const connectToDevice = async (device: BluetoothDevice): Promise<void> => {
    try {
      setIsScanning(false); // Stop scanning when connecting
      const success = await BluetoothService.connectToDevice(device);
      if (success) {
        setIsConnected(true);
        setSelectedDevice(device);
        setShowDeviceModal(false); // Close modal after successful connection
        Alert.alert(
          'Connected Successfully!', 
          `Connected to ${device.name}!\n\nYou can now proceed to login.`,
          [{ text: 'Great!' }]
        );
        console.log(`Connection established with ${device.name}`);
      } else {
        Alert.alert(
          'Connection Failed', 
          'Failed to establish Bluetooth connection. Please try again.\n\nMake sure:\n• Device is powered on\n• Device is in pairing mode\n• Device is not connected to another phone'
        );
      }
    } catch (error: any) {
      console.error('Connection error:', error);
      const errorMessage = error?.message || 'Failed to connect to device';
      Alert.alert(
        'Connection Error', 
        errorMessage + '\n\nTroubleshooting:\n• Unpair and re-pair the device in phone settings\n• Make sure device is not connected elsewhere\n• Restart the device if needed',
        [
          { text: 'OK' },
          { 
            text: 'Retry', 
            onPress: () => connectToDevice(device) 
          }
        ]
      );
    }
  };

  const handleContinueToLogin = () => {
    if (!isConnected) {
      Alert.alert(
        'Bluetooth Not Connected',
        'Please connect to your pill container via Bluetooth before logging in. This ensures you can control your medication reminders.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Scan for Devices', onPress: scanForDevices }
        ]
      );
      return;
    }
    router.replace('/LoginScreen');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <ScrollView 
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="medical" size={70} color={theme.primary} />
          <Text style={[styles.title, { color: theme.primary }]}>PillNow</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Connect Your Pill Container</Text>
        </View>

      {/* Connection Status Card */}
      <View style={[styles.statusCard, { backgroundColor: theme.card, borderColor: isConnected ? theme.success : theme.border }]}>
        <Ionicons 
          name={isConnected ? "bluetooth" : "bluetooth-outline"} 
          size={48} 
          color={isConnected ? theme.success : theme.textSecondary} 
        />
        <Text style={[styles.statusText, { color: isConnected ? theme.success : theme.textSecondary }]}>
          {isConnected ? 'Connected' : 'Not Connected'}
        </Text>
        {selectedDevice && (
          <Text style={[styles.deviceName, { color: theme.text }]}>{selectedDevice.name}</Text>
        )}
      </View>

      {/* Instructions */}
      <View style={[styles.instructionsCard, { backgroundColor: theme.card }]}>
        <Ionicons name="information-circle" size={24} color={theme.primary} />
        <Text style={[styles.instructionsTitle, { color: theme.secondary }]}>IMPORTANT</Text>
        <Text style={[styles.instructionsText, { color: theme.text }]}>
          Please connect to your PillNow container via Bluetooth before logging in. This allows the app to:
        </Text>
        <View style={styles.bulletList}>
          <View style={styles.bulletItem}>
            <Ionicons name="checkmark-circle" size={20} color={theme.success} />
            <Text style={[styles.bulletText, { color: theme.text }]}>Control medication reminders</Text>
          </View>
          <View style={styles.bulletItem}>
            <Ionicons name="checkmark-circle" size={20} color={theme.success} />
            <Text style={[styles.bulletText, { color: theme.text }]}>Receive alerts and notifications</Text>
          </View>
          <View style={styles.bulletItem}>
            <Ionicons name="checkmark-circle" size={20} color={theme.success} />
            <Text style={[styles.bulletText, { color: theme.text }]}>Sync schedules with your device</Text>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.scanButton, { backgroundColor: theme.primary }]}
          onPress={scanForDevices}
          disabled={isScanning}
        >
          {isScanning ? (
            <ActivityIndicator color={theme.card} />
          ) : (
            <>
              <Ionicons name="search" size={24} color={theme.card} />
              <Text style={[styles.scanButtonText, { color: theme.card }]}>SCAN FOR DEVICES</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Device List Modal - Popup instead of scrolling */}
        <Modal
          visible={showDeviceModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowDeviceModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>AVAILABLE DEVICES</Text>
                <TouchableOpacity 
                  onPress={() => setShowDeviceModal(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close-circle" size={28} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
              
              {devices.length > 0 ? (
                <ScrollView 
                  style={styles.modalDeviceList}
                  showsVerticalScrollIndicator={true}
                >
                  {devices.map((device, index) => {
                    const isCurrentDevice = selectedDevice?.address === device.address;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.deviceItem,
                          { 
                            backgroundColor: isCurrentDevice ? theme.primary + '20' : theme.background,
                            borderColor: isCurrentDevice ? theme.primary : theme.border
                          }
                        ]}
                        onPress={() => {
                          connectToDevice(device);
                          setShowDeviceModal(false);
                        }}
                      >
                        <Ionicons 
                          name={isCurrentDevice ? "bluetooth" : "bluetooth-outline"} 
                          size={24} 
                          color={isCurrentDevice ? theme.primary : theme.textSecondary} 
                        />
                        <View style={styles.deviceInfo}>
                          <Text style={[styles.deviceItemName, { color: theme.text }]}>{device.name}</Text>
                          <Text style={[styles.deviceItemAddress, { color: theme.textSecondary }]}>{device.address}</Text>
                        </View>
                        {isCurrentDevice && (
                          <Ionicons name="checkmark-circle" size={24} color={theme.success} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : (
                <View style={styles.emptyDevicesContainer}>
                  <Ionicons name="bluetooth-outline" size={48} color={theme.textSecondary} />
                  <Text style={[styles.emptyDevicesText, { color: theme.textSecondary }]}>
                    No devices found
                  </Text>
                </View>
              )}
              
              <TouchableOpacity
                style={[styles.modalCloseButton, { backgroundColor: theme.primary }]}
                onPress={() => setShowDeviceModal(false)}
              >
                <Text style={[styles.modalCloseButtonText, { color: theme.card }]}>CLOSE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Continue Button */}
        <TouchableOpacity 
          style={[
            styles.continueButton, 
            { 
              backgroundColor: isConnected ? theme.success : theme.textSecondary,
              opacity: isConnected ? 1 : 0.6
            }
          ]}
          onPress={handleContinueToLogin}
        >
          <Text style={[styles.continueButtonText, { color: theme.card }]}>
            {isConnected ? 'CONTINUE TO LOGIN' : 'CONNECT FIRST TO CONTINUE'}
          </Text>
        </TouchableOpacity>

        {/* Skip Option (Optional - for testing) */}
        <TouchableOpacity 
          style={styles.skipButton}
          onPress={() => {
            Alert.alert(
              'Skip Bluetooth Connection',
              'You can connect Bluetooth later from the dashboard. Continue to login?',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue', onPress: () => router.replace('/LoginScreen') }
              ]
            );
          }}
        >
          <Text style={[styles.skipButtonText, { color: theme.textSecondary }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Platform.OS === 'ios' ? 40 : 30,
    paddingTop: Platform.OS === 'ios' ? 10 : 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 20 : 40,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  statusCard: {
    alignItems: 'center',
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    borderWidth: 2,
    minHeight: 120,
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 12,
  },
  deviceName: {
    fontSize: 14,
    marginTop: 8,
  },
  instructionsCard: {
    padding: 18,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  instructionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 12,
  },
  instructionsText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  bulletList: {
    width: '100%',
    gap: 12,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulletText: {
    fontSize: 14,
    flex: 1,
  },
  buttonContainer: {
    paddingHorizontal: 20,
    gap: 16,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 12,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  deviceList: {
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  deviceListTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1.5,
    gap: 12,
    minHeight: 64,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceItemName: {
    fontSize: 16,
    fontWeight: '600',
  },
  deviceItemAddress: {
    fontSize: 12,
    marginTop: 2,
  },
  continueButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    fontSize: 14,
  },
  // Modal styles for device popup
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '90%',
    maxWidth: 420,
    maxHeight: SCREEN_HEIGHT * 0.75,
    borderRadius: 20,
    padding: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
  },
  closeButton: {
    padding: 4,
    marginLeft: 8,
  },
  modalDeviceList: {
    maxHeight: SCREEN_HEIGHT * 0.5,
    marginBottom: 12,
  },
  emptyDevicesContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyDevicesText: {
    fontSize: 16,
    marginTop: 10,
    textAlign: 'center',
  },
  modalCloseButton: {
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default BluetoothConnectionScreen;

