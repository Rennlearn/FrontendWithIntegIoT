import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert, AppState, ScrollView } from "react-native";
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import BluetoothService from './services/BluetoothService';

const isDevEnv = typeof globalThis !== 'undefined' && Boolean((globalThis as any).__DEV__);

const ElderDashboard = () => {
  const router = useRouter();
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
  const [locateBoxActive, setLocateBoxActive] = useState(false);
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  
  // Legacy design: no real-time notification center or monitoring dashboard

  // Check Bluetooth connection status on component mount
  useEffect(() => {
    checkBluetoothConnection();
    
    // Check connection status every 3 seconds for faster response
    const interval = setInterval(checkBluetoothConnection, 3000);
    
    return () => clearInterval(interval);
  }, []);

  // Also check when app becomes active (when navigating back)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        if (isDevEnv) {
          console.log('App became active - checking connection status');
        }
        checkBluetoothConnection();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
  }, []);

  const checkBluetoothConnection = async () => {
    try {
      // First check the cached status for immediate response
      const cachedStatus = BluetoothService.getConnectionStatus();
      setIsBluetoothConnected(cachedStatus);
      
      // Then verify with hardware for accuracy
      const isConnected = await BluetoothService.isConnectionActive();
      setIsBluetoothConnected(isConnected);
      
      if (isDevEnv) {
        console.log(`ElderDashboard connection check: ${isConnected ? 'Connected' : 'Disconnected'}`);
      }
    } catch (error) {
      console.error('Error checking Bluetooth connection:', error);
      setIsBluetoothConnected(false);
    }
  };

  const handleLocateBox = async () => {
    if (!isBluetoothConnected) {
      Alert.alert(
        'Bluetooth Not Connected',
        'Please connect to your pill box first by going to Bluetooth settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Go to Bluetooth', onPress: () => router.push('/BluetoothScreen') }
        ]
      );
      return;
    }

    try {
      if (locateBoxActive) {
        // Stop locate box
        const success = await BluetoothService.sendCommand('STOP_LOCATE');
        if (success) {
          setLocateBoxActive(false);
          Alert.alert('Locate Box Stopped', 'Buzzer has been turned off.');
        } else {
          Alert.alert('Error', 'Failed to stop locate box. Please try again.');
        }
      } else {
        // Start locate box
        const success = await BluetoothService.sendCommand('LOCATE');
        if (success) {
          setLocateBoxActive(true);
          Alert.alert('Locate Box Started', 'Buzzer is now buzzing to help you find the box!');
        } else {
          Alert.alert('Error', 'Failed to start locate box. Please try again.');
        }
      }
    } catch (error) {
      console.error('Locate box error:', error);
      Alert.alert('Error', 'Failed to control locate box. Please check your connection.');
    }
  };


  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('token');
      router.push('/LoginScreen');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.push('/LoginScreen')}
        >
          
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary }]}>
          WELCOME TO, <Text style={[styles.highlight, { color: theme.primary }]}>PILLNOW</Text>
        </Text>
        <TouchableOpacity 
          style={styles.logoutButton} 
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={30} color={theme.text} />
        </TouchableOpacity>
      </View>

      

      {/* Logo */}
      <Image
        source={require("../assets/images/pill.png")}
        style={styles.pillImage}
      />

      {/* Elder's Dashboard */}
      <Text style={[styles.dashboardTitle, { color: theme.secondary }]}>ELDER'S DASHBOARD</Text>

      <View style={[styles.actionSection, { backgroundColor: theme.card }]}>
        <View style={styles.actionRow}>
          <TouchableOpacity 
            style={[styles.actionButton, { backgroundColor: theme.background }]} 
            onPress={() => router.push('/BluetoothScreen')}
          >
            <Ionicons name="bluetooth" size={36} color={theme.text} />
            <Text style={[styles.iconLabel, { color: theme.text }]}>Bluetooth</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.actionButton, 
              { 
                backgroundColor: locateBoxActive ? theme.warning : theme.background,
                borderWidth: isBluetoothConnected ? 2 : 0,
                borderColor: isBluetoothConnected ? theme.success : 'transparent'
              }
            ]} 
            onPress={handleLocateBox}
          >
            <Ionicons 
              name="location" 
              size={36} 
              color={locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text)} 
            />
            <Text style={[
              styles.iconLabel, 
              { 
                color: locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text),
                fontWeight: locateBoxActive ? 'bold' : '600'
              }
            ]}>
              {locateBoxActive ? 'Stop Locate' : 'Locate Box'}
            </Text>
            {isBluetoothConnected && (
              <View style={[styles.connectionIndicator, { backgroundColor: theme.success }]} />
            )}
          </TouchableOpacity>
        </View>
        <TouchableOpacity 
          style={[styles.monitorButton, { backgroundColor: theme.secondary }]}
          onPress={() => router.push('/MonitorManageScreen')}
        >
          <Ionicons name="desktop" size={32} color={theme.card} />
          <Text style={[styles.buttonText, { color: theme.card }]}>MONITOR & MANAGE</Text>
        </TouchableOpacity>
      </View>
      
      
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: 15,
    paddingBottom: 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
    padding: 12,
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
  pillImage: {
    width: 70,
    height: 70,
    marginVertical: 10,
  },
  dashboardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
  },
  actionSection: {
    width: '90%',
    marginVertical: 10,
    padding: 16,
    borderRadius: 20,
    elevation: 5,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 30,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 3,
  },
  iconLabel: {
    marginTop: 5,
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
  },
  dashboardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    marginVertical: 6,
    elevation: 3,
  },
  monitorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    paddingVertical: 22,
    borderRadius: 16,
    gap: 12,
  },
  buttonText: {
    textAlign: 'center',
    marginLeft: 8,
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    aspectRatio: 1,
    borderRadius: 25,
    padding: 30,
    elevation: 5,
  },
  logoutButton: {
    padding: 10,
  },
  statusContainer: {
    width: '90%',
    marginVertical: 8,
  },
  notificationBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  notificationBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  connectionIndicator: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

export default ElderDashboard;