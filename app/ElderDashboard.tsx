import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, Image, StyleSheet, Modal, Alert, AppState, ScrollView } from "react-native";
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MedicationNotification from '@/components/MedicationNotification';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService from '@/services/BluetoothService';

const ElderDashboard = () => {
  const router = useRouter();
  const [showNotification, setShowNotification] = useState(false);
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
        console.log('App became active - checking connection status');
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
      
      console.log(`ElderDashboard connection check: ${isConnected ? 'Connected' : 'Disconnected'}`);
    } catch (error) {
      console.error('Error checking Bluetooth connection:', error);
      setIsBluetoothConnected(false);
    }
  };

  const handleDismissNotification = () => {
    setShowNotification(false);
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


  // Clear any caregiver-specific data on mount (elders shouldn't have this)
  useEffect(() => {
    const clearCaregiverData = async () => {
      try {
        // Elders should not have selectedElderId - clear it if it exists
        await AsyncStorage.removeItem('selectedElderId');
        await AsyncStorage.removeItem('selectedElderName');
        console.log('[ElderDashboard] Cleared caregiver-specific data for elder user');
      } catch (error) {
        console.error('[ElderDashboard] Error clearing caregiver data:', error);
      }
    };
    clearCaregiverData();
  }, []);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove([
                'token',
                'userRole',
                'selectedElderId',
                'selectedElderName',
              ]);
              router.replace('/LoginScreen');
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Error', 'Failed to logout. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Modal
        visible={showNotification}
        transparent={true}
        animationType="slide"
        onRequestClose={handleDismissNotification}
      >
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <MedicationNotification
              medicineName="Metformin"
              containerId={2}
              scheduledTime="08:00 AM"
              onDismiss={handleDismissNotification}
            />
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <View style={{ width: 40 }} />
        <Text style={[styles.title, { color: theme.secondary }]}>
          WELCOME TO <Text style={[styles.highlight, { color: theme.primary }]}>PILLNOW</Text>
        </Text>
        <TouchableOpacity 
          style={styles.logoutButton} 
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* Compact Logo */}
      <View style={styles.logoContainer}>
        <Image
          source={require("../assets/images/pill.png")}
          style={styles.pillImage}
        />
        <Text style={[styles.dashboardTitle, { color: theme.secondary }]}>ELDER'S DASHBOARD</Text>
      </View>

      {/* Action Buttons - Compact Grid */}
      <View style={[styles.actionCard, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={[
            styles.actionButton, 
            { 
              backgroundColor: theme.background,
              borderWidth: isBluetoothConnected ? 2 : 1,
              borderColor: isBluetoothConnected ? theme.success : theme.border
            }
          ]} 
          onPress={() => router.push('/BluetoothScreen')}
        >
          <Ionicons 
            name="bluetooth" 
            size={28} 
            color={isBluetoothConnected ? theme.success : theme.text} 
          />
          <Text style={[
            styles.actionLabel, 
            { 
              color: isBluetoothConnected ? theme.success : theme.text,
              fontWeight: isBluetoothConnected ? 'bold' : 'normal'
            }
          ]}>
            Bluetooth
          </Text>
          {isBluetoothConnected && (
            <View style={[styles.connectionIndicator, { backgroundColor: theme.success }]} />
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[
            styles.actionButton, 
            { 
              backgroundColor: locateBoxActive ? theme.warning : theme.background,
              borderWidth: isBluetoothConnected ? 2 : 1,
              borderColor: isBluetoothConnected ? theme.success : theme.border
            }
          ]} 
          onPress={handleLocateBox}
        >
          <Ionicons 
            name="location" 
            size={28} 
            color={locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text)} 
          />
          <Text style={[
            styles.actionLabel, 
            { 
              color: locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text),
              fontWeight: locateBoxActive ? 'bold' : 'normal'
            }
          ]}>
            {locateBoxActive ? 'Stop Locate' : 'Locate Box'}
          </Text>
          {isBluetoothConnected && (
            <View style={[styles.connectionIndicator, { backgroundColor: theme.success }]} />
          )}
        </TouchableOpacity>
      </View>

      {/* Monitor & Manage Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.dashboardButton, { backgroundColor: theme.secondary }]}
          onPress={() => router.push('/MonitorManageScreen')}
        >
          <Ionicons name="desktop" size={22} color={theme.card} />
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
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  highlight: {
    fontWeight: 'bold',
  },
  logoutButton: {
    padding: 8,
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  pillImage: {
    width: 60,
    height: 60,
    marginBottom: 8,
  },
  dashboardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  actionCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 16,
    gap: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    position: 'relative',
  },
  actionLabel: {
    marginTop: 6,
    fontSize: 12,
    textAlign: 'center',
  },
  connectionIndicator: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  buttonContainer: {
    paddingHorizontal: 16,
    gap: 10,
  },
  dashboardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: 'bold',
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
});

export default ElderDashboard;