import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Alert, AppState, ScrollView, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NotificationManager from '@/components/NotificationManager';
import { useNotifications } from '@/hooks/useNotifications';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService from '@/services/BluetoothService';
import { jwtDecode } from 'jwt-decode';

const CaregiverDashboard: React.FC = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const { 
    closeNotification, 
    isModalVisible, 
    currentNotification,
    isLoading 
  } = useNotifications();
  
  // Bluetooth and locate box state
  const [isBluetoothConnected, setIsBluetoothConnected] = useState(false);
  const [locateBoxActive, setLocateBoxActive] = useState(false);
  const [locatingBox, setLocatingBox] = useState(false);
  
  // Connected elders state
  const [connectedElders, setConnectedElders] = useState<any[]>([]);
  const [selectedElderId, setSelectedElderId] = useState<string | null>(null);
  const [selectedElderName, setSelectedElderName] = useState<string | null>(null);
  const [loadingElders, setLoadingElders] = useState(false);
  const [hasActiveConnection, setHasActiveConnection] = useState<boolean>(false);
  const [selectingElder, setSelectingElder] = useState<string | null>(null);
  const [navigatingTo, setNavigatingTo] = useState<'eldersProf' | 'monitorManage' | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  
  // Legacy design: no real-time notification center or monitoring dashboard

  // Interface for decoded JWT token
  interface DecodedToken {
    id: string;
    userId?: string;
    role?: string;
  }

  // Get current caregiver ID from JWT token
  const getCurrentCaregiverId = async (): Promise<string> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        throw new Error('No token found');
      }
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const caregiverId = decodedToken.userId ?? decodedToken.id;
      if (!caregiverId) {
        throw new Error('Invalid token structure');
      }
      return caregiverId;
    } catch (error) {
      console.error('Error getting caregiver ID:', error);
      throw error;
    }
  };

  // Check if caregiver has active connection to selected elder (from database)
  const checkCaregiverConnection = async (elderId: string): Promise<boolean> => {
    try {
      console.log(`[CaregiverDashboard] Checking connection in database for elder ID: ${elderId}`);
      
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[CaregiverDashboard] No token found');
        return false;
      }

      const caregiverId = await getCurrentCaregiverId();

      // --- New format: /api/caregivers/:id/elders (elders array with nested connections) ---
      try {
        const resp = await fetch(`https://pillnow-database.onrender.com/api/caregivers/${caregiverId}/elders`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });

        if (resp.ok) {
          const data = await resp.json();
          console.log('[CaregiverDashboard] Connected elders response (new format):', JSON.stringify(data, null, 2));

          const eldersData = data?.data && Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
          const found = eldersData.find((elderItem: any) => {
            const itemId = elderItem.id || elderItem.userId || elderItem._id;
            const matches = String(itemId) === String(elderId);
            if (!matches) return false;
            if (elderItem.connections && Array.isArray(elderItem.connections)) {
              const activeConn = elderItem.connections.find((c: any) => {
                const status = String(c.status || '').toLowerCase();
                return status === 'active' || status === 'connected' || status === 'enabled';
              });
              return !!activeConn;
            }
            return false;
          });

          if (found) {
            console.log('[CaregiverDashboard] ✅ Active connection found via new endpoint');
            return true;
          }
        } else if (resp.status !== 404) {
          console.log('[CaregiverDashboard] New endpoint returned', resp.status);
        }
      } catch (err) {
        console.log('[CaregiverDashboard] New endpoint check failed:', err);
      }

      // --- Fallback: old endpoint /api/caregiver-connections ---
      const response = await fetch(`https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elder=${elderId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const data = await response.json();
        const connections = Array.isArray(data) 
          ? data 
          : (data.connections || data.data || []);
        
        const activeConnection = connections.find((conn: any) => {
          const connElderId = conn.elder?.userId || conn.elder?._id || conn.elder?.id || conn.elder;
          const matches = String(connElderId) === String(elderId);
          const status = String(conn.status || '').toLowerCase();
          const isActive = status === 'active' || status === 'connected' || status === 'enabled';
          return matches && isActive;
        });

        if (activeConnection) {
          console.log('[CaregiverDashboard] ✅ Active connection found in database (fallback)');
          return true;
        } else {
          console.log('[CaregiverDashboard] ❌ No active connection found in database (fallback)');
          return false;
        }
      } else if (response.status === 404) {
        console.log('[CaregiverDashboard] ❌ Connection not found in database (fallback 404)');
        return false;
      } else {
        const errorText = await response.text();
        console.error('[CaregiverDashboard] Error checking connection:', response.status, errorText);
        return false;
      }
    } catch (error) {
      console.error('[CaregiverDashboard] Error checking caregiver connection:', error);
      return false;
    }
  };

  // Load connected elders from database (not AsyncStorage)
  const loadConnectedElders = async () => {
    try {
      setLoadingElders(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[CaregiverDashboard] No token found, cannot load connected elders');
        setConnectedElders([]);
        setHasActiveConnection(false);
        setLoadingElders(false);
        return;
      }

      const caregiverId = await getCurrentCaregiverId();
      console.log('[CaregiverDashboard] Loading connected elders from database for caregiver:', caregiverId);

      // Fetch connected elders from database
      // Try multiple endpoint formats to find the correct one
      let response: Response | null = null;
      const endpoints = [
        `https://pillnow-database.onrender.com/api/caregivers/${caregiverId}/elders`,
        `https://pillnow-database.onrender.com/api/caregivers/${caregiverId}/connections`,
        `https://pillnow-database.onrender.com/api/caregivers/connections?caregiverId=${caregiverId}`,
        `https://pillnow-database.onrender.com/api/caregivers/connections?caregiver=${caregiverId}`,
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiverId=${caregiverId}`,
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}`,
      ];

      for (const endpoint of endpoints) {
        try {
          console.log('[CaregiverDashboard] Trying endpoint:', endpoint);
          response = await fetch(endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });
          
          if (response.ok) {
            console.log('[CaregiverDashboard] ✅ Successfully fetched from endpoint:', endpoint);
            break;
          } else if (response.status !== 404) {
            // If it's not 404, it might be a different error, log it
            console.log(`[CaregiverDashboard] Endpoint returned ${response.status}:`, endpoint);
          }
        } catch (error) {
          console.log('[CaregiverDashboard] Endpoint failed:', endpoint, error);
          continue;
        }
      }

      if (!response || !response.ok) {
        console.error('[CaregiverDashboard] All endpoints failed. Last response:', response?.status);
        // Don't clear the list - keep existing local elders
        console.log('[CaregiverDashboard] Keeping existing local elders list - all endpoints failed');
        setLoadingElders(false);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        console.log('[CaregiverDashboard] Connected elders from database (raw response):', JSON.stringify(data, null, 2));
        
        // Extract elder information (support new API format: elders with nested connections)
        let elders: any[] = [];
        let eldersData: any[] = [];
        
        if (data.success && data.data && Array.isArray(data.data)) {
          eldersData = data.data; // new format
        } else if (Array.isArray(data)) {
          eldersData = data;
        } else if (data.data && Array.isArray(data.data)) {
          eldersData = data.data;
        } else if (data.connections && Array.isArray(data.connections)) {
          eldersData = data.connections; // old format
        }
        
        console.log('[CaregiverDashboard] Extracted elders data array:', eldersData.length, 'items');
        
        elders = eldersData.map((item: any) => {
          // New format: elder info at top level, connections nested
          if (item.connections && Array.isArray(item.connections)) {
            const elderId = item.id || item.userId || item._id;
            const activeConn = item.connections.find((conn: any) => {
              const status = String(conn.status || '').toLowerCase();
              return status === 'active' || status === 'connected' || status === 'enabled';
            });
            if (activeConn) {
              console.log('[CaregiverDashboard] Processing elder (new format):', {
                elderId,
                elderName: item.name,
                connectionId: activeConn.connectionId,
                status: activeConn.status
              });
              return {
                userId: String(elderId || ''),
                name: item.name || 'Unknown',
                email: item.email || '',
                contactNumber: item.phone || item.contactNumber || item.phoneNumber || '',
                role: item.role || 2,
                profileImage: item.profileImage
              };
            }
            return null;
          }
          
          // Old format: connection object with nested elder
          const elder = item.elder || item.elderData || item.elderInfo || {};
          const elderId = elder.userId || elder._id || elder.id || item.elderId || item.elder;
          
          console.log('[CaregiverDashboard] Processing connection (old format):', {
            connectionId: item.connectionId || item._id || item.id,
            elderId,
            elderName: elder.name,
            status: item.status
          });
          
          return {
            userId: String(elderId || ''),
            name: elder.name || 'Unknown',
            email: elder.email || '',
            contactNumber: elder.contactNumber || elder.phone || elder.phoneNumber || '',
            role: elder.role || 2,
            profileImage: elder.profileImage
          };
        }).filter((elder: any) => elder && elder.userId);

        // Filter only active connections (for old format; new format already filtered)
        const activeElders = elders.filter((elder: any) => {
          const item = eldersData.find((i: any) => {
            const idCandidate = i.id || i.userId || i._id || (i.elder || {}).userId || (i.elder || {})._id || (i.elder || {}).id || i.elderId || i.elder;
            return String(idCandidate) === String(elder.userId);
          });

          if (item && item.connections) {
            // new format already active
            return true;
          } else if (item) {
            const status = String(item.status || '').toLowerCase();
            const isActive = status === 'active' || status === 'connected' || status === 'enabled';
            if (!isActive) {
              console.log('[CaregiverDashboard] Filtered out inactive connection for elder:', elder.name, 'Status:', item.status);
            }
            return isActive;
          }
          return false;
        });

        console.log('[CaregiverDashboard] ✅ Loaded', activeElders.length, 'active connected elders from database');
        console.log('[CaregiverDashboard] Elders:', activeElders.map(e => ({ name: e.name, id: e.userId })));
        
        // Merge with existing local elders instead of replacing
        // This preserves elders that were added locally but not yet in database response
        setConnectedElders((prevElders) => {
          const merged = [...prevElders];
          
          // Add new elders from database that aren't already in local list
          activeElders.forEach((dbElder) => {
            const exists = merged.some(e => String(e.userId) === String(dbElder.userId));
            if (!exists) {
              merged.push(dbElder);
              console.log('[CaregiverDashboard] Added elder from database to merged list:', dbElder.name);
            }
          });
          
          // Update existing elders with database data (in case info changed)
          merged.forEach((localElder, index) => {
            const dbElder = activeElders.find(e => String(e.userId) === String(localElder.userId));
            if (dbElder) {
              merged[index] = dbElder; // Use database version
            }
          });
          
          console.log('[CaregiverDashboard] ✅ Merged list has', merged.length, 'elders');
          return merged;
        });
      } else if (response.status === 404) {
        // No connections found in database - keep existing local list
        console.log('[CaregiverDashboard] No connected elders found in database, keeping local list');
        // Don't clear the list - keep what we have locally
      } else {
        const errorText = await response.text();
        console.error('[CaregiverDashboard] Error loading connected elders from database:', response.status, errorText);
        // Don't clear the list on error - keep existing local elders
        console.log('[CaregiverDashboard] Keeping existing local elders list due to error');
      }
      
      // Also check if there's a selected elder
      const selectedId = await AsyncStorage.getItem('selectedElderId');
      const selectedName = await AsyncStorage.getItem('selectedElderName');
      setSelectedElderId(selectedId);
      setSelectedElderName(selectedName);
      
      // Check if there's an active connection to the selected elder
      if (selectedId) {
        const hasConnection = await checkCaregiverConnection(selectedId);
        setHasActiveConnection(hasConnection);
        console.log('[CaregiverDashboard] Selected elder:', selectedName, 'Has active connection:', hasConnection);
      } else {
        setHasActiveConnection(false);
      }
    } catch (error) {
      console.error('[CaregiverDashboard] Error loading connected elders from database:', error);
      setConnectedElders([]);
      setHasActiveConnection(false);
    } finally {
      setLoadingElders(false);
    }
  };

  // Select elder for monitoring
  const selectElder = async (elderId: string, elderName: string) => {
    if (selectingElder) return; // Prevent double-clicks
    try {
      setSelectingElder(elderId);
      // Check if there's an active connection first
      const hasConnection = await checkCaregiverConnection(elderId);
      
      if (!hasConnection) {
        Alert.alert(
          'No Active Connection',
          `You don't have an active connection to ${elderName}. Please ensure you have an active caregiver-elder connection before monitoring.`,
          [{ text: 'OK' }]
        );
        setHasActiveConnection(false);
        return;
      }
      
      await AsyncStorage.setItem('selectedElderId', elderId);
      await AsyncStorage.setItem('selectedElderName', elderName);
      setSelectedElderId(elderId);
      setSelectedElderName(elderName);
      setHasActiveConnection(true);
      Alert.alert('Success', `Now monitoring ${elderName}`);
    } catch (error) {
      console.error('Error selecting elder:', error);
      Alert.alert('Error', 'Failed to select elder');
      setHasActiveConnection(false);
    } finally {
      setSelectingElder(null);
    }
  };

  // Check Bluetooth connection status on component mount
  useEffect(() => {
    checkBluetoothConnection();
    loadConnectedElders();
    
    // Check connection status every 3 seconds for faster response
    const interval = setInterval(checkBluetoothConnection, 3000);
    
    return () => clearInterval(interval);
  }, []);

  // Reload elders when app comes into focus
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        loadConnectedElders();
      }
    };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription?.remove();
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
      
      console.log(`CaregiverDashboard connection check: ${isConnected ? 'Connected' : 'Disconnected'}`);
    } catch (error) {
      console.error('Error checking Bluetooth connection:', error);
      setIsBluetoothConnected(false);
    }
  };

  const handleDismissNotification = () => {
    closeNotification();
  };

  const handleLocateBox = async () => {
    if (locatingBox) return; // Prevent double-clicks
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
      setLocatingBox(true);
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
    } finally {
      setLocatingBox(false);
    }
  };


  const handleLogout = () => {
    if (loggingOut) return; // Prevent double-clicks
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
              setLoggingOut(true);
              await AsyncStorage.multiRemove([
                'token',
                'userRole',
                'selectedElderId',
              ]);
              router.replace('/LoginScreen');
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Error', 'Failed to logout. Please try again.');
              setLoggingOut(false);
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
      <NotificationManager
        visible={isModalVisible}
        onClose={handleDismissNotification}
        notificationData={currentNotification || undefined}
        onNotificationDismissed={handleDismissNotification}
      />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <View style={{ width: 40 }} />
        <Text style={[styles.title, { color: theme.secondary }]}>
          WELCOME TO <Text style={[styles.highlight, { color: theme.primary }]}>PILLNOW</Text>
        </Text>
        <TouchableOpacity 
          style={styles.logoutButton} 
          onPress={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? (
            <ActivityIndicator size="small" color={theme.text} />
          ) : (
            <Ionicons name="log-out-outline" size={24} color={theme.text} />
          )}
        </TouchableOpacity>
      </View>

      {/* Compact Logo */}
      <View style={styles.logoContainer}>
        <Image source={require('@/assets/images/pill.png')} style={styles.pillImage} />
        <Text style={[styles.dashboardTitle, { color: theme.secondary }]}>CAREGIVER'S DASHBOARD</Text>
        {selectedElderName && hasActiveConnection && (
          <View style={[styles.selectedElderBanner, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
            <Ionicons name="eye" size={14} color={theme.primary} />
            <Text style={[styles.selectedElderText, { color: theme.primary }]}>
              Monitoring: {selectedElderName}
            </Text>
          </View>
        )}
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
              borderColor: isBluetoothConnected ? theme.success : theme.border,
              opacity: locatingBox ? 0.6 : 1
            }
          ]} 
          onPress={handleLocateBox}
          disabled={locatingBox}
        >
          {locatingBox ? (
            <ActivityIndicator size="small" color={locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text)} />
          ) : (
            <Ionicons 
              name="location" 
              size={28} 
              color={locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text)} 
            />
          )}
          <Text style={[
            styles.actionLabel, 
            { 
              color: locateBoxActive ? theme.card : (isBluetoothConnected ? theme.success : theme.text),
              fontWeight: locateBoxActive ? 'bold' : 'normal'
            }
          ]}>
            {locatingBox ? 'Processing...' : (locateBoxActive ? 'Stop Locate' : 'Locate Box')}
          </Text>
          {isBluetoothConnected && !locatingBox && (
            <View style={[styles.connectionIndicator, { backgroundColor: theme.success }]} />
          )}
        </TouchableOpacity>
      </View>

      {/* Connected Elders Section */}
      <View style={[styles.eldersSection, { backgroundColor: theme.card }]}>
        <View style={styles.sectionHeader}>
          <Ionicons name="people" size={20} color={theme.primary} />
          <Text style={[styles.sectionTitle, { color: theme.secondary }]}>CONNECTED ELDERS</Text>
        </View>
        
        {loadingElders ? (
          <View style={styles.loadingContainer}>
            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading elders...</Text>
          </View>
        ) : connectedElders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="person-outline" size={40} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No connected elders</Text>
            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
              Add an elder profile to get started
            </Text>
          </View>
        ) : (
          <FlatList
            data={connectedElders}
            keyExtractor={(item, index) => item.userId || item._id || item.id || `elder-${index}`}
            renderItem={({ item }) => {
              const elderId = item.userId || item._id || item.id;
              const isSelected = selectedElderId === elderId;
              return (
                <View style={[
                  styles.elderCard, 
                  { 
                    backgroundColor: isSelected ? theme.primary + '20' : theme.background,
                    borderColor: isSelected ? theme.primary : theme.border,
                    borderWidth: isSelected ? 2 : 1
                  }
                ]}>
                  <View style={styles.elderInfo}>
                    <Ionicons 
                      name="person-circle" 
                      size={32} 
                      color={isSelected ? theme.primary : theme.textSecondary} 
                    />
                    <View style={styles.elderDetails}>
                      <Text style={[styles.elderName, { color: theme.text }]}>{item.name}</Text>
                      <Text style={[styles.elderPhone, { color: theme.textSecondary }]}>
                        {item.contactNumber || item.phone || 'No phone'}
                      </Text>
                    </View>
                  </View>
                  {isSelected && (
                    <View style={[styles.selectedBadge, { backgroundColor: theme.primary }]}>
                      <Ionicons name="checkmark-circle" size={16} color={theme.card} />
                      <Text style={[styles.selectedText, { color: theme.card }]}>Monitoring</Text>
                    </View>
                  )}
                  {!isSelected && (
                    <TouchableOpacity
                      style={[
                        styles.monitorButton, 
                        { 
                          backgroundColor: theme.primary,
                          opacity: selectingElder === elderId ? 0.6 : 1
                        }
                      ]}
                      onPress={() => selectElder(elderId, item.name)}
                      disabled={selectingElder !== null}
                    >
                      {selectingElder === elderId ? (
                        <ActivityIndicator size="small" color={theme.card} />
                      ) : (
                        <>
                          <Ionicons name="eye" size={16} color={theme.card} />
                          <Text style={[styles.monitorButtonText, { color: theme.card }]}>Monitor</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
            scrollEnabled={false}
          />
        )}
      </View>

      {/* Dashboard Buttons - Compact */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[
            styles.dashboardButton, 
            { 
              backgroundColor: theme.primary,
              opacity: navigatingTo !== null ? 0.6 : 1
            }
          ]}
          onPress={async () => {
            if (navigatingTo) return;
            try {
              setNavigatingTo('eldersProf');
              await router.push('/EldersProf');
              // Reload elders when returning from EldersProf
              setTimeout(() => {
              loadConnectedElders();
            }, 500);
            } finally {
              setTimeout(() => setNavigatingTo(null), 400);
            }
          }}
          disabled={navigatingTo !== null}
        >
          {navigatingTo === 'eldersProf' ? (
            <ActivityIndicator size="small" color={theme.card} />
          ) : (
            <>
              <Ionicons name="person-add" size={22} color={theme.card} />
              <Text style={[styles.buttonText, { color: theme.card }]}>INPUT ELDER'S PROFILE</Text>
            </>
          )}
        </TouchableOpacity>
        
        {/* Only show Monitor & Manage button if elder is selected AND has active connection */}
        {selectedElderId && selectedElderName && hasActiveConnection ? (
          <TouchableOpacity 
            style={[
              styles.dashboardButton, 
              { 
                backgroundColor: theme.secondary,
                opacity: navigatingTo !== null ? 0.6 : 1
              }
            ]}
            onPress={async () => {
              if (navigatingTo) return;
              try {
                setNavigatingTo('monitorManage');
                await router.push('/MonitorManageScreen');
              } finally {
                setTimeout(() => setNavigatingTo(null), 400);
              }
            }}
            disabled={navigatingTo !== null}
          >
            {navigatingTo === 'monitorManage' ? (
              <ActivityIndicator size="small" color={theme.card} />
            ) : (
              <>
                <Ionicons name="desktop" size={22} color={theme.card} />
                <Text style={[styles.buttonText, { color: theme.card }]}>MONITOR & MANAGE</Text>
                <View style={[styles.monitoringBadge, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.monitoringBadgeText, { color: theme.card }]}>
                    {selectedElderName}
                  </Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={[styles.disabledButton, { backgroundColor: theme.background, borderColor: theme.border }]}>
            <Ionicons name="desktop-outline" size={22} color={theme.textSecondary} />
            <Text style={[styles.disabledButtonText, { color: theme.textSecondary }]}>
              {selectedElderId && selectedElderName 
                ? 'NO ACTIVE CONNECTION TO ELDER' 
                : 'SELECT AN ELDER TO MONITOR'}
            </Text>
          </View>
        )}
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
  selectedElderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  selectedElderText: {
    fontSize: 12,
    fontWeight: '600',
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
  eldersSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    maxHeight: 300,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 14,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  elderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  elderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  elderDetails: {
    flex: 1,
  },
  elderName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  elderPhone: {
    fontSize: 12,
  },
  selectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  selectedText: {
    fontSize: 12,
    fontWeight: '600',
  },
  monitorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  monitorButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  monitoringBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  monitoringBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  disabledButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    opacity: 0.6,
  },
  disabledButtonText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default CaregiverDashboard;
