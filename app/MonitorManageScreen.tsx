import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, Modal, TextInput, DeviceEventEmitter
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import BluetoothService from '@/services/BluetoothService';
import verificationService, { VerificationResult } from '@/services/verificationService';
import { BACKEND_URL, testBackendReachable, getBackendUrl } from '@/config';
import { updateScheduleCache, initializeScheduleCache, syncOfflineUpdates } from '@/services/scheduleStatusService';
import { alarmTriggerTracker } from '@/services/alarmTriggerTracker';


// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId: string;
  role?: string;
}

const MonitorManageScreen = () => {
  const navigation = useNavigation();
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  
  // State for schedule data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [medications, setMedications] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [clockTick, setClockTick] = useState<number>(0); // force refresh for status derivation
  const [verifications, setVerifications] = useState<Record<number, VerificationResult>>({});
  const [loadingVerifications, setLoadingVerifications] = useState(false);
  const [schedulesExpanded, setSchedulesExpanded] = useState(true); // Dropdown state
  const [lastArduinoSync, setLastArduinoSync] = useState<number>(0); // Track last sync time
  const lastAlarmShownRef = useRef<number>(0); // prevent rapid successive alarm popups
  const lastAlarmStoppedRef = useRef<{ container: number; timestamp: number }>({ container: 0, timestamp: 0 }); // dedupe post-alarm captures
  const missedMarkedRef = useRef<Set<string>>(new Set()); // avoid spamming missed updates
  
  // Loading states for buttons
  const [refreshing, setRefreshing] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [navigating, setNavigating] = useState<string | null>(null);

  // Backend override controls (available in all builds)
  const [backendOverride, setBackendOverride] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [backendModalVisible, setBackendModalVisible] = useState(false);
  const [backendInput, setBackendInput] = useState('');
  // Track if user manually set the override (prevents auto-update from overwriting)
  const [isManualOverride, setIsManualOverride] = useState<boolean>(false);
  const manualOverrideRef = useRef<boolean>(false);
  
  // Alarm modal state - REMOVED: Alarm modals are now handled globally by GlobalAlarmHandler
  // These state variables are no longer used (ENABLE_LOCAL_ALARM_HANDLING = false)
  // Keeping commented out for reference, but they should not be used
  // const [alarmVisible, setAlarmVisible] = useState(false);
  // const [alarmContainer, setAlarmContainer] = useState(1);
  // const [alarmTime, setAlarmTime] = useState('');
  
  // Monitoring status for caregivers
  const [isCaregiver, setIsCaregiver] = useState(false);
  const [monitoringElder, setMonitoringElder] = useState<{ id: string; name: string } | null>(null);
  const [hasActiveConnection, setHasActiveConnection] = useState<boolean>(true); // Default to true for elders

  // Normalize a container identifier from schedules/events into a stable numeric container index (1, 2, or 3).
  // Supports:
  // - numeric values (1, 2, 3)
  // - strings "1", "2", "3"
  // - strings like "container1", "container2"
  // - legacy labels "morning", "noon", "evening"
  const normalizeContainer = useCallback((raw: any): 1 | 2 | 3 => {
    if (raw === null || raw === undefined) return 1;
    const s = String(raw).trim().toLowerCase();

    // Extract first digit sequence (handles "1", "01", "container2", etc.)
    const m = s.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3;
    }

    // Legacy string labels
    if (s === 'morning') return 1;
    if (s === 'noon') return 2;
    if (s === 'evening' || s === 'night') return 3;

    // Fallback to container 1 for any unknown format
    return 1;
  }, []);

  // Configure notification handler (lazy load)
  // Note: expo-notifications requires a development build, not Expo Go
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
        const Notifications = await import('expo-notifications');
        // Check if native module is available
        if (Notifications.default && typeof Notifications.default.setNotificationHandler === 'function') {
          Notifications.default.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
            }),
          });
        }
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn('expo-notifications native module not available, using Alert fallback:', errorMessage);
      }
    };
    setupNotifications();
  }, []);

  // Get current user ID and role from JWT token
  // Note: This function allows both Elders and Caregivers to view schedules
  // Role restrictions are applied at the action level (create/modify), not at viewing level
  const getCurrentUserId = useCallback(async (): Promise<number> => {
    try {
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        console.warn('No token found, using default user ID 1');
        return 1;
      }

      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const rawId = decodedToken.userId ?? decodedToken.id;
      const userId = parseInt(rawId);
      
      if (isNaN(userId)) {
        console.warn('Invalid user ID in token, using default user ID 1');
        return 1;
      }

      // Return userId without role restriction - both Elders and Caregivers can view schedules
      // Caregivers will use getSelectedElderId() to view their selected elder's schedules
      return userId;
    } catch (error) {
      console.error('Error getting user ID from token:', error);
      return 1; // Default fallback for other errors
    }
  }, []);

  // Get selected elder ID for caregivers
  const getSelectedElderId = useCallback(async (): Promise<string | null> => {
    try {
      const selectedElderId = await AsyncStorage.getItem('selectedElderId');
      return selectedElderId;
    } catch (error) {
      console.error('Error getting selected elder ID:', error);
      return null;
    }
  }, []);

  // Get user role from JWT token
  const getUserRole = useCallback(async (): Promise<string | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[MonitorManageScreen] No token found');
        return null;
      }
      
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      console.log('[MonitorManageScreen] Decoded token:', JSON.stringify(decodedToken, null, 2));
      
      // Try different possible field names for role
      const role = decodedToken.role || (decodedToken as any).userRole || (decodedToken as any).roleId || null;
      console.log('[MonitorManageScreen] Extracted role:', role);
      return role;
    } catch (error) {
      console.error('[MonitorManageScreen] Error getting user role from token:', error);
      return null;
    }
  }, []);

  // Get current caregiver ID from JWT token
  const getCurrentCaregiverId = useCallback(async (): Promise<string | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        return null;
      }
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const caregiverId = decodedToken.userId ?? decodedToken.id;
      return caregiverId || null;
    } catch (error) {
      console.error('[MonitorManageScreen] Error getting caregiver ID:', error);
      return null;
    }
  }, []);

  // Create caregiver-elder connection if it doesn't exist
  const createCaregiverConnection = useCallback(async (elderId: string): Promise<boolean> => {
    try {
      console.log(`[MonitorManageScreen] 🔧 Creating connection for elder ID: ${elderId}`);
      
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[MonitorManageScreen] ⚠️ No token found');
        return false;
      }

      const caregiverId = await getCurrentCaregiverId();
      if (!caregiverId) {
        console.log('[MonitorManageScreen] ⚠️ Could not get caregiver ID');
        return false;
      }

      // Try the new endpoint first
      const response = await fetch('https://pillnow-database.onrender.com/api/caregivers/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caregiverId: parseInt(caregiverId) || caregiverId,
          elderId: parseInt(elderId) || elderId,
          relationship: 'family',
          permissions: {
            viewMedications: true,
            viewAdherence: true,
            receiveAlerts: true
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[MonitorManageScreen] ✅ Connection created successfully:', data);
        
        // Wait longer for database to update, then verify
        // The backend may need more time to propagate the connection
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Verify the connection was created by checking it
        const verified = await checkCaregiverConnection(elderId, false, false);
        if (verified) {
          console.log('[MonitorManageScreen] ✅ Connection verified after creation');
        } else {
          console.log('[MonitorManageScreen] ⚠️ Connection created but not yet visible via GET endpoint (connection exists in database, schedules will still work)');
          // Even if GET check fails, if POST says connection exists, we can trust it
          // The schedules are loading successfully, which means backend allows access
          setHasActiveConnection(true);
        }
        
        return true;
      } else {
        const errorText = await response.text();
        console.error(`[MonitorManageScreen] Failed to create connection (${response.status}): ${errorText}`);
        
        // Try fallback endpoint
        const fallbackResponse = await fetch('https://pillnow-database.onrender.com/api/caregiver-connections', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            caregiver: parseInt(caregiverId) || caregiverId,
            elder: parseInt(elderId) || elderId,
            status: 'active',
            permissions: {
              viewAdherence: true
            }
          })
        });

        if (fallbackResponse.ok) {
          console.log('[MonitorManageScreen] ✅ Connection created via fallback endpoint');
          return true;
        } else {
          const fallbackError = await fallbackResponse.text();
          console.error(`[MonitorManageScreen] Fallback also failed (${fallbackResponse.status}): ${fallbackError}`);
          return false;
        }
      }
    } catch (error) {
      console.error('[MonitorManageScreen] Error creating connection:', error);
      return false;
    }
  }, [getCurrentCaregiverId]);

  // Check if caregiver has active connection to selected elder
  // Uses the same reliable method as CaregiverDashboard
  // Returns boolean and optionally shows alert
  const checkCaregiverConnection = useCallback(async (elderId: string, showAlert: boolean = false, autoCreate: boolean = false): Promise<boolean> => {
    try {
      console.log(`[MonitorManageScreen] 🔍 Checking connection for elder ID: ${elderId}`);
      
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[MonitorManageScreen] ⚠️ No token found');
        if (showAlert) Alert.alert('Error', 'No authentication token. Please log in again.');
        setHasActiveConnection(false);
        return false;
      }

      const caregiverId = await getCurrentCaregiverId();
      if (!caregiverId) {
        console.log('[MonitorManageScreen] ⚠️ Could not get caregiver ID from token');
        if (showAlert) Alert.alert('Error', 'Could not identify caregiver. Please log in again.');
        setHasActiveConnection(false);
        return false;
      }

      console.log(`[MonitorManageScreen] Caregiver ID: ${caregiverId}, Elder ID: ${elderId}`);

      const headers = {
        'Authorization': `Bearer ${token.trim()}`,
        'Content-Type': 'application/json',
      };

      let response: Response | null = null;

      // Try the newer endpoint first (same as CaregiverDashboard)
      try {
        const newEndpoint = `https://pillnow-database.onrender.com/api/caregivers/${caregiverId}/elders`;
        console.log(`[MonitorManageScreen] Trying new endpoint: ${newEndpoint}`);
        const resp = await fetch(newEndpoint, { headers });
        
        if (resp.ok) {
          const data = await resp.json();
          console.log('[MonitorManageScreen] New endpoint response:', JSON.stringify(data, null, 2));
          
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
            console.log('[MonitorManageScreen] ✅ Active connection found via new endpoint');
            setHasActiveConnection(true);
            return true;
          }
        } else if (resp.status !== 404) {
          console.log('[MonitorManageScreen] New endpoint returned', resp.status);
        }
      } catch (err) {
        console.log('[MonitorManageScreen] New endpoint check failed:', err);
      }

      // Fallback: Try old endpoint with multiple query parameter formats
      const endpoints = [
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elder=${elderId}`,
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiverId=${caregiverId}&elderId=${elderId}`,
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elderId=${elderId}`,
        `https://pillnow-database.onrender.com/api/caregiver-connections?caregiverId=${caregiverId}&elder=${elderId}`,
      ];

      for (const url of endpoints) {
        try {
          console.log(`[MonitorManageScreen] Trying URL: ${url}`);
          response = await fetch(url, { headers });
          console.log(`[MonitorManageScreen] Response status: ${response.status}`);
          
          // If we get a successful response, break out of the loop
          if (response.ok) {
            break;
          }
        } catch (error) {
          console.log(`[MonitorManageScreen] Error with URL ${url}:`, error);
          response = null;
        }
      }

      // If all endpoints returned 404 or failed, handle it
      if (!response || !response.ok) {
        // All endpoints failed - connection not found via GET
        // But this doesn't mean connection doesn't exist (POST creation succeeded)
        console.log(`[MonitorManageScreen] ❌ Connection not found (404)`);
        if (!response) {
          response = { status: 404, ok: false } as Response;
        }
      }

      // At this point, response is guaranteed to be non-null
      const finalResponse: Response = response;
      if (finalResponse.ok) {
        const data = await response.json();
        console.log(`[MonitorManageScreen] 📦 Raw response data:`, JSON.stringify(data, null, 2));
        
        // Handle different response formats
        let connections: any[] = [];
        
        // Check for new API format (elder with nested connections)
        if (data.success && data.data && Array.isArray(data.data)) {
          // New format: array of elders, each with nested connections
          const eldersWithConnections = data.data;
          // Flatten: extract connections from each elder
          eldersWithConnections.forEach((elderItem: any) => {
            if (elderItem.connections && Array.isArray(elderItem.connections)) {
              // Add elder info to each connection for easier processing
              elderItem.connections.forEach((conn: any) => {
                connections.push({
                  ...conn,
                  elder: {
                    id: elderItem.id,
                    userId: elderItem.id,
                    _id: elderItem.id,
                    name: elderItem.name,
                    email: elderItem.email,
                    phone: elderItem.phone,
                    contactNumber: elderItem.phone
                  }
                });
              });
            }
          });
        } else if (Array.isArray(data)) {
          // Response is directly an array
          connections = data;
        } else if (data.connections && Array.isArray(data.connections)) {
          // Response has connections array
          connections = data.connections;
        } else if (data.data) {
          // Response has data field
          if (Array.isArray(data.data)) {
            connections = data.data;
          } else {
            // Single connection object
            connections = [data.data];
          }
        } else if (data.connection) {
          // Single connection object with connection field
          connections = [data.connection];
        } else if (data.elder || data.caregiver || data.status) {
          // Response is a single connection object
          connections = [data];
        }
        
        console.log(`[MonitorManageScreen] 📊 Extracted ${connections.length} connection(s) from response`);
        
        // Check each connection
        const activeConnection = connections.find((conn: any) => {
          // Try multiple ways to extract elder ID
          let connElderId: string | number | undefined;
          
          // Method 1: Elder as object
          if (conn.elder) {
            if (typeof conn.elder === 'object') {
              connElderId = conn.elder.userId || conn.elder._id || conn.elder.id;
            } else {
              // Elder is just an ID
              connElderId = conn.elder;
            }
          }
          
          // Method 2: Direct elderId field
          if (!connElderId) {
            connElderId = conn.elderId || conn.elder_id;
          }
          
          // Method 3: Check if elder field is just a number/string
          if (!connElderId && (conn.elder === parseInt(elderId) || conn.elder === elderId)) {
            connElderId = conn.elder;
          }
          
          // Normalize IDs for comparison (handle both string and number)
          const elderIdNum = parseInt(elderId);
          const elderIdStr = String(elderId);
          const connElderIdNum = connElderId ? parseInt(String(connElderId)) : null;
          const connElderIdStr = connElderId ? String(connElderId) : null;
          
          const matches = 
            (connElderIdNum !== null && connElderIdNum === elderIdNum) ||
            (connElderIdStr !== null && connElderIdStr === elderIdStr) ||
            (connElderIdNum !== null && String(connElderIdNum) === elderIdStr) ||
            (connElderIdStr !== null && parseInt(connElderIdStr) === elderIdNum);
          
          // Check status (case-insensitive, also check for variations)
          const status = String(conn.status || '').toLowerCase().trim();
          const isActive = status === 'active' || status === 'connected' || status === 'enabled';
          
          // If status is missing but connection exists, consider it active (some APIs don't return status)
          const hasStatusField = conn.hasOwnProperty('status');
          const shouldBeActive = isActive || (!hasStatusField && connElderId !== undefined);
          
          console.log(`[MonitorManageScreen] 🔍 Connection check:`, {
            connElderId: connElderId,
            elderId: elderId,
            matches: matches,
            status: conn.status,
            isActive: isActive,
            shouldBeActive: shouldBeActive,
            hasStatusField: hasStatusField,
            fullConn: JSON.stringify(conn)
          });
          
          // Return true if matches and (is active OR no status field exists)
          return matches && shouldBeActive;
        });

        if (activeConnection) {
          console.log('[MonitorManageScreen] ✅✅✅ Active connection found and verified!');
          setHasActiveConnection(true);
          if (showAlert) Alert.alert('Success', 'Active connection verified!');
          return true;
        } else {
          console.log('[MonitorManageScreen] ❌ No active connection found in response');
          console.log('[MonitorManageScreen] 📋 All connections analyzed:');
          connections.forEach((c: any, idx: number) => {
            const elderIdFromConn = c.elder?.userId || c.elder?._id || c.elder?.id || c.elderId || c.elder;
            console.log(`  [${idx}] Elder ID: ${elderIdFromConn}, Status: ${c.status}, Type: ${typeof elderIdFromConn}`);
          });
          console.log(`[MonitorManageScreen] 🔍 Looking for elder ID: ${elderId} (type: ${typeof elderId})`);
          setHasActiveConnection(false);
          if (showAlert) {
            Alert.alert(
              'No Active Connection',
              `Connection exists but status is not 'active'.\n\nFound ${connections.length} connection(s) but none are active.\n\nPlease check the connection status in the backend.`,
              [{ text: 'OK' }]
            );
          }
          return false;
        }
        } else if (finalResponse.status === 404) {
        console.log('[MonitorManageScreen] ❌ Connection not found (404)');
        
        // Try to create connection if autoCreate is enabled
        if (autoCreate) {
          console.log('[MonitorManageScreen] 🔧 Attempting to create connection automatically...');
          const created = await createCaregiverConnection(elderId);
          if (created) {
            // Wait longer before retry to allow database propagation
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Retry the check
            console.log('[MonitorManageScreen] 🔄 Retrying connection check after creation...');
            const retryResult = await checkCaregiverConnection(elderId, showAlert, false);
            // If retry still fails but connection was created, trust the creation response
            if (!retryResult && created) {
              console.log('[MonitorManageScreen] ⚠️ GET check failed but connection was created - allowing access');
              setHasActiveConnection(true);
              return true;
            }
            return retryResult;
          }
        }
        
        setHasActiveConnection(false);
        if (showAlert) {
          Alert.alert(
            'Connection Not Found',
            'No connection found. Would you like to create one now?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Create Connection',
                onPress: async () => {
                  const created = await createCaregiverConnection(elderId);
                  if (created) {
                    Alert.alert('Success', 'Connection created! Please refresh.');
                    await checkCaregiverConnection(elderId, false, false);
                  } else {
                    Alert.alert('Error', 'Failed to create connection. Please try connecting from the Caregiver Dashboard.');
                  }
                }
              }
            ]
          );
        }
        return false;
      } else {
        const errorText = await finalResponse.text();
        console.error(`[MonitorManageScreen] Error (${finalResponse.status}): ${errorText}`);
        setHasActiveConnection(false);
        if (showAlert) {
          Alert.alert('Error', `Connection check failed: ${response.status}\n\n${errorText.substring(0, 100)}`);
        }
        return false;
      }
    } catch (error) {
      console.error('[MonitorManageScreen] Exception checking connection:', error);
      setHasActiveConnection(false);
      if (error instanceof Error) {
        console.error('[MonitorManageScreen] Error details:', error.message);
        if (showAlert) {
          Alert.alert('Error', `Connection check failed: ${error.message}`);
        }
      }
      setHasActiveConnection(false);
      return false;
    }
  }, [getCurrentCaregiverId, createCaregiverConnection]);

  // Load verification results
  const loadVerifications = useCallback(async () => {
    try {
      setLoadingVerifications(true);
      const verificationPromises = [1, 2, 3].map(async (containerNum) => {
        const containerId = verificationService.getContainerId(containerNum);
        const result = await verificationService.getVerificationResult(containerId);
        return { containerNum, result };
      });

      const results = await Promise.all(verificationPromises);
      const verificationMap: Record<number, VerificationResult> = {};
      results.forEach(({ containerNum, result }) => {
        if (result.success) {
          verificationMap[containerNum] = result;
        }
      });
      setVerifications(verificationMap);
    } catch (error) {
      console.error('Error loading verifications:', error);
    } finally {
      setLoadingVerifications(false);
    }
  }, []);

  // Load schedule data
  const loadScheduleData = useCallback(async (syncToArduino: boolean = true, autoDeleteMissed: boolean = false, showLoading: boolean = true) => {
    try {
      if (showLoading) {
      setLoading(true);
      }
      setError(null);
      
      // Get current user ID
      const currentUserId = await getCurrentUserId();
      
      // Check if there's a selected elder (for caregivers) - need to do this BEFORE fetching schedules
      const selectedElderId = await getSelectedElderId();
      const userRole = await getUserRole();
      // Strict check: Only role '3' is caregiver, role '2' is elder
      const roleStr = userRole ? String(userRole) : '';
      const isCaregiverUser = roleStr === '3';
      const isElderUser = roleStr === '2';
      
      // Fetch medications and schedules with cache-busting to ensure fresh data
      const medsController = new AbortController();
      const medsTimeoutId = setTimeout(() => medsController.abort(), 12000);
      const medicationsResponse = await (async () => {
        try {
          return await fetch('https://pillnow-database.onrender.com/api/medications', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'If-Modified-Since': '0'
            },
            signal: medsController.signal,
      });
        } finally {
          clearTimeout(medsTimeoutId);
        }
      })();
      const medicationsData = await medicationsResponse.json();
      
      // Normalize medications to an array regardless of API wrapper shape
      const medsArray = Array.isArray(medicationsData) ? medicationsData : (medicationsData?.data || []);
      
      const token = await AsyncStorage.getItem('token');
      // Don't include Content-Type for GET requests - some APIs reject it
      const scheduleHeaders: HeadersInit = {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'If-Modified-Since': '0'
      };
      if (token) {
        scheduleHeaders['Authorization'] = `Bearer ${token.trim()}`;
      }
      
      // Build URL with query parameters - API requires elderId for caregivers
      // Backend detects caregivers by checking connections, not just token role
      // So if we have a selectedElderId, we should include it (backend will verify permissions)
      let schedulesUrl = 'https://pillnow-database.onrender.com/api/medication_schedules';
      
      if (selectedElderId) {
        // If we have a selected elder ID, include it (user is likely a caregiver monitoring an elder)
        schedulesUrl += `?elderId=${selectedElderId}`;
        console.log(`[MonitorManageScreen] Fetching schedules for elder: ${selectedElderId} (user role: ${userRole || 'unknown'})`);
      } else if (isElderUser) {
        // Elder viewing own schedules - add userId parameter
        schedulesUrl += `?userId=${currentUserId}`;
        console.log(`[MonitorManageScreen] Elder fetching own schedules: ${currentUserId}`);
      } else if (isCaregiverUser && !selectedElderId) {
        // Caregiver but no elder selected - backend will require elderId, so we need to handle this
        // For now, try without elderId and let the error guide us
        console.log(`[MonitorManageScreen] Caregiver detected but no elder selected - backend may require elderId`);
      }
      // If neither caregiver with elder nor elder, just fetch all (backend will filter by token)
      
      const schedulesController = new AbortController();
      const schedulesTimeoutId = setTimeout(() => schedulesController.abort(), 12000);
      const schedulesResponse = await (async () => {
        try {
          return await fetch(schedulesUrl, {
        method: 'GET',
            headers: scheduleHeaders,
            signal: schedulesController.signal,
      });
        } finally {
          clearTimeout(schedulesTimeoutId);
        }
      })();
      
      // Check if response is ok before trying to parse JSON
      if (!schedulesResponse.ok) {
        const errorText = await schedulesResponse.text();
        console.error(`[MonitorManageScreen] Failed to fetch schedules (${schedulesResponse.status}): ${errorText}`);
        
        // If 400 and error mentions elderId, and we don't have selectedElderId, try to get it
        if (schedulesResponse.status === 400 && errorText.includes('elderId') && !selectedElderId) {
          // Backend detected user as caregiver but we don't have selectedElderId
          // Try to get it from AsyncStorage or show helpful error
          const storedElderId = await AsyncStorage.getItem('selectedElderId');
          if (storedElderId) {
            console.log(`[MonitorManageScreen] Retrying with elderId from storage: ${storedElderId}`);
            const retryUrl = `https://pillnow-database.onrender.com/api/medication_schedules?elderId=${storedElderId}`;
            const retryResponse = await fetch(retryUrl, {
              method: 'GET',
              headers: scheduleHeaders
            });
            
            if (retryResponse.ok) {
              const retryData = await retryResponse.json();
              const allSchedules = retryData.data || retryData || [];
              // Continue with processing...
              // We'll need to update the rest of the function to use retryData
              // For now, let's just set empty schedules and show a message
              setMedications(medsArray);
              setSchedules([]);
              setError('Please select an elder to monitor from the Caregiver Dashboard.');
              setLoading(false);
              return;
            }
          }
          
          // If we still don't have elderId, show helpful error
          setError('You need to select an elder to monitor. Please go to the Caregiver Dashboard and select an elder first.');
          setLoading(false);
          return;
        }
        
        throw new Error(`Failed to fetch schedules: ${schedulesResponse.status} - ${errorText}`);
      }
      
      const schedulesData = await schedulesResponse.json();
      
      // Get all schedules - API should have already filtered them, but we'll do client-side filtering too
      const allSchedules = schedulesData.data || schedulesData || [];
      
      // Note: selectedElderId and userRole are already fetched above
      
      // If user is an elder, clear any selectedElderId (elders don't select other elders)
      if (isElderUser) {
        await AsyncStorage.removeItem('selectedElderId');
        await AsyncStorage.removeItem('selectedElderName');
        console.log('[MonitorManageScreen] Cleared selectedElderId for elder user');
      }
      
      // IMPORTANT: If selectedElderId exists, treat user as caregiver (backend will detect them as caregiver anyway)
      // This handles the case where role token is null but user has selected an elder to monitor
      const isActingAsCaregiver = (isCaregiverUser && !isElderUser) || (selectedElderId !== null && selectedElderId !== undefined && String(selectedElderId) !== String(currentUserId));
      
      // Only show as caregiver if user is actually a caregiver (not elder) OR has selected an elder
      const shouldShowAsCaregiver = isActingAsCaregiver;
      
      // Update monitoring status
      setIsCaregiver(shouldShowAsCaregiver);
      console.log('[MonitorManageScreen] User role:', userRole, 'Is caregiver:', isCaregiverUser, 'Is elder:', isElderUser, 'Has selected elder:', selectedElderId !== null, 'Is acting as caregiver:', isActingAsCaregiver, 'Should show as caregiver:', shouldShowAsCaregiver, 'Selected elder ID:', selectedElderId);
      
      // Only set monitoring elder if user is acting as a caregiver (has selectedElderId)
      if (shouldShowAsCaregiver && selectedElderId) {
        const elderName = await AsyncStorage.getItem('selectedElderName');
        console.log('[MonitorManageScreen] Elder name from storage:', elderName);
        if (elderName) {
          setMonitoringElder({ id: selectedElderId, name: elderName });
          console.log('[MonitorManageScreen] ✅ Monitoring status set:', { id: selectedElderId, name: elderName });
          // IMPORTANT: Do NOT block screen loading on this network call.
          // Run connection verification in the background so Monitor & Manage doesn't get stuck "Loading..."
          setHasActiveConnection(true); // optimistic; we will update after check finishes
          checkCaregiverConnection(selectedElderId, false, true)
            .then((ok) => {
              if (ok) {
            setHasActiveConnection(true);
                console.log('[MonitorManageScreen] ✅ Active connection confirmed (async)');
          } else {
                // Keep optimistic access; user will be prompted when doing protected actions
                console.log('[MonitorManageScreen] ⚠️ Connection check returned false (async), keeping access');
                setHasActiveConnection(true);
              }
            })
            .catch((e) => {
              console.warn('[MonitorManageScreen] Connection check failed (async):', e);
              setHasActiveConnection(true);
            });
        } else {
          setMonitoringElder(null);
          setHasActiveConnection(false);
          console.log('[MonitorManageScreen] ⚠️ Elder name not found in storage');
        }
      } else {
        setMonitoringElder(null);
        setHasActiveConnection(true); // Elders always have access
        if (!shouldShowAsCaregiver) {
          console.log('[MonitorManageScreen] User is not a caregiver and no elder selected');
        } else {
          console.log('[MonitorManageScreen] ⚠️ No elder selected');
        }
      }
      
      // Filter schedules based on user role and selected elder
      let userSchedules;
      if (shouldShowAsCaregiver && selectedElderId) {
        // If caregiver has selected an elder, show that elder's schedules
        const elderIdNum = parseInt(selectedElderId);
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserId = parseInt(schedule.user);
          return scheduleUserId === elderIdNum;
        });
        console.log(`[MonitorManageScreen] Filtered ${userSchedules.length} schedule(s) for elder ${selectedElderId} out of ${allSchedules.length} total`);
      } else {
        // Elder or caregiver without selected elder: show current user's schedules
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserId = parseInt(schedule.user);
          return scheduleUserId === currentUserId;
        });
        console.log(`[MonitorManageScreen] Filtered ${userSchedules.length} schedule(s) for user ${currentUserId} out of ${allSchedules.length} total`);
      }
      
      // Auto-mark past-due schedules as Missed (so they don't stay "Pending" forever)
      const now = new Date();
      const oneMinuteAgo = now.getTime() - (1 * 60 * 1000);
      const schedulesNeedingMissed: any[] = [];

      userSchedules.forEach((schedule: any) => {
        if (!schedule?.date || !schedule?.time) return;
        const rawStatus = (schedule.status || 'Pending').toLowerCase();
        if (rawStatus !== 'pending' && rawStatus !== 'active' && rawStatus !== '') return;

        try {
          const [y, m, d] = String(schedule.date).split('-').map(Number);
          const [hh, mm] = String(schedule.time).split(':').map(Number);
          const when = new Date(y, (m || 1) - 1, d, hh, mm);
          if (when.getTime() < oneMinuteAgo) {
            schedulesNeedingMissed.push(schedule);
          }
        } catch (err) {
          console.warn(`[MonitorManageScreen] Failed to parse schedule time for missed check:`, err);
        }
      });

      if (schedulesNeedingMissed.length > 0) {
        console.log(
          `[MonitorManageScreen] Marking ${schedulesNeedingMissed.length} past-due schedule(s) as Missed (PUT only)`
        );
        const updatePromises = schedulesNeedingMissed.map(async (sched: any) => {
          try {
            const putResponse = await fetch(
              `https://pillnow-database.onrender.com/api/medication_schedules/${sched._id}`,
              {
                method: 'PUT',
                headers: scheduleHeaders,
                body: JSON.stringify({ ...sched, status: 'Missed' }),
              }
            );

            if (!putResponse.ok) {
              const putErrorText = await putResponse.text();
              console.error(
                `[MonitorManageScreen] ⚠️ Failed to mark Missed via PUT (${putResponse.status}): ${putErrorText}`
              );
            } else {
              console.log(
                `[MonitorManageScreen] ✅ Schedule ${sched._id} marked as Missed (via PUT)`
              );
              sched.status = 'Missed';
            }
          } catch (err) {
            console.error(
              `[MonitorManageScreen] Error marking Missed for ${sched._id}:`,
              err
            );
          }
        });
        await Promise.all(updatePromises);
      }

      // Sort ALL user schedules for display and Arduino sync
      // - Keep every schedule (no per-container reduction)
      // - Order by container (1,2,3) then by time ascending
      const sortedSchedules = [...userSchedules].sort((a: any, b: any) => {
        const containerA = normalizeContainer(a.container);
        const containerB = normalizeContainer(b.container);
        if (containerA !== containerB) {
          return containerA - containerB;
        }
        // Same container: sort by scheduled Date/Time
        try {
          const [ya, ma, da] = String(a.date || '').split('-').map(Number);
          const [haa, maa] = String(a.time || '').split(':').map(Number);
          const [yb, mb, db] = String(b.date || '').split('-').map(Number);
          const [hab, mab] = String(b.time || '').split(':').map(Number);
          const tA = new Date(ya, (ma || 1) - 1, da, haa, maa).getTime();
          const tB = new Date(yb, (mb || 1) - 1, db, hab, mab).getTime();
          if (Number.isFinite(tA) && Number.isFinite(tB) && tA !== tB) {
            return tA - tB;
          }
        } catch {
          // Fall back to scheduleId if dates are invalid
        }
        return (a.scheduleId || 0) - (b.scheduleId || 0);
      });
      
      setMedications(medsArray);
      
      // CRITICAL FIX: Preserve schedules in grace period when reloading from backend
      // When loadScheduleData is called (e.g., after status updates or periodic refresh),
      // it fetches fresh data from backend which may have schedules marked as "Done".
      // We must preserve schedules that are within the 1-minute grace period to prevent
      // premature removal from the UI.
      setSchedules((prevSchedules) => {
        // Create a map of existing schedules by container+time+date for grace period lookup
        const existingByKey = new Map<string, any>();
        prevSchedules.forEach((s: any) => {
          const c = normalizeContainer(s?.container);
          const timeStr = s?.time ? String(s.time).substring(0, 5) : '';
          const dateStr = s?.date || '';
          const key = `${c}|${dateStr}|${timeStr}`;
          existingByKey.set(key, s);
        });
        
        // Merge: Keep schedules in grace period from previous state, use new data for others
        const merged = sortedSchedules.map((newSchedule: any) => {
          const c = normalizeContainer(newSchedule?.container);
          const timeStr = newSchedule?.time ? String(newSchedule.time).substring(0, 5) : '';
          const dateStr = newSchedule?.date || '';
          const key = `${c}|${dateStr}|${timeStr}`;
          
          const existing = existingByKey.get(key);
          if (existing) {
            // Check if existing schedule is in grace period (even if new data says "Done")
            const isInGracePeriod = timeStr && alarmTriggerTracker.isWithinGracePeriod(c, timeStr, dateStr);
            if (isInGracePeriod && (existing.status === 'Done' || newSchedule.status === 'Done')) {
              // Keep the existing schedule with Done status if in grace period
              // This ensures it remains visible even after backend reload
              console.log(`[MonitorManageScreen] 🔄 Preserving schedule in grace period: Container ${c}, Time ${timeStr}, Date ${dateStr}`);
              return { ...existing, status: 'Done' }; // Ensure status is Done but keep in list
            }
          }
          return newSchedule;
        });
        
        // Also add any schedules from previous state that are in grace period but not in new data
        // This handles edge cases where backend might filter them out
        existingByKey.forEach((existing, key) => {
          const [cStr, dateStr, timeStr] = key.split('|');
          const c = normalizeContainer(cStr);
          const isInGracePeriod = timeStr && alarmTriggerTracker.isWithinGracePeriod(c, timeStr, dateStr);
          if (isInGracePeriod && existing.status === 'Done') {
            const alreadyInMerged = merged.some((s: any) => {
              const sKey = `${normalizeContainer(s?.container)}|${s?.date || ''}|${s?.time ? String(s.time).substring(0, 5) : ''}`;
              return sKey === key;
            });
            if (!alreadyInMerged) {
              console.log(`[MonitorManageScreen] 🔄 Adding back schedule in grace period: Container ${c}, Time ${timeStr}`);
              merged.push(existing);
            }
          }
        });
        
        return merged;
      });
      
      // Update schedule cache for instant status lookups (synchronous)
      // This enables instant status updates when Stop Alarm is pressed
      updateScheduleCache(sortedSchedules);
      
      // Log summary of loaded schedules
      console.log(`[MonitorManageScreen] ✅ Loaded ${sortedSchedules.length} schedule(s) from backend:`);
      sortedSchedules.forEach((sched, index) => {
        console.log(`  [${index + 1}] Container ${sched.container} - ${sched.time} (Schedule ID: ${sched.scheduleId || sched._id || 'N/A'})`);
      });

      // CRITICAL: Sync schedules to backend state.containers for alarm firing
      // The alarm system only checks state.containers, not the database.
      //
      // IMPORTANT: Do NOT block the Monitor & Manage screen on this call.
      // If the local backend IP is wrong/unreachable, a fetch without timeout can hang forever
      // and keep the screen stuck on "Loading...".
      (async () => {
        try {
          const base = await verificationService.getBackendUrl();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          try {
            // Build sync request body with elderId or userId for proper database query
            const syncBody: any = {};
            if (selectedElderId) {
              syncBody.elderId = selectedElderId;
            } else if (isElderUser) {
              syncBody.userId = currentUserId;
            }
            
            const syncResponse = await fetch(`${base}/sync-schedules-from-database`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
              },
              body: JSON.stringify(syncBody),
              signal: controller.signal,
            });
            if (syncResponse.ok) {
              const syncData = await syncResponse.json().catch(() => ({}));
              console.log(
                `[MonitorManageScreen] ✅ Synced ${syncData.total_schedules || 0} schedule(s) to backend alarm system (${syncData.synced_containers || 0} container(s))`
              );
            } else {
              console.warn(`[MonitorManageScreen] ⚠️ Failed to sync schedules to backend: ${syncResponse.status}`);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (syncErr) {
          // Handle AbortError (timeout) gracefully - it's expected when backend is slow/unreachable
          if (syncErr instanceof Error && syncErr.name === 'AbortError') {
            console.log('[MonitorManageScreen] ⏳ Sync request timed out (non-critical, alarms may still work if backend is reachable)');
          } else {
            console.warn('[MonitorManageScreen] ⚠️ Error syncing schedules to backend (alarms may not fire):', syncErr);
          }
        }
      })();

      // Also sync current schedules to Arduino over Bluetooth if connected
      // IMPORTANT: Sync happens AFTER deletion, so sortedSchedules only contains remaining (non-deleted) schedules
      // Only sync if explicitly requested (not during periodic refresh)
      // Also prevent syncing if we just synced recently (within last 10 seconds)
      if (syncToArduino) {
        const now = Date.now();
        const timeSinceLastSync = now - lastArduinoSync;
        const MIN_SYNC_INTERVAL = 10000; // 10 seconds minimum between syncs
        
        if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
          console.log(`[MonitorManageScreen] Skipping Arduino sync - last sync was ${Math.round(timeSinceLastSync / 1000)}s ago`);
        } else {
      try {
        const isActive = await BluetoothService.isConnectionActive();
        if (isActive && sortedSchedules.length > 0) {
              console.log(`[MonitorManageScreen] Syncing ${sortedSchedules.length} schedule(s) to Arduino...`);
              setLastArduinoSync(now);
              
              // Send each schedule with its container number
          await BluetoothService.sendCommand('SCHED CLEAR\n');
              await new Promise(resolve => setTimeout(resolve, 300)); // Increased delay
              
              for (const sched of sortedSchedules) {
                const containerNum = normalizeContainer(sched.container);
                console.log(`[MonitorManageScreen] Sending to Arduino: SCHED ADD ${sched.time} ${containerNum}`);
                await BluetoothService.sendCommand(`SCHED ADD ${sched.time} ${containerNum}\n`);
                await new Promise(resolve => setTimeout(resolve, 300)); // Increased delay for reliability
              }
              console.log(`[MonitorManageScreen] ✅ Successfully synced ${sortedSchedules.length} schedule(s) to Arduino`);
        } else if (isActive && sortedSchedules.length === 0) {
          // Clear Arduino if no schedules remain (after deletion)
          console.log('[MonitorManageScreen] No schedules remaining after deletion, clearing Arduino schedules...');
          await BluetoothService.sendCommand('SCHED CLEAR\n');
          await new Promise(resolve => setTimeout(resolve, 300));
          console.log('[MonitorManageScreen] ✅ Arduino schedules cleared.');
          setLastArduinoSync(now);
        }
      } catch (e) {
        console.warn('Bluetooth sync skipped:', e);
          }
        }
      }
      
    } catch (err) {
      // Surface timeouts as a friendlier message
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Monitor & Manage is taking too long to load. Please check your internet connection and try again.');
        return;
      }
      console.error('Error loading schedule data:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load schedule data';
      setError(errorMessage);
    } finally {
      if (showLoading) {
      setLoading(false);
    }
    }
  }, [getCurrentUserId, getSelectedElderId, lastArduinoSync]);

  // Load schedule data on component mount and when screen comes into focus
  // NO auto-deletion, NO auto-sync - user must manually sync or delete
  useEffect(() => {
    const loadData = async () => {
      await loadScheduleData(false, false, true); // NO sync to Arduino, NO auto-delete, show loading on initial load
      await loadVerifications();
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Refresh data when screen comes into focus
  // Auto-delete missed schedules, then sync remaining schedules to Arduino
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      // Re-check connection when screen comes into focus
      const selectedElderId = await getSelectedElderId();
      const userRole = await getUserRole();
      const roleStr = userRole ? String(userRole) : '';
      const isCaregiverUser = roleStr === '3';
      
      if (isCaregiverUser && selectedElderId) {
        console.log('[MonitorManageScreen] Screen focused - re-checking connection for elder:', selectedElderId);
        // Don't block screen focus refresh on connection checks
        checkCaregiverConnection(selectedElderId, false, true)
          .then((ok) => {
            if (ok) setHasActiveConnection(true);
          })
          .catch(() => {});
      }
      
      await loadScheduleData(true, false, true); // Sync to Arduino, NO auto-delete, show loading
      await loadVerifications();
    });

    return unsubscribe;
  }, [navigation, loadScheduleData, loadVerifications, getSelectedElderId, getUserRole, checkCaregiverConnection]);

  // Auto-update backend URL when Mac IP changes
  useEffect(() => {
    let mounted = true;
    let pollInterval: any = null;
    let lastKnownIp: string | null = null;
    let consecutiveUnreachable = 0;

    const autoUpdateBackendUrl = async () => {
      // DISABLED: Auto-update is disabled to prevent using old IPs
      // The app will ALWAYS use the default BACKEND_URL (10.129.153.91:5001)
      // This ensures the app never connects to the old IP (10.128.151.91:5001)
      if (!mounted) return;
      
      // Just test the default URL reachability - don't try to auto-update
      try {
        const reachable = await testBackendReachable(3000);
        setBackendReachable(reachable);
        if (reachable) {
          console.log(`[MonitorManageScreen] ✅ Backend is reachable at default URL: ${BACKEND_URL}`);
        } else {
          console.warn(`[MonitorManageScreen] ⚠️ Backend not reachable at default URL: ${BACKEND_URL}`);
        }
      } catch (e) {
        console.warn('[MonitorManageScreen] Error testing backend reachability:', e);
      }
    };

    // Initial load
    const load = async () => {
      try {
        // FORCE CLEAR: Remove ALL overrides on startup, especially invalid IPs
        // This ensures the app ALWAYS uses the current Mac IP (10.129.153.91)
        try {
          const override = await AsyncStorage.getItem('backend_url_override');
          if (override) {
            const trimmedOverride = String(override).trim();
            
            // CRITICAL: Check for invalid IPs first and clear immediately
            const invalidIPs = ['10.128.151.91', '10.165.11.91']; // Known invalid/old IPs
            const containsInvalidIP = invalidIPs.some(invalidIP => trimmedOverride.includes(invalidIP));
            
            if (containsInvalidIP) {
              console.warn(`[MonitorManageScreen] 🚨 FORCE CLEAR INVALID IP: Removing override with invalid IP (${trimmedOverride})`);
              console.log(`[MonitorManageScreen] ✅ Will use default URL: ${BACKEND_URL}`);
            } else {
              // Clear ALL overrides - force using default BACKEND_URL
              console.log(`[MonitorManageScreen] 🧹 FORCE CLEAR ALL: Removing stored override (${trimmedOverride}) to use default URL (${BACKEND_URL})`);
            }
            
            await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
            // Reset state immediately
            manualOverrideRef.current = false;
            setIsManualOverride(false);
            setBackendOverride(null);
            
            // Verify it's cleared - retry if needed
            const verify = await AsyncStorage.getItem('backend_url_override');
            if (verify) {
              console.warn(`[MonitorManageScreen] ⚠️ Override still exists, forcing removal again...`);
              await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
              await new Promise(resolve => setTimeout(resolve, 100));
              // Final verification
              const verify2 = await AsyncStorage.getItem('backend_url_override');
              if (verify2) {
                console.error(`[MonitorManageScreen] ❌ Failed to clear override after multiple attempts!`);
                // Last resort: try one more time
                await new Promise(resolve => setTimeout(resolve, 200));
                await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
              }
            }
          }
        } catch (e) {
          console.warn('[MonitorManageScreen] Error during force clear:', e);
        }
        
        // Now check what's left (should be nothing after force clear)
        // CRITICAL: Double-check and clear invalid IPs one more time before using
        let override = await AsyncStorage.getItem('backend_url_override');
        if (override) {
          const trimmedOverride = String(override).trim();
          const invalidIPs = ['10.128.151.91', '10.165.11.91'];
          const containsInvalidIP = invalidIPs.some(invalidIP => trimmedOverride.includes(invalidIP));
          
          if (containsInvalidIP) {
            console.warn(`[MonitorManageScreen] 🚨 FINAL CLEAR: Invalid IP still found (${trimmedOverride}). Force clearing one more time.`);
            await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
            await new Promise(resolve => setTimeout(resolve, 50));
            override = null; // Clear the local variable
            manualOverrideRef.current = false;
            setIsManualOverride(false);
            setBackendOverride(null);
          }
        }
        
        const isManual = await AsyncStorage.getItem('backend_url_manual_override');
        const isManualBool = isManual === 'true';
        manualOverrideRef.current = isManualBool;
        if (!mounted) return;
        
        // If override exists and is valid, test it first
        if (override && String(override).trim()) {
          const trimmedOverride = String(override).trim();
          console.log(`[MonitorManageScreen] Found stored override: ${trimmedOverride} (manual: ${isManualBool})`);
          
          // CRITICAL: Final check - reject invalid IPs one more time
          const invalidIPs = ['10.128.151.91', '10.165.11.91']; // Known invalid/old IPs (10.129.153.91 is the current correct IP)
          const containsInvalidIP = invalidIPs.some(invalidIP => trimmedOverride.includes(invalidIP));
          
          if (containsInvalidIP) {
            console.warn(`[MonitorManageScreen] 🚨 REJECTING INVALID IP: Found invalid IP in override (${trimmedOverride}). Clearing and using default.`);
            await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
            manualOverrideRef.current = false;
            setIsManualOverride(false);
            setBackendOverride(null);
            const defaultReachable = await testBackendReachable(5000);
            if (!mounted) return;
            setBackendReachable(defaultReachable);
            consecutiveUnreachable = defaultReachable ? 0 : 1;
            if (defaultReachable) {
              await autoUpdateBackendUrl();
            }
            return;
          }
          
          // Check if override matches the current default - if so, clear it to use default
          if (trimmedOverride === BACKEND_URL) {
            console.log(`[MonitorManageScreen] Override matches default URL, clearing to use default directly`);
            await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
            manualOverrideRef.current = false;
            setIsManualOverride(false);
            setBackendOverride(null);
            const defaultReachable = await testBackendReachable(5000);
            if (!mounted) return;
            setBackendReachable(defaultReachable);
            consecutiveUnreachable = defaultReachable ? 0 : 1;
            if (defaultReachable) {
              await autoUpdateBackendUrl();
            }
            return;
          }
          
          setBackendOverride(trimmedOverride);
          setIsManualOverride(isManualBool);
          
          // Test if override is reachable - if not, clear it immediately
          const overrideReachable = await testBackendReachable(3000);
          if (!mounted) return;
          
          if (!overrideReachable) {
            console.warn(`[MonitorManageScreen] ⚠️ Stored override (${override}) is unreachable. Clearing immediately.`);
            try {
              // Force clear all override-related storage using multiRemove for atomicity
              await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
              manualOverrideRef.current = false;
              setIsManualOverride(false);
              setBackendOverride(null);
              
              // Small delay to ensure AsyncStorage is fully cleared
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Verify override is actually cleared
              const verifyOverride = await AsyncStorage.getItem('backend_url_override');
              if (verifyOverride) {
                console.warn(`[MonitorManageScreen] ⚠️ Override still exists after clear (${verifyOverride}), forcing removal...`);
                await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              // Test default URL after clearing - use BACKEND_URL directly
              console.log(`[MonitorManageScreen] Testing default URL: ${BACKEND_URL}`);
              const defaultReachable = await testBackendReachable(5000);
              if (!mounted) return;
              setBackendReachable(defaultReachable);
              consecutiveUnreachable = defaultReachable ? 0 : 1;
              console.log(`[MonitorManageScreen] ✅ Cleared unreachable override. Default URL (${BACKEND_URL}) reachable: ${defaultReachable}`);
              
              // If default is reachable, trigger auto-update to get current IP
              if (defaultReachable) {
                await autoUpdateBackendUrl();
              }
            } catch (e) {
              console.warn('[MonitorManageScreen] Failed to clear unreachable override:', e);
              setBackendReachable(false);
              consecutiveUnreachable = 1;
            }
          } else {
            // Override is reachable, use it
            setBackendReachable(true);
            consecutiveUnreachable = 0;
            if (isManualBool) {
              console.log(`[MonitorManageScreen] 📌 Manual override active and reachable - auto-update disabled`);
            }
          }
        } else {
          // No override, test default URL
          setBackendOverride(null);
          setIsManualOverride(false);
          const defaultReachable = await testBackendReachable(5000);
          if (!mounted) return;
          setBackendReachable(defaultReachable);
          consecutiveUnreachable = defaultReachable ? 0 : 1;
          
          // If reachable, try to get current IP and auto-update
          if (defaultReachable) {
            await autoUpdateBackendUrl();
            // Test again after update
            const reachableAfterUpdate = await testBackendReachable(3000);
            if (!mounted) return;
            setBackendReachable(reachableAfterUpdate);
          } else {
            // If not reachable, try to auto-update anyway (might discover new IP)
            console.log('[MonitorManageScreen] Backend not reachable, attempting auto-update to discover new IP...');
            await autoUpdateBackendUrl();
            // Test again after update attempt
            const reachableAfterUpdate = await testBackendReachable(5000);
            if (!mounted) return;
            setBackendReachable(reachableAfterUpdate);
          }
        }
      } catch (e) {
        console.warn('[MonitorManageScreen] Error during initial load:', e);
        if (!mounted) return;
        setBackendReachable(false);
      }
    };
    
    load();
    
    // Poll for IP changes every 10 seconds (same as ESP32-CAM auto-config)
    pollInterval = setInterval(async () => {
      await autoUpdateBackendUrl();
      // Also refresh reachability status periodically
      if (mounted) {
        const reachable = await testBackendReachable(3000);
        setBackendReachable(reachable);

        // If override exists but we've been unreachable repeatedly, clear override once to recover automatically
        // Even if it's a manual override, if it's unreachable for too long, clear it
        if (!reachable) {
          consecutiveUnreachable += 1;
        } else {
          consecutiveUnreachable = 0;
        }
        if (!reachable && backendOverride && consecutiveUnreachable >= 3) {
          console.warn(`[MonitorManageScreen] Backend override still unreachable after ${consecutiveUnreachable} checks. Auto-clearing override (including manual override).`);
          try {
            await AsyncStorage.removeItem('backend_url_override');
            await AsyncStorage.removeItem('backend_url_manual_override');
            manualOverrideRef.current = false;
            setIsManualOverride(false);
            if (!mounted) return;
            setBackendOverride(null);
            consecutiveUnreachable = 0;
            console.log(`[MonitorManageScreen] ✅ Cleared unreachable override - will use default URL: ${BACKEND_URL}`);
          } catch (e) {
            console.warn('[MonitorManageScreen] Failed to auto-clear backend override (poll):', e);
          }
        }
      }
    }, 10000);
    
    return () => {
      mounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [backendOverride]);

  const saveBackendOverride = async (url: string | null) => {
    try {
      if (!url || !url.trim()) {
        // Clear override if empty
        await AsyncStorage.removeItem('backend_url_override');
        setBackendOverride(null);
        setBackendReachable(await testBackendReachable(3000));
        setBackendModalVisible(false);
        return;
      }

      let trimmedUrl = url.trim();
      
      // Remove trailing slashes
      trimmedUrl = trimmedUrl.replace(/\/+$/, '');
      
      // Basic URL validation
      if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
        Alert.alert('Invalid URL', 'Backend URL must start with http:// or https://');
        return;
      }
      
      // Convert HTTPS to HTTP (backend doesn't support HTTPS)
      if (trimmedUrl.startsWith('https://')) {
        trimmedUrl = trimmedUrl.replace('https://', 'http://');
        Alert.alert(
          'HTTPS Not Supported',
          'The backend server only supports HTTP, not HTTPS. Converting to HTTP automatically.',
          [{ text: 'OK' }]
        );
      }
      
      // If the URL matches the default (after normalization), clear override to use default
      if (trimmedUrl === BACKEND_URL) {
        console.log(`[MonitorManageScreen] Input URL matches default, clearing override to use default directly`);
        await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
        setBackendOverride(null);
        setIsManualOverride(false);
        manualOverrideRef.current = false;
        const reachable = await testBackendReachable(3000);
        setBackendReachable(reachable);
        setBackendModalVisible(false);
        Alert.alert('Using Default URL', `The URL you entered matches the default (${BACKEND_URL}). The override has been cleared and the app will use the default URL.`);
        return;
      }

      // Save the override
      await AsyncStorage.setItem('backend_url_override', trimmedUrl);
      // Mark as manually set to prevent auto-update from overwriting
      await AsyncStorage.setItem('backend_url_manual_override', 'true');
      manualOverrideRef.current = true;
      setIsManualOverride(true);
      setBackendOverride(trimmedUrl);
      
      console.log(`[MonitorManageScreen] 💾 Manually saved backend URL: ${trimmedUrl}`);
      
      // Test if the new URL is reachable
      const reachable = await testBackendReachable(3000);
      setBackendReachable(reachable);
      
      if (!reachable) {
        Alert.alert(
          'Backend Unreachable',
          `The backend at ${trimmedUrl} is not reachable. The URL has been saved.\n\nTroubleshooting:\n1. ✅ Backend is running (check Mac terminal)\n2. ⚠️ Device and Mac must be on SAME WiFi network\n3. ⚠️ Try accessing ${trimmedUrl}/test in phone browser\n4. ⚠️ Check Mac firewall settings\n5. ⚠️ If using phone hotspot: Mac must connect to phone's hotspot\n\nTip: The app will auto-retry and update when connection is restored.`,
          [
            { text: 'Retry', onPress: async () => {
              const retryReachable = await testBackendReachable(5000);
              setBackendReachable(retryReachable);
              if (!retryReachable) {
                Alert.alert('Still Unreachable', 'Please check network connectivity and try again.');
              }
            }},
            { text: 'OK' }
          ]
        );
      }
      
      setBackendModalVisible(false);
    } catch (e) {
      console.error('[MonitorManageScreen] Failed to save backend override:', e);
      Alert.alert('Error', `Failed to save backend URL: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const clearBackendOverride = async () => {
    try {
      await AsyncStorage.removeItem('backend_url_override');
      await AsyncStorage.removeItem('backend_url_manual_override');
      manualOverrideRef.current = false;
      setIsManualOverride(false);
      setBackendOverride(null);
      setBackendReachable(await testBackendReachable(3000));
      console.log(`[MonitorManageScreen] 🗑️ Cleared backend override - auto-update will resume`);
    } catch (e) {
      console.warn('[MonitorManageScreen] Failed to clear backend override:', e);
    }
  };

  // Initialize schedule cache on mount and listen for instant status updates
  useEffect(() => {
    // Initialize cache from AsyncStorage (non-blocking)
    initializeScheduleCache().catch(() => {});
    // Initialize alarm trigger tracker for 1-minute grace period after alarm triggers
    alarmTriggerTracker.initialize().catch((err) => {
      console.error('[MonitorManageScreen] Failed to initialize alarm trigger tracker:', err);
    });
    
    // Sync offline updates when app comes online
    syncOfflineUpdates().catch(() => {});
    
    // Listen for INSTANT status updates (when Stop Alarm is pressed)
    // This ensures UI updates immediately without waiting for backend or reload
    const statusListener = DeviceEventEmitter.addListener('pillnow:scheduleStatus', (event) => {
      const { container, time, status, scheduleId } = event;
      
      // INSTANT local state update - no async, no delays
      // CRITICAL: This updates status but does NOT remove the schedule from the list
      // The grace period check in pendingSchedulesToShow will keep it visible for 60 seconds
      setSchedules((prevSchedules) => {
        return prevSchedules.map((schedule) => {
          // Use stable container mapping to avoid mixing container IDs like "container2" and 2
          const scheduleContainer = normalizeContainer(schedule.container);
          const scheduleTime = String(schedule.time).substring(0, 5);
          const eventTime = String(time).substring(0, 5);
          
          // Match by container and time
          if (scheduleContainer === container && scheduleTime === eventTime) {
            // If status is Done, update immediately
            // NOTE: Schedule remains in the list - grace period check in pendingSchedulesToShow
            // will keep it visible for 60 seconds even with status "Done"
            if (status === 'Done') {
              console.log(`[MonitorManageScreen] ✅ INSTANT status update: Schedule ${schedule._id} → TAKEN (will remain visible during grace period)`);
              return { ...schedule, status: 'Done' };
            }
          }
          return schedule;
        });
      });
      
      // Force UI refresh
      setClockTick((t) => t + 1);
    });
    
    return () => {
      statusListener.remove();
    };
  }, []);
  
  // Periodically refresh derived statuses (Pending -> Missed once time passes)
  // Also auto-delete schedules missed for more than 5 minutes
  // Note: We reload data but don't sync to Arduino to avoid constant re-syncing
  useEffect(() => {
    let cycleCount = 0;
    
    // Update clock tick every 5 seconds to trigger status re-derivation and grace period checks
    // This ensures schedules disappear exactly when grace period expires (60 seconds)
    // Shorter interval (5s vs 10s) provides more accurate grace period expiration
    const statusUpdateInterval = setInterval(() => {
      setClockTick((t) => t + 1);
      // Clean up expired grace periods to free memory
      alarmTriggerTracker.cleanupExpired().catch(() => {});
    }, 5000); // Update every 5 seconds for accurate grace period expiration
    
    // Reload data every 30 seconds
    const dataReloadInterval = setInterval(async () => {
      cycleCount++;
      
      // Every 2 minutes (4 cycles of 30 seconds), run auto-deletion to clean up missed schedules
      const shouldAutoDelete = cycleCount % 4 === 0;
      
      try {
        if (shouldAutoDelete) {
          console.log('[MonitorManageScreen] 🔄 Periodic auto-deletion cycle (every 2 minutes)');
          await loadScheduleData(false, true, false); // Skip Arduino sync, but run auto-deletion, no loading
        } else {
          // Just reload for status updates, no deletion, no loading
          await loadScheduleData(false, false, false); // Pass false to skip Arduino sync, auto-deletion, and loading
        }
      } catch (err) {
        console.warn('[MonitorManageScreen] Error during periodic schedule cleanup:', err);
      }
    }, 30000); // Reload data every 30 seconds
    
    return () => {
      clearInterval(statusUpdateInterval);
      clearInterval(dataReloadInterval);
    };
  }, [loadScheduleData]);

  // Central handler for alarm stop events (from Bluetooth or modal)
  // NOTE: Alarm modals are now handled globally by GlobalAlarmHandler
  // This handler is kept for backward compatibility but should not manage modal state
  const handleAlarmStopped = useCallback(async (containerFromMessage: number, source: 'bluetooth' | 'modal' = 'bluetooth') => {
    const container = containerFromMessage;

    if (!container) {
      console.warn(`[MonitorManageScreen] ${source} stop received without container, skipping capture`);
      return;
    }

    const now = Date.now();
    if (lastAlarmStoppedRef.current.container === container && now - lastAlarmStoppedRef.current.timestamp < 2000) {
      console.log(`[MonitorManageScreen] Skipping duplicate alarm stop for Container ${container} from ${source}`);
      return;
    }
    lastAlarmStoppedRef.current = { container, timestamp: now };

    console.log(`[Auto Capture] Alarm stop handled (${source}) for Container ${container}, capturing AFTER pill taken...`);
    // NOTE: Alarm modal dismissal is now handled by GlobalAlarmHandler

    // Send notification that pill was taken
    try {
      // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
      const Notifications = await import('expo-notifications');
      if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
        await Notifications.default.scheduleNotificationAsync({
          content: {
            title: '✅ Pill Taken',
            body: `Verifying medication in Container ${container}...`,
            sound: false,
            ...(Platform.OS === 'android' && { priority: 'default' as const }),
            data: { container, action: 'pill_taken', source },
          },
          trigger: null, // Show immediately
        });
      }
    } catch (notificationError) {
      const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
      console.warn('Failed to send notification:', errorMessage);
    }

    // Create schedule notification for alarm stopped
    try {
      const base = await verificationService.getBackendUrl();
      try {
        const notificationResponse = await fetch(`${base}/notifications/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'alarm_stopped',
            container: `container${container}`,
            message: `Alarm stopped for Container ${container}. Verifying medication...`,
            scheduleId: null,
            source,
          })
        });
        if (notificationResponse.ok) {
          console.log('[MonitorManageScreen] ✅ Created schedule notification for alarm stopped');
        } else {
          console.warn('[MonitorManageScreen] ⚠️ Schedule notification returned status', notificationResponse.status);
        }
      } catch (notifErr) {
        console.warn('[MonitorManageScreen] Failed to create schedule notification:', notifErr);
      }
    } catch (err) {
      console.warn('[MonitorManageScreen] Could not determine backend URL for schedule notification:', err);
    }

    // Automatically trigger ESP32-CAM capture AFTER user takes pill
    try {
      const containerId = verificationService.getContainerId(container);
      console.log(`[Auto Capture] Alarm stopped for Container ${container}, mapping to containerId: ${containerId}`);
      console.log(`[Auto Capture] Capturing AFTER pill taken...`);
      
      // Get pill count from backend
      let pillCount = 0;
      try {
        const base = await verificationService.getBackendUrl();
        const configResponse = await fetch(`${base}/get-pill-config/${containerId}`);
        if (configResponse.ok) {
          const configData = await configResponse.json();
          pillCount = configData.pill_config?.count || 0;
          console.log(`[Auto Capture] Got pill count: ${pillCount} for ${containerId}`);
        } else {
          console.warn(`[Auto Capture] Failed to get pill config: ${configResponse.status}`);
        }
      } catch (configError) {
        console.warn(`[Auto Capture] Error fetching pill config:`, configError);
      }

      // Trigger capture with retry logic (same as pre-pill)
      console.log(`[Auto Capture] Calling triggerCapture for ${containerId} with pill count ${pillCount}...`);
      let captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
      console.log(`[Auto Capture] Post-pill capture result:`, captureResult);
      
      // Retry up to 2 more times if it fails
      let retryCount = 0;
      const maxRetries = 2;
      while (!captureResult.ok && retryCount < maxRetries) {
        retryCount++;
        console.warn(`[Auto Capture] ⚠️ Post-pill capture attempt ${retryCount} failed, retrying in ${retryCount * 2} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
        captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
        console.log(`[Auto Capture] 📸 Post-pill retry ${retryCount} result:`, captureResult);
      }
      
      if (captureResult.ok) {
        console.log(`[Auto Capture] ✅ Post-pill capture triggered successfully for Container ${container}`);
        
        // Wait a bit and check result
        const verificationTimeoutId = setTimeout(async () => {
          pendingTimeouts.delete(verificationTimeoutId);
          
          // Check if component is still mounted
          if (!listenerActive) {
            console.log('[Auto Capture] Component unmounted, skipping verification check');
            return;
          }
          
          try {
            const result = await verificationService.getVerificationResult(containerId);
            console.log(`[Auto Capture] Post-pill verification result:`, result);
            
            // Check mounted state again before async operations
            if (!listenerActive) {
              console.log('[Auto Capture] Component unmounted during verification check');
              return;
            }
            
            // Send verification result notification (alarm modal is already dismissed)
            try {
              // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
              const Notifications = await import('expo-notifications');
              if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
                const verificationStatus = result.success && result.result?.pass_ ? '✅ Verified' : '⚠️ Verification Failed';
                await Notifications.default.scheduleNotificationAsync({
                  content: {
                    title: verificationStatus,
                    body: result.success && result.result?.pass_ 
                      ? `Container ${container} medication verified successfully!`
                      : `Container ${container} verification failed. Please check the medication.`,
                  sound: result.success && result.result?.pass_,
                  ...(Platform.OS === 'android' && { priority: 'default' as const }),
                  data: { container, verificationResult: result, source },
                },
                trigger: null,
              });
            } else {
              throw new Error('Native module not available');
            }
          } catch (notificationError) {
            const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
            console.warn('Failed to send verification notification, using Alert:', errorMessage);
            // Only show alert if verification passed - don't show failure alert (too intrusive)
            if (result.success && result.result?.pass_) {
              Alert.alert(
                '✅ Verified',
                `Container ${container} medication verified successfully!`
              );
            } else {
              // Don't show failure alert - just log it
              console.log(`[MonitorManageScreen] Verification result: ${result.success ? 'Failed verification' : 'No result'}`);
            }
          }
          
          // Reload verifications to show updated status
          await loadVerifications();
          
          // Also reload schedules to update status after pill taken
          try {
            await loadScheduleData(false, false, false); // Don't sync to Arduino, don't auto-delete, no loading
          } catch (err) {
            console.warn('[MonitorManageScreen] Error reloading schedules after post-pill capture:', err);
          }
        } catch (verificationError) {
          console.error('[Auto Capture] Error checking post-pill verification:', verificationError);
          // Don't show alert for verification check errors - just log
        }
        }, 3000); // Reduced from 5000ms to 3000ms for faster feedback
      } else {
        console.error(`[Auto Capture] ❌ Failed to trigger capture: ${captureResult.message}`);
      }
    } catch (error) {
      console.error(`[Auto Capture] ❌ Exception during post-pill capture for Container ${container}:`, error);
      if (error instanceof Error) {
        console.error(`[Auto Capture] Error details: ${error.message}\n${error.stack}`);
      }
    }  }, [loadVerifications, loadScheduleData]);

  // Listen for Bluetooth alarm notifications
  useEffect(() => {
    // GlobalAlarmHandler is mounted at the app root (`app/_layout.tsx`) and handles:
    // - ALARM_TRIGGERED / ALARM_STOPPED / PILLALERT
    // - capture + verification polling
    // - alarm/mismatch modals across all screens
    //
    // Keeping a second alarm listener here causes duplicate modals, duplicate captures,
    // and inconsistent "stop alarm" behavior.
    const ENABLE_LOCAL_ALARM_HANDLING = false;
    if (!ENABLE_LOCAL_ALARM_HANDLING) {
      return;
    }

    console.log('[MonitorManageScreen] Setting up Bluetooth listener for alarm messages...');
    
    // Check if Bluetooth is connected
    const checkConnection = async () => {
      const isConnected = await BluetoothService.isConnectionActive();
      console.log(`[MonitorManageScreen] Bluetooth connection status: ${isConnected}`);
      if (!isConnected) {
        console.warn('[MonitorManageScreen] ⚠️ Bluetooth is not connected! Alarm messages will not be received.');
        Alert.alert(
          'Bluetooth Not Connected',
          'Please connect to Arduino via Bluetooth to receive alarm notifications.',
          [{ text: 'OK' }]
        );
      } else {
        console.log('[MonitorManageScreen] ✅ Bluetooth is connected, listener ready');
      }
    };
    checkConnection();
    
    let listenerActive = true;
    const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
    
    const cleanup = BluetoothService.onDataReceived(async (data: string) => {
      if (!listenerActive) {
        console.log('[MonitorManageScreen] Listener inactive, ignoring data');
        return;
      }
      
      const trimmedData = data.trim();
      console.log(`[MonitorManageScreen] 📱 Received Bluetooth data: "${trimmedData}"`);
      
      // Parse ALARM_TRIGGERED message: "ALARM_TRIGGERED C1 14:30" or "ALARM_TRIGGERED C1 14:30\n"
      if (trimmedData.includes('ALARM_TRIGGERED')) {
        console.log(`[MonitorManageScreen] ✅ Detected ALARM_TRIGGERED message: "${trimmedData}"`);
        
        // More flexible regex to handle variations
        const match = trimmedData.match(/ALARM_TRIGGERED\s+C(\d+)\s+(\d{1,2}):(\d{2})/);
        if (match) {
          const container = normalizeContainer(match[1]);
          const hour = match[2].padStart(2, '0');
          const minute = match[3];
          const timeStr = `${hour}:${minute}`;
          
          console.log(`[MonitorManageScreen] 📊 Parsed alarm: Container ${container} at ${timeStr}`);
          
          // NOTE: This code is disabled (ENABLE_LOCAL_ALARM_HANDLING = false)
          // Alarm modals are handled globally by GlobalAlarmHandler
          // Keeping this code commented for reference only
          /*
          // If an alarm modal is already showing, wait for it to close before showing another
          if (alarmVisible) {
            console.log(`[MonitorManageScreen] ⏳ Alarm modal already visible; ignoring new trigger until dismissed`);
            return;
          }
          
          // Cooldown: prevent rapid successive popups (3s window)
          const nowTs = Date.now();
          if (nowTs - lastAlarmShownRef.current < 3000) {
            console.log(`[MonitorManageScreen] ⏳ Alarm trigger ignored due to cooldown window`);
            return;
          }
          lastAlarmShownRef.current = nowTs;
          
          console.log(`[MonitorManageScreen] 🔔 Setting alarm modal visible...`);
          
          // Prevent duplicate modals - only update if modal is not already visible for this container/time
          if (alarmVisible && alarmContainer === container && alarmTime === timeStr) {
            console.log(`[MonitorManageScreen] ⚠️ Alarm modal already visible for Container ${container} at ${timeStr}, skipping duplicate`);
            return;
          }
          
          // Update state immediately using functional updates to ensure state is set
          setAlarmContainer(container);
          setAlarmTime(timeStr);
          setAlarmVisible(true);
          */
          
          console.log(`[MonitorManageScreen] ✅ Alarm modal state updated - visible: true, container: ${container}, time: ${timeStr}`);
          
          // Automatically trigger ESP32-CAM capture BEFORE user takes pill
          // Use setTimeout to ensure modal state is set first, then trigger capture
          // CRITICAL: Store timeout ID for cleanup and check mounted state
          const captureTimeoutId = setTimeout(async () => {
            // Remove from tracking set when executed
            pendingTimeouts.delete(captureTimeoutId);
            
            // Check if component is still mounted before proceeding
            if (!listenerActive) {
              console.log('[Auto Capture] Component unmounted, skipping capture');
              return;
            }
            
            try {
              const containerId = verificationService.getContainerId(container);
              console.log(`[Auto Capture] Alarm triggered for Container ${container}, mapping to containerId: ${containerId}`);
              console.log(`[Auto Capture] Capturing BEFORE pill taken...`);
              
              // Get pill count from backend
              let pillCount = 0;
              try {
                const configController = new AbortController();
                const configTimeoutId = setTimeout(() => configController.abort(), 5000);
                try {
                  const configResponse = await fetch(`${BACKEND_URL}/get-pill-config/${containerId}`, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: configController.signal
                  });
                  clearTimeout(configTimeoutId);
                  
                  if (configResponse.ok) {
                    const configData = await configResponse.json();
                    pillCount = configData.pill_config?.count || 0;
                    console.log(`[Auto Capture] Got pill count: ${pillCount} for ${containerId}`);
                  } else {
                    console.warn(`[Auto Capture] Failed to get pill config: HTTP ${configResponse.status}`);
                  }
                } catch (configError) {
                  clearTimeout(configTimeoutId);
                  if (configError instanceof Error && configError.name !== 'AbortError') {
                    console.warn(`[Auto Capture] Error fetching pill config:`, configError);
                  }
                  // Continue with pillCount = 0 if config fetch fails
                }
              } catch (configError) {
                console.warn(`[Auto Capture] Error setting up config fetch:`, configError);
                // Continue with pillCount = 0 if config fetch fails
              }
              
              // Check mounted state again before async operations
              if (!listenerActive) {
                console.log('[Auto Capture] Component unmounted during config fetch, skipping capture');
                return;
              }
              
              // Trigger capture with retry logic
              console.log(`[Auto Capture] 🎥 Calling triggerCapture for ${containerId} with pill count ${pillCount}...`);
              let captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
              console.log(`[Auto Capture] 📸 Capture result:`, captureResult);
              
              // Retry once if it fails (only if still mounted)
              if (!captureResult.ok && listenerActive) {
                console.warn(`[Auto Capture] ⚠️ First capture attempt failed, retrying in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Final mounted check before retry
                if (!listenerActive) {
                  console.log('[Auto Capture] Component unmounted during retry delay, skipping retry');
                  return;
                }
                
                captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
                console.log(`[Auto Capture] 📸 Retry capture result:`, captureResult);
              }
              
              if (captureResult.ok) {
                console.log(`[Auto Capture] ✅ Pre-pill capture triggered successfully for Container ${container}`);
                // Don't check verification result immediately - just log that capture was triggered
                // The verification will be checked after user takes pill (post-pill capture)
              } else if (listenerActive) {
                console.error(`[Auto Capture] ❌ Failed to trigger capture after retry: ${captureResult.message}`);
                // Don't show alert here - it might interfere with the alarm modal
                // Just log the error - user can still take the pill
                console.error(`[Auto Capture] Error details: ${captureResult.message}`);
              }
            } catch (error) {
              // Only log if component is still mounted
              if (listenerActive) {
                console.error(`[Auto Capture] ❌ Exception during pre-pill capture for Container ${container}:`, error);
                if (error instanceof Error) {
                  console.error(`[Auto Capture] Error details: ${error.message}\n${error.stack}`);
                }
              }
            }
          }, 500); // Small delay to ensure modal state is set first
          
          // CRITICAL: Track timeout for cleanup
          pendingTimeouts.add(captureTimeoutId);
          
          // Play alarm sound
          try {
            // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
            const { soundService } = await import('@/services/soundService');
            await soundService.initialize();
            await soundService.playAlarmSound('alarm');
          } catch (soundError) {
            console.warn('Failed to play alarm sound:', soundError);
          }

          // Show push notification
          try {
            // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
            const Notifications = await import('expo-notifications');
            // Check if native module is available
            if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
              await Notifications.default.scheduleNotificationAsync({
                content: {
                  title: '💊 Medication Reminder',
                  body: `Time to take medication from Container ${container} at ${timeStr}!`,
                  sound: 'default', // Use default system sound, or specify custom sound file
                  ...(Platform.OS === 'android' && { priority: 'high' as const }),
                  data: { container, time: timeStr },
                },
                trigger: null, // Show immediately
              });
            } else {
              throw new Error('Native module not available');
            }
          } catch (notificationError) {
            const errorMessage = notificationError instanceof Error ? notificationError.message : String(notificationError);
            console.warn('Failed to send notification, using Alert:', errorMessage);
            // Fallback to Alert if notification fails
            Alert.alert(
              '💊 Medication Reminder',
              `Time to take medication from Container ${container} at ${timeStr}!`,
              [{ text: 'OK' }]
            );
          }
          
          // Create schedule notification
          try {
            const notificationResponse = await fetch(`${BACKEND_URL}/notifications/schedule`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'alarm_triggered',
                container: `container${container}`,
                message: `Alarm triggered for Container ${container} at ${timeStr}`,
                scheduleId: null
              })
            });
            if (notificationResponse.ok) {
              console.log('[MonitorManageScreen] ✅ Created schedule notification for alarm trigger');
            }
          } catch (notifErr) {
            console.warn('[MonitorManageScreen] Failed to create schedule notification:', notifErr);
          }
          
          // Reload schedule data to update status (mark as "Active" or remove if needed)
          const reloadTimeoutId = setTimeout(async () => {
            pendingTimeouts.delete(reloadTimeoutId);
            
            // Check if component is still mounted
            if (!listenerActive) {
              console.log('[MonitorManageScreen] Component unmounted, skipping schedule reload');
              return;
            }
            
            console.log('[MonitorManageScreen] Reloading schedules after alarm trigger...');
            try {
              await loadScheduleData(false, false, false); // Don't sync to Arduino, don't auto-delete, no loading
            } catch (err) {
              console.warn('[MonitorManageScreen] Error reloading schedules after alarm:', err);
            }
          }, 1000);
          
          // CRITICAL: Track timeout for cleanup
          pendingTimeouts.add(reloadTimeoutId);
        }
      }
      
      // Parse ALARM_STOPPED message: "ALARM_STOPPED C1" (after user takes pill)
      // Also handle "ALARM_STOPPED" without container (fallback)
      if (data.includes('ALARM_STOPPED')) {
        console.log(`[MonitorManageScreen] ✅ Detected ALARM_STOPPED message: "${data}"`);
        let container = 0;
        const match = data.match(/ALARM_STOPPED C(\d+)/);
        if (match) {
          container = normalizeContainer(match[1]);
        } else {
          // If no container in message, use container from message or default to 1
          // NOTE: alarmContainer state is no longer used (alarms handled globally)
          container = container || 1;
          console.log(`[MonitorManageScreen] No container in ALARM_STOPPED message, using default: ${container}`);
        }
        
        await handleAlarmStopped(container, 'bluetooth');
      }
    });
    
    // Log when listener is set up
    console.log('[MonitorManageScreen] ✅ Bluetooth listener registered');
    
    return () => {
      console.log('[MonitorManageScreen] 🧹 Cleaning up Bluetooth listener...');
      listenerActive = false; // Mark listener as inactive
      
      // CRITICAL: Clear all pending timeouts to prevent memory leaks
      pendingTimeouts.forEach((timeoutId) => {
        try {
          clearTimeout(timeoutId);
        } catch (err) {
          // Ignore errors during cleanup
        }
      });
      pendingTimeouts.clear();
      
      // Cleanup should be synchronous and not block navigation
      try {
        if (cleanup) {
          cleanup();
        }
      } catch (err) {
        console.warn('[MonitorManageScreen] Error during cleanup:', err);
      }
    };
  }, [loadVerifications, loadScheduleData, handleAlarmStopped]);

  // Get latest schedule ID
  const getLatestScheduleId = async (): Promise<number> => {
    try {
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'If-Modified-Since': '0'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      const response = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers
      });
      const data = await response.json();
      const allSchedules = data.data || [];
      
      if (allSchedules.length === 0) {
        return 0; // No schedules exist
      }
      
      // Find the highest schedule ID
      const highestScheduleId = Math.max(...allSchedules.map((schedule: any) => schedule.scheduleId));
      return highestScheduleId;
    } catch (error) {
      console.error('Error getting latest schedule ID:', error);
      return 0;
    }
  };

  // Manual refresh function
  // Auto-delete missed schedules, then sync remaining schedules to Arduino
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await loadScheduleData(true, false, true); // Sync to Arduino, NO auto-delete, show loading
      await loadVerifications();
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Delete all schedules function
  const deleteAllSchedules = async () => {
    if (schedules.length === 0) {
      Alert.alert('No Schedules', 'There are no schedules to delete.');
      return;
    }

    Alert.alert(
      'Delete All Schedules',
      `Are you sure you want to delete all ${schedules.length} schedule(s)? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingAll(true);
              setLoading(true);
              const token = await AsyncStorage.getItem('token');
              const headers: HeadersInit = {
                'Content-Type': 'application/json',
              };
              if (token) {
                headers['Authorization'] = `Bearer ${token.trim()}`;
              }

              // Delete all schedules in batches
              const batchSize = 10;
              let deletedCount = 0;
              let failedCount = 0;
              const failedDeletions: Array<{ id: string, error: string }> = [];
              
              console.log(`[MonitorManageScreen] Starting deletion of ${schedules.length} schedule(s)...`);
              
              for (let i = 0; i < schedules.length; i += batchSize) {
                const batch = schedules.slice(i, i + batchSize);
                console.log(`[MonitorManageScreen] Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} schedule(s)`);
                
                const deletePromises = batch.map(async (schedule) => {
                  // Validate schedule ID
                  if (!schedule._id || typeof schedule._id !== 'string') {
                    console.error(`[MonitorManageScreen] Invalid schedule ID:`, schedule);
                    return { success: false, id: schedule._id || 'unknown', error: 'Invalid schedule ID' };
                  }
                  
                  try {
                    const deleteUrl = `https://pillnow-database.onrender.com/api/medication_schedules/${schedule._id}`;
                    console.log(`[MonitorManageScreen] Deleting schedule ${schedule._id} from ${deleteUrl}`);
                    
                    const response = await fetch(deleteUrl, {
                      method: 'DELETE',
                      headers
                    });
                    
                    const responseText = await response.text();
                    console.log(`[MonitorManageScreen] Delete response for ${schedule._id}: HTTP ${response.status} - ${responseText.substring(0, 200)}`);
                    
                    if (response.ok) {
                      console.log(`[MonitorManageScreen] ✅ Successfully deleted schedule ${schedule._id}`);
                      return { success: true, id: schedule._id };
                    } else {
                      // Handle specific error cases
                      let errorMsg = `HTTP ${response.status}`;
                      if (response.status === 401) {
                        errorMsg = 'Unauthorized - token may be expired';
                      } else if (response.status === 404) {
                        errorMsg = 'Schedule not found (may already be deleted)';
                        // Treat 404 as success since the goal is to remove it
                        console.log(`[MonitorManageScreen] ✅ Schedule ${schedule._id} already deleted (404)`);
                        return { success: true, id: schedule._id, error: 'Already deleted' };
                      } else if (response.status === 500) {
                        errorMsg = `Server error: ${responseText.substring(0, 100)}`;
                      }
                      
                      console.error(`[MonitorManageScreen] ❌ Failed to delete schedule ${schedule._id}: ${errorMsg}`);
                      console.error(`[MonitorManageScreen] Full error response: ${responseText}`);
                      return { success: false, id: schedule._id, error: errorMsg };
                    }
                  } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                    console.error(`[MonitorManageScreen] ❌ Exception deleting schedule ${schedule._id}:`, err);
                    return { success: false, id: schedule._id, error: errorMessage };
                  }
                });

                const results = await Promise.all(deletePromises);
                
                // Count successes and failures from results (don't increment inside callbacks)
                const batchSuccess = results.filter(r => r.success).length;
                const batchFailed = results.filter(r => !r.success).length;
                deletedCount += batchSuccess;
                failedCount += batchFailed;
                
                // Collect failed deletion details
                const batchFailedDetails = results.filter(r => !r.success).map(r => ({ id: r.id, error: r.error || 'Unknown error' }));
                failedDeletions.push(...batchFailedDetails);
                
                console.log(`[MonitorManageScreen] Batch ${Math.floor(i / batchSize) + 1} complete: ${batchSuccess} deleted, ${batchFailed} failed (Total: ${deletedCount} deleted, ${failedCount} failed)`);
                
                // Log failed deletions with details
                batchFailedDetails.forEach(r => {
                  console.warn(`[MonitorManageScreen] Failed deletion: ${r.id} - ${r.error}`);
                });
                
                // Small delay between batches
                if (i + batchSize < schedules.length) {
                  await new Promise(resolve => setTimeout(resolve, 200));
                }
              }

              console.log(`[MonitorManageScreen] ✅ Deletion complete: ${deletedCount} deleted, ${failedCount} failed out of ${schedules.length} total`);
              
              if (failedDeletions.length > 0) {
                console.warn(`[MonitorManageScreen] Failed deletions details:`, failedDeletions);
              }

              // Clear Arduino schedules
              try {
                const isBluetoothActive = await BluetoothService.isConnectionActive();
                if (isBluetoothActive) {
                  await BluetoothService.sendCommand('SCHED CLEAR\n');
                  await new Promise(resolve => setTimeout(resolve, 300));
                  console.log('[MonitorManageScreen] ✅ Cleared all schedules from Arduino');
                } else {
                  console.warn('[MonitorManageScreen] Bluetooth not active, skipping Arduino clear');
                }
              } catch (btErr) {
                console.warn('[MonitorManageScreen] Bluetooth schedule clear failed:', btErr);
              }

              // Reload schedules to reflect deletions
              console.log('[MonitorManageScreen] Reloading schedules after deletion...');
              await loadScheduleData(true, false, false); // Sync to Arduino, no auto-delete, no loading
              await loadVerifications();
              
              // Show appropriate alert based on results
              if (failedCount === 0 && deletedCount > 0) {
                Alert.alert('Success', `All ${deletedCount} schedule(s) deleted successfully!`);
              } else if (deletedCount > 0 && failedCount > 0) {
                const errorSummary = failedDeletions.slice(0, 3).map(f => `- ${f.id}: ${f.error}`).join('\n');
                const moreErrors = failedDeletions.length > 3 ? `\n... and ${failedDeletions.length - 3} more` : '';
                Alert.alert(
                  'Partial Success', 
                  `${deletedCount} schedule(s) deleted, ${failedCount} failed.\n\nErrors:\n${errorSummary}${moreErrors}\n\nCheck console logs for full details.`
                );
              } else if (failedCount > 0 && deletedCount === 0) {
                const errorSummary = failedDeletions.slice(0, 3).map(f => `- ${f.id}: ${f.error}`).join('\n');
                const moreErrors = failedDeletions.length > 3 ? `\n... and ${failedDeletions.length - 3} more` : '';
                Alert.alert(
                  'Deletion Failed', 
                  `Failed to delete all ${failedCount} schedule(s).\n\nErrors:\n${errorSummary}${moreErrors}\n\nPossible causes:\n- Invalid schedule IDs\n- Authentication expired (401)\n- Server error (500)\n\nCheck console logs for details.`
                );
              } else {
                Alert.alert('No Schedules', 'No schedules were found to delete.');
              }
            } catch (err) {
              console.error('Error deleting all schedules:', err);
              Alert.alert('Error', `Failed to delete all schedules: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
              // CRITICAL: always reset deletingAll so the Set/Modify/Adherence buttons re-enable
              setDeletingAll(false);
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Navigate back to appropriate dashboard based on user role
  const handleBack = useCallback(async () => {
    try {
      setNavigating('back');
      // NOTE: Alarm modal is handled globally by GlobalAlarmHandler, no need to close here
      
      // Get user role to determine which dashboard to navigate to
      const token = await AsyncStorage.getItem('token');
      if (token) {
        try {
          const decodedToken = jwtDecode<DecodedToken>(token.trim());
          const userRole = decodedToken.role?.toString() || await AsyncStorage.getItem('userRole');
          
          // Navigate to appropriate dashboard based on role
          if (userRole === '3') {
            router.replace('/CaregiverDashboard');
          } else if (userRole === '2') {
            router.replace('/ElderDashboard');
          } else {
            // Fallback: try to go back, or navigate to ElderDashboard
            if (navigation.canGoBack && navigation.canGoBack()) {
              navigation.goBack();
            } else {
              router.replace('/ElderDashboard');
            }
          }
        } catch (error) {
          // If token decode fails, try to go back normally
          if (navigation.canGoBack && navigation.canGoBack()) {
            navigation.goBack();
          } else {
            router.replace('/ElderDashboard');
          }
        }
      } else {
        // No token, try to go back normally
        if (navigation.canGoBack && navigation.canGoBack()) {
          navigation.goBack();
        } else {
          router.replace('/ElderDashboard');
        }
      }
    } catch (error) {
      console.error('Error navigating back:', error);
      // Fallback navigation
      if (navigation.canGoBack && navigation.canGoBack()) {
        navigation.goBack();
      } else {
        router.replace('/ElderDashboard');
      }
    } finally {
      setTimeout(() => setNavigating(null), 500);
    }
  }, [navigation, router]);

  // Helper to derive status locally without mutating backend
  // Mark as "Missed" if it's been more than 1 minute past the scheduled time
  const markAsMissedOnce = useCallback(async (schedule: any) => {
    const id = schedule?._id;
    if (!id || missedMarkedRef.current.has(id)) return;
    missedMarkedRef.current.add(id);
    try {
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token.trim()}`;
      
      // Try PATCH first
      const resp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Missed' })
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        console.warn(`[MonitorManageScreen] PATCH failed (${resp.status}): ${errorText}, trying PUT...`);
        
        // Fallback to PUT if PATCH doesn't work
        const putResp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...schedule, status: 'Missed' })
        });
        
        if (!putResp.ok) {
          const putErrorText = await putResp.text();
          console.error(`[MonitorManageScreen] ⚠️ PUT also failed (${putResp.status}): ${putErrorText}`);
        } else {
          console.log(`[MonitorManageScreen] ✅ Schedule ${id} marked as Missed (via PUT)`);
          setSchedules(prev => prev.map(s => (s._id === id ? { ...s, status: 'Missed' } : s)));
        }
      } else {
        console.log(`[MonitorManageScreen] ✅ Schedule ${id} marked as Missed (via PATCH)`);
        setSchedules(prev => prev.map(s => (s._id === id ? { ...s, status: 'Missed' } : s)));
      }
    } catch (err) {
      console.error(`[MonitorManageScreen] Error marking missed for ${id}:`, err);
    }
  }, []);

  // Helper to derive status locally without mutating backend
  // Mark as "Missed" if it's been more than 1 minute past the scheduled time
  // GRACE PERIOD: Schedules remain visible for 1 minute after alarm trigger,
  // even if marked as TAKEN, so users can see and interact with the alarm.
  const deriveStatus = useCallback((schedule: any): 'Pending' | 'Missed' | 'Taken' | string => {
    const rawStatus = (schedule?.status || 'Pending') as string;
    const container = normalizeContainer(schedule?.container);
    const timeStr = schedule?.time ? String(schedule.time).substring(0, 5) : '';
    const dateStr = schedule?.date;
    
    // GRACE PERIOD: If schedule is within 1-minute grace period after alarm trigger,
    // keep it visible even if status is Done/Taken
    const isWithinGracePeriod = timeStr && alarmTriggerTracker.isWithinGracePeriod(container, timeStr, dateStr);
    
    // If already marked as Done, show as Taken
    // BUT: If within grace period, we still want to show it (handled by filtering logic)
    if (rawStatus.toLowerCase() === 'done') {
      return 'Taken';
    }
    
    // If already marked as Missed, keep it as Missed
    if (rawStatus.toLowerCase() === 'missed') {
      return 'Missed';
    }
    
    if (!schedule?.date || !schedule?.time) return rawStatus || 'Pending';
    
    try {
      const [y, m, d] = String(schedule.date).split('-').map(Number);
      const [hh, mm] = String(schedule.time).split(':').map(Number);
      const when = new Date(y, (m || 1) - 1, d, hh, mm);
      const now = new Date();
      const oneMinuteAgo = now.getTime() - (1 * 60 * 1000); // 1 minute buffer
      
      // Mark as "Missed" if:
      // 1. Status is "Pending" or "Active" (not already Done/Missed)
      // 2. Current time is past scheduled time
      // 3. It's been more than 1 minute past (buffer to prevent premature marking)
      // 4. NOT within grace period (grace period takes precedence)
      const isPendingOrActive = rawStatus === 'Pending' || rawStatus === 'Active' || !rawStatus;
      if (isPendingOrActive && when.getTime() < oneMinuteAgo && !isWithinGracePeriod) {
        // Mark as missed in backend (only once per schedule)
        markAsMissedOnce(schedule);
        return 'Missed';
      }
      
      return rawStatus || 'Pending';
    } catch {
      return rawStatus || 'Pending';
    }
  }, [markAsMissedOnce]);

  // For the "Current Schedules" dropdown, only show the latest *pending* schedule
  // for each container (1, 2, 3). Keep `schedules` untouched because other flows
  // (delete-all, syncing) rely on the full list.
  // 
  // GRACE PERIOD: Schedules remain visible for 1 minute after alarm trigger,
  // even if marked as TAKEN, to give users time to see and interact with the alarm.
  const pendingSchedulesToShow = useMemo(() => {
    const parseWhenMs = (schedule: any): number | null => {
      if (!schedule?.date || !schedule?.time) return null;
      try {
        const [y, m, d] = String(schedule.date).split('-').map(Number);
        const [hh, mm] = String(schedule.time).split(':').map(Number);
        const when = new Date(y, (m || 1) - 1, d, hh, mm);
        const ms = when.getTime();
        return Number.isFinite(ms) ? ms : null;
      } catch {
        return null;
      }
    };

    const byContainer: Record<1 | 2 | 3, any[]> = { 1: [], 2: [], 3: [] };
    for (const s of schedules || []) {
      const c = normalizeContainer(s?.container);
      
      const status = deriveStatus(s);
      const timeStr = s?.time ? String(s.time).substring(0, 5) : '';
      const dateStr = s?.date;
      
      // GRACE PERIOD: Check if schedule is within 1-minute grace period after alarm trigger
      // CRITICAL: This check MUST happen BEFORE status filtering to prevent premature removal
      // The grace period ensures schedules remain visible for exactly 60 seconds after alarm trigger,
      // even if status becomes "Done" or "Taken" immediately
      const isWithinGracePeriod = timeStr && alarmTriggerTracker.isWithinGracePeriod(c, timeStr, dateStr);
      
      // SINGLE SOURCE OF TRUTH: Visibility is determined by grace period OR status, not status alone
      // Show schedule if:
      // 1. Status is Pending (always show pending schedules), OR
      // 2. Status is Taken/Done BUT within grace period (1 minute after alarm trigger)
      //    This ensures the schedule stays visible even after being marked as TAKEN
      const shouldShow = status === 'Pending' || (status === 'Taken' && isWithinGracePeriod);
      
      if (shouldShow) {
        byContainer[c as 1 | 2 | 3].push(s);
      } else if (isWithinGracePeriod) {
        // DEBUG: Log if grace period check passes but schedule is still filtered
        console.log(`[MonitorManageScreen] ⚠️ Schedule in grace period but filtered: Container ${c}, Time ${timeStr}, Status ${status}`);
      }
    }

    // Pick the "current" pending schedule per container: the soonest upcoming time.
    const pickSoonest = (items: any[]) => {
      return [...items].sort((a, b) => {
        const aMs = parseWhenMs(a);
        const bMs = parseWhenMs(b);
        if (aMs === null && bMs === null) return 0;
        if (aMs === null) return 1;
        if (bMs === null) return -1;
        return aMs - bMs;
      })[0];
    };

    const picked = [1, 2, 3]
      .map((c) => pickSoonest(byContainer[c as 1 | 2 | 3]))
      .filter(Boolean);

    // Ensure stable order: container 1, 2, 3
    return picked.sort((a: any, b: any) => normalizeContainer(a?.container) - normalizeContainer(b?.container));
  }, [schedules, deriveStatus, clockTick]); // Include clockTick to refresh when grace period expires

  // Get container schedules
  const getContainerSchedules = (): Record<number, { pill: string | null, alarms: Date[] }> => {
    const containerSchedules: Record<number, { pill: string | null, alarms: Date[] }> = {
      1: { pill: null, alarms: [] },
      2: { pill: null, alarms: [] },
      3: { pill: null, alarms: [] }
    };
    
    if (!schedules.length || !medications.length) {
      return containerSchedules;
    }
    
    // Group schedules by container
    const schedulesByContainer: Record<number, any[]> = {};
    schedules.forEach((schedule: any) => {
      const containerNum = normalizeContainer(schedule.container);
      if (!schedulesByContainer[containerNum]) {
        schedulesByContainer[containerNum] = [];
      }
      schedulesByContainer[containerNum].push(schedule);
    });
    
    // Process each container
    for (let containerNum = 1; containerNum <= 3; containerNum++) {
      const containerSchedulesList = schedulesByContainer[containerNum] || [];
      
      if (containerSchedulesList.length > 0) {
        const firstSchedule = containerSchedulesList[0];
        const medicationId = firstSchedule.medication;
        
        // Find medication name from ID
        const medication = medications.find(med => med.medId === medicationId);
        const medicationName = medication ? medication.name : `ID: ${medicationId}`;
        
        containerSchedules[containerNum] = {
          pill: medicationName,
          alarms: containerSchedulesList.map((schedule: any) => {
            const dateStr = schedule.date;
            const timeStr = schedule.time;
            // Create date in local timezone instead of UTC
            const [year, month, day] = dateStr.split('-').map(Number);
            const [hours, minutes] = timeStr.split(':').map(Number);
            return new Date(year, month - 1, day, hours, minutes);
          })
        };
      }
    }
    
    return containerSchedules;
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: theme.primary }]}
            onPress={() => loadScheduleData(true, true, true)}
          >
            <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

    const containerSchedules = getContainerSchedules();

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={handleBack}
          disabled={navigating === 'back'}
        >
          {navigating === 'back' ? (
            <ActivityIndicator size="small" color={theme.text} />
          ) : (
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          )}
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          {isCaregiver && monitoringElder ? (
            <>
              <Text style={[styles.title, { color: theme.secondary }]}>
                ELDER <Text style={[styles.elderNameHighlight, { color: theme.primary }]}>{monitoringElder.name.toUpperCase()}</Text> DASHBOARD
              </Text>
              <View style={[styles.monitoringBanner, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
                <Ionicons name="eye" size={14} color={theme.primary} />
                <Text style={[styles.monitoringText, { color: theme.primary }]}>
                  Monitoring Active
                </Text>
              </View>
            </>
          ) : (
            <Text style={[styles.title, { color: theme.secondary }]}>
              MONITOR & MANAGE
            </Text>
          )}
        </View>
        {schedules.length > 0 && (
          <TouchableOpacity 
            style={[styles.deleteAllButton, { backgroundColor: theme.error }]}
            onPress={deleteAllSchedules}
            disabled={deletingAll || refreshing}
          >
            {deletingAll ? (
              <ActivityIndicator size="small" color={theme.card} />
            ) : (
              <Ionicons name="trash" size={20} color={theme.card} />
            )}
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          style={[styles.refreshButton, { backgroundColor: theme.primary }]}
          onPress={handleRefresh}
          disabled={refreshing || deletingAll}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={theme.card} />
          ) : (
            <Ionicons name="refresh" size={20} color={theme.card} />
          )}
        </TouchableOpacity>
      </View>

      {/* Backend override - Hidden display, accessible via settings icon */}
      {/* 
        Backend IP Override Function:
        - AUTOMATIC: The app automatically detects and updates the backend URL when your Mac's IP changes
        - Polls the backend every 10 seconds to check for IP changes (same as ESP32-CAM auto-config)
        - Auto-updates the override in the background - no manual intervention needed!
        - Manual Override: You can still manually set a custom backend URL if needed
        - Edit: Set a custom backend URL (e.g., "http://10.165.11.91:5001")
        - Clear: Remove the override and use automatic detection
        - The override is saved locally and persists across app restarts
        - All API calls will use this override URL instead of the default
      */}
      <View style={{ alignItems: 'flex-end', marginTop: 10, marginBottom: -10 }}>
        <TouchableOpacity 
          onPress={async () => { 
            // Force clear ALL overrides before opening modal - always use default
            try {
              const override = await AsyncStorage.getItem('backend_url_override');
              if (override) {
                console.log(`[MonitorManageScreen] 🧹 Clearing ALL overrides before opening modal: ${override}`);
                await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
                setBackendOverride(null);
                setIsManualOverride(false);
                manualOverrideRef.current = false;
              }
            } catch (e) {
              console.warn('[MonitorManageScreen] Error clearing override:', e);
            }
            // Always use default BACKEND_URL
            setBackendInput(BACKEND_URL);
            setBackendModalVisible(true); 
          }} 
          style={[styles.backendSettingsButton, { backgroundColor: theme.card }]}
        >
          <Ionicons 
            name="settings-outline" 
            size={20} 
            color={theme.textSecondary} 
          />
        </TouchableOpacity>
      </View>

      <Modal 
        visible={backendModalVisible} 
        transparent 
        animationType="slide"
        statusBarTranslucent
        hardwareAccelerated
        onRequestClose={() => setBackendModalVisible(false)}
      >
        <View style={[styles.modalOverlay, { zIndex: 10002, elevation: 1002 }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.card, zIndex: 10003, elevation: 1003 }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Backend URL Settings</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary, marginBottom: 16, fontSize: 12 }]}>
              Current: {BACKEND_URL}
            </Text>
            {isManualOverride && (
              <Text style={[styles.modalSubtitle, { color: theme.primary, marginBottom: 8, fontSize: 11, fontStyle: 'italic' }]}>
                📌 Manual override active - Auto-update disabled
              </Text>
            )}
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary, marginBottom: 12, fontSize: 12 }]}>
              Status: {backendReachable === null ? 'Checking...' : (backendReachable ? '✅ Reachable' : '⚠️ Unreachable')}
            </Text>
            <TextInput
              value={backendInput}
              onChangeText={setBackendInput}
              placeholder="http://10.0.0.1:5001"
              style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
              autoCapitalize="none"
              editable={true}
              keyboardType="url"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
              <TouchableOpacity 
                onPress={() => clearBackendOverride()} 
                style={[styles.smallButton, { backgroundColor: theme.background, flex: 1 }]}
              >
                <Text style={{ color: theme.primary }}>Clear Override</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => setBackendModalVisible(false)} 
                style={[styles.smallButton, { backgroundColor: theme.background, flex: 1 }]}
              >
                <Text style={{ color: theme.primary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={() => saveBackendOverride(backendInput)} 
                style={[styles.smallButton, { flex: 1 }]}
              >
                <Text style={{ color: theme.card }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

        {/* Current Scheduled Section - Dropdown */}
      <View style={[styles.scheduleSection, { backgroundColor: theme.card }]}> 
          <TouchableOpacity 
            style={styles.dropdownHeader}
            onPress={() => setSchedulesExpanded(!schedulesExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.dropdownHeaderContent}>
        <Text style={[styles.sectionTitle, { color: theme.secondary }]}>
          Current Schedules
        </Text>
              {pendingSchedulesToShow.length > 0 && (
                <View style={[styles.scheduleCountBadge, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.scheduleCountText, { color: theme.card }]}>
                    {pendingSchedulesToShow.length}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons 
              name={schedulesExpanded ? "chevron-up" : "chevron-down"} 
              size={24} 
              color={theme.secondary} 
            />
          </TouchableOpacity>
          
          {schedulesExpanded && (
            <>
        {pendingSchedulesToShow.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No pending schedules found
            </Text>
          </View>
        ) : (
          <View style={styles.schedulesList}>
            {pendingSchedulesToShow.map((schedule: any, index: number) => {
              // Find medication name from ID
              const medication = medications.find(med => med.medId === schedule.medication);
              const medicationName = medication ? medication.name : `ID: ${schedule.medication}`;
              const verification = verifications[normalizeContainer(schedule.container)];
              const status = deriveStatus(schedule);
              
              return (
                <View key={schedule._id || index} style={[styles.scheduleItem, { borderColor: theme.border }]}>
                  <View style={styles.scheduleHeader}>
                    <Text style={[styles.scheduleTitle, { color: theme.primary }]}>
                      Container {schedule.container}
                    </Text>
                    <View style={[
                      styles.statusBadge, 
                      { backgroundColor: status === 'Pending' ? theme.warning : status === 'Missed' ? theme.error : theme.success }
                    ]}>
                      <Text style={[styles.statusText, { color: theme.card }]}>
                        {status}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.scheduleDetails}>
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Medication:</Text> {medicationName || 'Unknown Medication'}
                    </Text>
                    {medication?.manufacturer && (
                      <Text style={[styles.detailText, { color: theme.textSecondary }]}>
                        <Text style={styles.label}>Manufacturer:</Text> {medication.manufacturer}
                      </Text>
                    )}
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Date:</Text> {schedule.date}
                    </Text>
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Time:</Text> {schedule.time}
                    </Text>
                          {verification && (
                            <View style={styles.verificationBadge}>
                              <Ionicons 
                                name={verification.result?.pass_ ? "checkmark-circle" : "alert-circle"} 
                                size={16} 
                                color={verification.result?.pass_ ? "#4CAF50" : "#F44336"} 
                              />
                              <View style={{ flex: 1 }}>
                                <Text style={[
                                  styles.verificationDetailText, 
                                  { color: verification.result?.pass_ ? "#4CAF50" : "#F44336" }
                                ]}>
                                  {verification.result?.pass_ 
                                    ? `Verified: ${verification.result?.count || 0} pills (${Math.round((verification.result?.confidence || 0) * 100)}%)`
                                    : 'Verification failed'}
                                </Text>
                                {verification.result?.classesDetected && 
                                 verification.result.classesDetected.length > 0 && (
                                  <Text style={[styles.verificationDetailText, { fontSize: 11, marginTop: 2, opacity: 0.8 }]}>
                                    {verification.result.classesDetected
                                      .map((pill: { label: string; n: number }) => `${pill.label} (${pill.n})`)
                                      .join(', ')}
                                  </Text>
                                )}
                              </View>
                            </View>
                          )}
                  </View>
                </View>
              );
            })}
          </View>
              )}
            </>
        )}
      </View>

      {/* Buttons Container */}
      <View style={styles.buttonsContainer}>
        {/* Show connection status banner for caregivers monitoring an elder */}
        {isCaregiver && monitoringElder && (
          <View style={[styles.monitoringBanner, { backgroundColor: hasActiveConnection ? theme.success + '20' : theme.warning + '20', borderColor: hasActiveConnection ? theme.success : theme.warning, marginBottom: 10 }]}>
            <Ionicons name={hasActiveConnection ? "checkmark-circle" : "warning"} size={16} color={hasActiveConnection ? theme.success : theme.warning} />
            <Text style={[styles.monitoringText, { color: hasActiveConnection ? theme.success : theme.warning }]}>
              {hasActiveConnection 
                ? `Monitoring ${monitoringElder.name} - Active Connection`
                : `Connection to ${monitoringElder.name} needs verification`}
            </Text>
            {!hasActiveConnection && (
              <TouchableOpacity
                onPress={async () => {
                  if (monitoringElder) {
                    const connectionStatus = await checkCaregiverConnection(monitoringElder.id, true, true);
                    if (connectionStatus) {
                      setHasActiveConnection(true);
                    }
                  }
                }}
                style={{ marginLeft: 8 }}
              >
                <Ionicons name="refresh" size={16} color={theme.warning} />
              </TouchableOpacity>
            )}
          </View>
        )}
        
        {/* Always show buttons - connection will be verified when needed */}
        <>
          <TouchableOpacity 
            style={[
              styles.button, 
              { backgroundColor: theme.primary },
              navigating === 'setScreen' && styles.buttonDisabled
            ]} 
            onPress={async () => {
              try {
                // For caregivers, verify connection before navigating
                if (isCaregiver && monitoringElder) {
                  const connectionStatus = await checkCaregiverConnection(monitoringElder.id, false, true);
                  if (!connectionStatus) {
                    Alert.alert(
                      'Connection Required',
                      `You need an active connection to ${monitoringElder.name} to set schedules. Please verify your connection.`,
                      [{ text: 'OK' }]
                    );
                    return;
                  }
                  setHasActiveConnection(true);
                }
                setNavigating('setScreen');
                navigation.navigate("SetScreen" as never);
              } catch (error) {
                console.error('Error navigating to SetScreen:', error);
              } finally {
                setTimeout(() => setNavigating(null), 500);
              }
            }}
            disabled={navigating !== null || refreshing || deletingAll}
          > 
            {navigating === 'setScreen' ? (
              <ActivityIndicator size="small" color={theme.card} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.card }]}>SET MED SCHED</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.button, 
              { backgroundColor: theme.secondary },
              navigating === 'modifyScreen' && styles.buttonDisabled
            ]} 
            onPress={async () => {
              try {
                // For caregivers, verify connection before navigating
                if (isCaregiver && monitoringElder) {
                  const connectionStatus = await checkCaregiverConnection(monitoringElder.id, false, true);
                  if (!connectionStatus) {
                    Alert.alert(
                      'Connection Required',
                      `You need an active connection to ${monitoringElder.name} to modify schedules. Please verify your connection.`,
                      [{ text: 'OK' }]
                    );
                    return;
                  }
                  setHasActiveConnection(true);
                }
                setNavigating('modifyScreen');
                navigation.navigate("ModifyScheduleScreen" as never);
              } catch (error) {
                console.error('Error navigating to ModifyScheduleScreen:', error);
              } finally {
                setTimeout(() => setNavigating(null), 500);
              }
            }}
            disabled={navigating !== null || refreshing || deletingAll}
          > 
            {navigating === 'modifyScreen' ? (
              <ActivityIndicator size="small" color={theme.card} />
            ) : (
              <Text style={[styles.buttonText, { color: theme.card }]}>MODIFY SCHED</Text>
            )}
          </TouchableOpacity>
        </>
        <TouchableOpacity 
          style={[
            styles.button, 
            { backgroundColor: theme.secondary },
            navigating === 'adherence' && styles.buttonDisabled
          ]}
          onPress={async () => {
            try {
              setNavigating('adherence');
              navigation.navigate("Adherence" as never);
            } catch (error) {
              console.error('Error navigating to Adherence:', error);
            } finally {
              setTimeout(() => setNavigating(null), 500);
            }
          }}
          disabled={navigating !== null || refreshing || deletingAll}
        > 
          {navigating === 'adherence' ? (
            <ActivityIndicator size="small" color={theme.card} />
          ) : (
            <Text style={[styles.buttonText, { color: theme.card }]}>VIEW ADHERENCE STATS & LOGS</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>

      {/* Alarm modals are handled globally by `app/components/GlobalAlarmHandler.tsx` */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    marginTop: 40,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  backButton: {
    padding: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  elderNameHighlight: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  refreshButton: {
    padding: 8,
    borderRadius: 20,
    marginLeft: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteAllButton: {
    padding: 8,
    borderRadius: 20,
    marginLeft: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 16,
  },
  retryButton: {
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonsContainer: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 20,
  },
  connectionWarningContainer: {
    width: '90%',
    alignItems: 'center',
    marginVertical: 10,
  },
  connectionWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    width: '100%',
    gap: 10,
  },
  connectionWarningText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  checkConnectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    width: '100%',
  },
  checkConnectionButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    width: '90%',
    padding: 15,
    borderRadius: 12,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    minHeight: 50,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  scheduleSection: {
    marginTop: 20,
    padding: 15,
    borderRadius: 15,
    elevation: 5,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  dropdownHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginRight: 10,
  },
  scheduleCountBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleCountText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  monitoringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  monitoringText: {
    fontSize: 11,
    fontWeight: '600',
  },
  schedulesList: {
    // No specific styles needed here, items will be styled individually
  },
  scheduleItem: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  scheduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  scheduleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  scheduleDetails: {
    marginTop: 5,
  },
  detailText: {
    fontSize: 15,
    marginBottom: 3,
  },
  label: {
    fontWeight: 'bold',
    marginRight: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    gap: 6,
  },
  verificationDetailText: {
    fontSize: 12,
    fontWeight: '500',
  },

  /* Backend settings button - small, unobtrusive */
  backendSettingsButton: {
    padding: 8,
    borderRadius: 20,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  /* Dev UI styles (kept for compatibility, but no longer displayed) */
  devRowWrapper: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  devLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  devValue: {
    fontSize: 14,
  },
  devStatus: {
    fontSize: 12,
    marginTop: 4,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#007bff',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    padding: 16,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
});

export default MonitorManageScreen;