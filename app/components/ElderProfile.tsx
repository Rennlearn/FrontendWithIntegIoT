import React, { useState, useEffect } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image, 
  Alert, ActivityIndicator, FlatList 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { lightTheme, darkTheme } from '../styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId: string;
  role?: string;
}

// Interface for elder user data
interface ElderUser {
  userId?: string;
  _id?: string;
  id?: string;
  name: string;
  email: string;
  contactNumber: string;
  profileImage?: string;
  role: number;
}

interface ElderProfileProps {
  onElderSelected?: (elderId: string, elderName: string) => void;
  onBack?: () => void;
}

export default function ElderProfile({ onElderSelected, onBack }: ElderProfileProps) {
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  // State for elder connection
  const [elderPhone, setElderPhone] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedElders, setConnectedElders] = useState<ElderUser[]>([]);
  const [loading, setLoading] = useState(false);
  
  // State for creating new elder account
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [elderName, setElderName] = useState('');
  const [elderEmail, setElderEmail] = useState('');
  const [elderPhoneCreate, setElderPhoneCreate] = useState('');
  const [elderPassword, setElderPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);

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

  // Load connected elders from local storage on mount
  useEffect(() => {
    loadConnectedElders();
  }, []);

  // Load connected elders from database (not AsyncStorage)
  const loadConnectedElders = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('No token found, cannot load connected elders');
        setConnectedElders([]);
        return;
      }

      const caregiverId = await getCurrentCaregiverId();
      console.log('Loading connected elders from database for caregiver:', caregiverId);

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
          console.log('Trying endpoint:', endpoint);
          response = await fetch(endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });
          
          if (response.ok) {
            console.log('✅ Successfully fetched from endpoint:', endpoint);
            break;
          } else if (response.status !== 404) {
            // If it's not 404, it might be a different error, log it
            console.log(`Endpoint returned ${response.status}:`, endpoint);
          }
        } catch (error) {
          console.log('Endpoint failed:', endpoint, error);
          continue;
        }
      }

      if (!response || !response.ok) {
        console.error('All endpoints failed. Last response:', response?.status);
        setConnectedElders([]);
        return;
      }

      if (response.ok) {
        const data = await response.json();
        console.log('Connected elders from database (raw response):', JSON.stringify(data, null, 2));
        
        // Extract elder information from connections
        let elders: ElderUser[] = [];
        let connectionsArray: any[] = [];
        
        // Normalize response structure
        if (Array.isArray(data)) {
          connectionsArray = data;
        } else if (data.connections && Array.isArray(data.connections)) {
          connectionsArray = data.connections;
        } else if (data.data && Array.isArray(data.data)) {
          connectionsArray = data.data;
        } else if (data.success && data.data) {
          connectionsArray = Array.isArray(data.data) ? data.data : [data.data];
        }
        
        console.log('Extracted connections array:', connectionsArray.length, 'items');
        
        // Extract elder information from each connection
        elders = connectionsArray.map((conn: any) => {
          // Try different possible structures for elder data
          const elder = conn.elder || conn.elderData || conn.elderInfo || {};
          const elderId = elder.userId || elder._id || elder.id || conn.elderId || conn.elder;
          
          console.log('Processing connection:', {
            connectionId: conn.connectionId || conn._id || conn.id,
            elderId: elderId,
            elderName: elder.name,
            status: conn.status
          });
          
          return {
            userId: String(elderId || ''),
            name: elder.name || 'Unknown',
            email: elder.email || '',
            contactNumber: elder.contactNumber || elder.phone || elder.phoneNumber || '',
            role: elder.role || 2,
            profileImage: elder.profileImage
          };
        }).filter((elder: ElderUser) => elder.userId); // Filter out any with missing IDs

        // Filter only active connections
        const activeElders = elders.filter((elder: ElderUser) => {
          const conn = connectionsArray.find((c: any) => {
            const connElderId = (c.elder || c.elderData || c.elderInfo || {}).userId || 
                                (c.elder || c.elderData || c.elderInfo || {})._id || 
                                (c.elder || c.elderData || c.elderInfo || {}).id || 
                                c.elderId || c.elder;
            return String(connElderId) === String(elder.userId);
          });
          const isActive = conn && (conn.status === 'active' || conn.status === 'Active' || conn.status === 'ACTIVE');
          if (!isActive) {
            console.log('Filtered out inactive connection for elder:', elder.name, 'Status:', conn?.status);
          }
          return isActive;
        });

        console.log('✅ Loaded', activeElders.length, 'active connected elders from database');
        console.log('Elders:', activeElders.map(e => ({ name: e.name, id: e.userId })));
        
        // Merge with existing local elders instead of replacing
        // This preserves elders that were added locally but not yet in database response
        setConnectedElders((prevElders) => {
          const merged = [...prevElders];
          
          // Add new elders from database that aren't already in local list
          activeElders.forEach((dbElder) => {
            const exists = merged.some(e => String(e.userId) === String(dbElder.userId));
            if (!exists) {
              merged.push(dbElder);
              console.log('Added elder from database to merged list:', dbElder.name);
            }
          });
          
          // Update existing elders with database data (in case info changed)
          merged.forEach((localElder, index) => {
            const dbElder = activeElders.find(e => String(e.userId) === String(localElder.userId));
            if (dbElder) {
              merged[index] = dbElder; // Use database version
            }
          });
          
          console.log('✅ Merged list has', merged.length, 'elders');
          return merged;
        });
      } else if (response.status === 404) {
        // No connections found in database - keep existing local list
        console.log('No connected elders found in database, keeping local list');
        // Don't clear the list - keep what we have locally
      } else {
        const errorText = await response.text();
        console.error('Error loading connected elders from database:', response.status, errorText);
        // Don't clear the list on error - keep existing local elders
        console.log('Keeping existing local elders list due to error');
      }
    } catch (error) {
      console.error('Error loading connected elders from database:', error);
      setConnectedElders([]);
    } finally {
      setLoading(false);
    }
  };

  // Save connected elders to local storage
  const saveConnectedElders = async (connections: ElderUser[]) => {
    try {
      console.log('Saving connected elders:', connections);
      const caregiverId = await getCurrentCaregiverId();
      const storageKey = `caregiver_connections_${caregiverId}`;
      console.log('Storage key:', storageKey);
      await AsyncStorage.setItem(storageKey, JSON.stringify(connections));
      console.log('Connected elders saved successfully');
    } catch (error) {
      console.error('Error saving connected elders:', error);
    }
  };

  // Generate a default password for elder (since they won't be logging in)
  const generateDefaultPassword = () => {
    return `Elder${Date.now().toString().slice(-6)}`;
  };

  // Create new elder account (for elders who can't use the app)
  const createElderAccount = async () => {
    if (!elderName.trim() || !elderEmail.trim() || !elderPhoneCreate.trim()) {
      Alert.alert('Error', 'Please fill in all required fields (Name, Email, Phone)');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(elderEmail.trim())) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    try {
      setIsCreating(true);
      
      // Use generated password if not provided (elder won't be logging in)
      const password = elderPassword.trim() || generateDefaultPassword();
      
      // Create elder account
      const response = await fetch('https://pillnow-database.onrender.com/api/users/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: elderName.trim(),
          email: elderEmail.trim(),
          phone: elderPhoneCreate.trim(),
          password: password,
          role: 2, // Elder role
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create elder account');
      }

      const newElderData = await response.json();
      console.log('Elder account created:', newElderData);

      // Get the created elder's ID
      let elderId = newElderData.user?.userId || newElderData.user?._id || newElderData.user?.id || newElderData.userId || newElderData._id || newElderData.id;
      
      // If we don't have the ID from response, fetch the elder by phone
      if (!elderId) {
        const token = await AsyncStorage.getItem('token');
        const endpoints = [
          `https://pillnow-database.onrender.com/api/elders/phone/${elderPhoneCreate.trim()}`,
          `https://pillnow-database.onrender.com/api/users/elder/${elderPhoneCreate.trim()}`,
          `https://pillnow-database.onrender.com/api/users/phone/${elderPhoneCreate.trim()}?role=2`,
        ];

        for (const endpoint of endpoints) {
          try {
            const elderResponse = await fetch(endpoint, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
            });
            
            if (elderResponse.ok) {
              const elderData = await elderResponse.json();
              let userData = null;
              
              if (Array.isArray(elderData)) {
                userData = elderData[0];
              } else if (elderData.user) {
                userData = elderData.user;
              } else if (elderData.name || elderData.email) {
                userData = elderData;
              }
              
              if (userData && userData.role === 2) {
                elderId = userData.userId || userData._id || userData.id;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }

      // Create elder object for connection
      const newElder: ElderUser = {
        userId: elderId,
        name: elderName.trim(),
        email: elderEmail.trim(),
        contactNumber: elderPhoneCreate.trim(),
        role: 2,
      };

      // Check if already in the list
      const existingElder = connectedElders.find(conn => 
        (conn.userId === elderId) || (conn.contactNumber === elderPhoneCreate.trim())
      );
      
      if (existingElder) {
        Alert.alert('Already Connected', `${elderName.trim()} is already in your list.`);
        // Reset form
        setElderName('');
        setElderEmail('');
        setElderPhoneCreate('');
        setElderPassword('');
        setShowCreateForm(false);
        return;
      }

      // Add to connected elders list
      const updatedElders = [...connectedElders, newElder];
      await saveConnectedElders(updatedElders);
      setConnectedElders(updatedElders);

      Alert.alert(
        'Success',
        `Elder account created and connected successfully!\n\nName: ${elderName.trim()}\nPhone: ${elderPhoneCreate.trim()}\n\nNote: The elder does not need to login. You can manage their medication schedules.`
      );

      // Reset form
      setElderName('');
      setElderEmail('');
      setElderPhoneCreate('');
      setElderPassword('');
      setShowCreateForm(false);
      
    } catch (error: any) {
      console.error('Error creating elder account:', error);
      Alert.alert('Error', error.message || 'Failed to create elder account. Please try again.');
    } finally {
      setIsCreating(false);
    }
  };

  // Connect to elder by phone number
  const connectToElder = async () => {
    console.log('Connect button pressed with phone:', elderPhone);
    
    if (!elderPhone.trim()) {
      Alert.alert('Error', 'Please enter the elder\'s phone number');
      return;
    }

    try {
      setIsConnecting(true);
      
      // Get token for authentication
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        Alert.alert('Error', 'Authentication required. Please log in again.');
        return;
      }

      console.log('Token found, attempting to connect to elder...');

      // Try to find elder by phone number using elder-specific endpoints
      let elder: ElderUser | null = null;
      
      try {
        // Try different endpoints that should only return elders
        const endpoints = [
          `https://pillnow-database.onrender.com/api/elders/phone/${elderPhone.trim()}`,
          `https://pillnow-database.onrender.com/api/users/elder/${elderPhone.trim()}`,
          `https://pillnow-database.onrender.com/api/users/phone/${elderPhone.trim()}?role=2`,
          `https://pillnow-database.onrender.com/api/users?phone=${elderPhone.trim()}&role=2`
        ];

        for (const endpoint of endpoints) {
          try {
            console.log('Trying endpoint:', endpoint);
            
            const elderResponse = await fetch(endpoint, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              }
            });
            
            console.log('Response status:', elderResponse.status);
            
            if (elderResponse.ok) {
              const elderData = await elderResponse.json();
              console.log('Response data:', elderData);
              
              // Normalize phone number for comparison (remove spaces, dashes, etc.)
              const normalizePhone = (phone: string): string => {
                return phone.replace(/[\s\-\(\)]/g, '').trim();
              };
              const searchPhone = normalizePhone(elderPhone.trim());
              
              // Handle different response structures
              let userData = null;
              let userArray: any[] = [];
              
              if (Array.isArray(elderData)) {
                // Response is an array of users - filter by phone number
                userArray = elderData;
              } else if (elderData.user) {
                userData = elderData.user;
              } else if (elderData.elders && Array.isArray(elderData.elders)) {
                userArray = elderData.elders;
              } else if (elderData.users && Array.isArray(elderData.users)) {
                userArray = elderData.users;
              } else if (elderData.data && Array.isArray(elderData.data)) {
                userArray = elderData.data;
              } else if (elderData.name || elderData.email) {
                userData = elderData; // Direct user object
              }
              
              // If we have an array, find the user with matching phone number
              if (userArray.length > 0) {
                console.log(`Searching ${userArray.length} users for phone: ${searchPhone}`);
                userData = userArray.find((user: any) => {
                  const userPhone = user.contactNumber || user.phone || user.phoneNumber || '';
                  const normalizedUserPhone = normalizePhone(userPhone);
                  const matches = normalizedUserPhone === searchPhone;
                  console.log(`Comparing: "${normalizedUserPhone}" === "${searchPhone}" = ${matches}`);
                  return matches;
                });
                
                if (!userData) {
                  console.log('No user found with matching phone number in array');
                  // Continue to next endpoint instead of returning
                  continue;
                }
              }
              
              // Verify phone number matches if we have userData
              if (userData) {
                const userPhone = userData.contactNumber || userData.phone || userData.phoneNumber || '';
                const normalizedUserPhone = normalizePhone(userPhone);
                
                if (normalizedUserPhone !== searchPhone) {
                  console.log(`Phone mismatch: "${normalizedUserPhone}" !== "${searchPhone}"`);
                  // Phone doesn't match, continue to next endpoint
                  continue;
                }
                
                // Phone matches, now check role
                if (userData.role === 2) {
                  elder = userData;
                  console.log('Elder found with matching phone:', elder!.name);
                  console.log('Elder phone:', elder!.contactNumber || elder!.phone);
                  console.log('Elder object:', elder);
                  console.log('Elder userId:', elder!.userId);
                  break; // Found elder with matching phone, stop trying other endpoints
                } else {
                  // User found with matching phone but not an elder
                  const userRole = userData.role;
                  console.log('User found with matching phone but not an elder, role:', userRole);
                  
                  let roleMessage = '';
                  if (userRole === 1) {
                    roleMessage = 'This phone number belongs to an admin account. Only elder accounts can be connected.';
                  } else if (userRole === 3) {
                    roleMessage = 'This phone number belongs to a caregiver account. Only elder accounts can be connected.';
                  } else {
                    roleMessage = 'This phone number belongs to a user who is not registered as an elder. Only elder accounts can be connected.';
                  }
                  
                  Alert.alert('Invalid User Type', roleMessage);
                  setIsConnecting(false);
                  return;
                }
              }
            } else if (elderResponse.status === 403) {
              console.log('403 Forbidden - Access denied for endpoint:', endpoint);
              continue; // Try next endpoint
            } else if (elderResponse.status === 404) {
              console.log('404 Not Found for endpoint:', endpoint);
              continue; // Try next endpoint
            }
          } catch (endpointError) {
            console.log('Endpoint failed:', endpoint, endpointError);
            continue; // Try next endpoint
          }
        }
      } catch (error) {
        console.error('Error accessing user by phone:', error);
        Alert.alert('Error', 'Failed to verify user account. Please try again.');
        return;
      }
      
      if (!elder) {
        console.log('No elder found after trying all endpoints');
        Alert.alert(
          'Elder Not Found', 
          'No elder account found with this phone number. Please check the number and try again.\n\nNote: Only registered elders can be connected.'
        );
        return;
      }

      // Check if already connected in database
      try {
        const caregiverId = await getCurrentCaregiverId();
        const checkResponse = await fetch(`https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elder=${elderId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });

        if (checkResponse.ok) {
          const checkData = await checkResponse.json();
          const existingConnection = Array.isArray(checkData) 
            ? checkData.find((c: any) => (c.elder === elderId || (c.elder?.userId || c.elder?._id || c.elder?.id) === elderId))
            : (checkData.connections || checkData.data || []).find((c: any) => (c.elder === elderId || (c.elder?.userId || c.elder?._id || c.elder?.id) === elderId));
          
          if (existingConnection) {
            console.log('Elder already connected in database:', elder!.name);
            Alert.alert('Already Connected', `${elder!.name} is already connected in the database.`);
            // Reload to show updated list
            await loadConnectedElders();
            return;
          }
        }
      } catch (checkError) {
        console.error('Error checking existing connection:', checkError);
        // Continue anyway - will be caught by POST request
      }

      // Validate that we have the elder's ID
      const elderId = elder!.userId;
      if (!elderId) {
        console.error('Elder found but missing ID:', elder);
        Alert.alert('Error', 'Elder found but missing user ID. Please try again.');
        return;
      }

      // Get caregiver ID from token
      const decodedToken = jwtDecode<{ userId?: string; id?: string }>(token);
      const caregiverId = decodedToken.userId || decodedToken.id;
      
      if (!caregiverId) {
        console.error('Caregiver ID not found in token');
        Alert.alert('Error', 'Unable to identify caregiver. Please log in again.');
        return;
      }

      // Create CaregiverConnection record in database using new endpoint (no device required)
      try {
        console.log('Creating CaregiverConnection record in database...');
        console.log('Caregiver ID:', caregiverId, 'Elder ID:', elderId);
        
        // Use new endpoint: POST /api/caregivers/connect
        const connectionResponse = await fetch('https://pillnow-database.onrender.com/api/caregivers/connect', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
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

        if (connectionResponse.ok) {
          const connectionData = await connectionResponse.json();
          console.log('✅ CaregiverConnection created successfully in database:', connectionData);
          if (connectionData.success) {
            console.log('Connection ID:', connectionData.data?.connectionId);
            console.log('Status:', connectionData.data?.status);
          }
          
          // After successful connection, add elder to local list immediately
          // This ensures the elder appears even if the GET endpoint doesn't work yet
          const elderToAdd: ElderUser = {
            userId: elderId,
            name: elder!.name,
            email: elder!.email || '',
            contactNumber: elder!.contactNumber || elder!.phone || '',
            role: 2,
            profileImage: elder!.profileImage
          };
          
          // Check if already in list
          const existingIndex = connectedElders.findIndex(e => 
            String(e.userId) === String(elderId)
          );
          
          if (existingIndex === -1) {
            // Add to list
            const updatedElders = [...connectedElders, elderToAdd];
            setConnectedElders(updatedElders);
            console.log('✅ Elder added to local list:', elderToAdd.name);
          } else {
            console.log('ℹ️ Elder already in local list');
          }
          
        } else if (connectionResponse.status === 409) {
          // Connection already exists - this is OK
          console.log('ℹ️ CaregiverConnection already exists in database');
          
          // Still add to local list if not already there
          const existingIndex = connectedElders.findIndex(e => 
            String(e.userId) === String(elderId)
          );
          
          if (existingIndex === -1) {
            const elderToAdd: ElderUser = {
              userId: elderId,
              name: elder!.name,
              email: elder!.email || '',
              contactNumber: elder!.contactNumber || elder!.phone || '',
              role: 2,
              profileImage: elder!.profileImage
            };
            const updatedElders = [...connectedElders, elderToAdd];
            setConnectedElders(updatedElders);
            console.log('✅ Elder added to local list (connection already existed):', elderToAdd.name);
          }
        } else {
          const errorText = await connectionResponse.text();
          console.error('❌ Failed to create CaregiverConnection in database:', connectionResponse.status, errorText);
          Alert.alert(
            'Connection Failed',
            `Failed to create connection in database: ${errorText}\n\nPlease try again.`,
            [{ text: 'OK' }]
          );
          return; // Don't continue if database connection fails
        }
      } catch (connectionError) {
        console.error('❌ Error creating CaregiverConnection in database:', connectionError);
        Alert.alert(
          'Connection Error',
          'Failed to create connection in database. Please check your internet connection and try again.',
          [{ text: 'OK' }]
        );
        return; // Don't continue if database connection fails
      }

      // Reload connected elders from database (this will sync with server)
      // But we've already added to local list above, so it will show immediately
      await loadConnectedElders();

      console.log('Successfully connected to elder:', elder!.name);
      console.log('Elder User ID stored:', elderId);
      Alert.alert(
        'Success', 
        `Successfully connected to ${elder!.name}\n\nElder ID: ${elderId}\nPhone: ${elder!.contactNumber}`
      );
      
      // Reset form
      setElderPhone('');
      
    } catch (error) {
      console.error('Error connecting to elder:', error);
      Alert.alert('Error', 'Failed to connect to elder. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Remove elder from list
  const removeElder = async (elderId: string | undefined) => {
    console.log('Remove elder called with ID:', elderId);
    
    if (!elderId) {
      Alert.alert('Error', 'Cannot remove elder: Invalid elder ID');
      return;
    }
    
    // Check if elder is actually in the list
    const elderInList = connectedElders.find(elder => {
      const elderUserId = elder.userId || elder._id || elder.id;
      return elderUserId === elderId;
    });
    
    if (!elderInList) {
      console.log('Elder not found in connected list with ID:', elderId);
      console.log('Available elders:', connectedElders.map(e => ({ name: e.name, id: e.userId || e._id || e.id })));
      Alert.alert('Error', 'Elder not found in connected list');
      return;
    }
    
    console.log('Found elder in list:', elderInList.name);
    
    Alert.alert(
      'Remove Elder',
      'Are you sure you want to remove this elder from your list?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              console.log('Removing elder from list...');
              console.log('Current connected elders:', connectedElders);
              console.log('Looking for elder with ID:', elderId);
              
              // Remove from list using any available ID field
              const updatedElders = connectedElders.filter(elder => {
                const elderUserId = elder.userId || elder._id || elder.id;
                console.log('Comparing elder ID:', elderUserId, 'with:', elderId);
                return elderUserId !== elderId;
              });
              
              console.log('Updated elders list:', updatedElders);
              
              await saveConnectedElders(updatedElders);
              setConnectedElders(updatedElders);

              console.log('Elder removed successfully');
              Alert.alert('Success', 'Elder removed successfully');
            } catch (error) {
              console.error('Error removing elder:', error);
              Alert.alert('Error', 'Failed to remove elder');
            }
          }
        }
      ]
    );
  };

  // Display elder details
  const showElderDetails = (elder: ElderUser) => {
    const elderId = elder.userId;
    Alert.alert(
      'Elder Details',
      `Name: ${elder.name}\nEmail: ${elder.email}\nPhone: ${elder.contactNumber}\nElder ID: ${elderId || 'Not available'}`,
      [{ text: 'OK', style: 'default' }]
    );
  };

  // Select elder to monitor
  const selectElder = async (elderId: string | undefined, elderName: string) => {
    try {
      console.log('Select elder called with ID:', elderId, 'Name:', elderName);
      
      if (!elderId) {
        Alert.alert('Error', 'Cannot select elder: Invalid elder ID');
        return;
      }
      
      await AsyncStorage.setItem('selectedElderId', elderId);
      await AsyncStorage.setItem('selectedElderName', elderName);
      
      console.log('Elder selected for monitoring:', elderName);
      Alert.alert('Success', `Now monitoring ${elderName}`);
      
      // Call the callback if provided
      if (onElderSelected) {
        console.log('Calling onElderSelected callback');
        onElderSelected(elderId, elderName);
      }
    } catch (error) {
      console.error('Error selecting elder:', error);
      Alert.alert('Error', 'Failed to select elder');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header Section */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={onBack}
        >
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary }]}>
          ELDER <Text style={[styles.highlight, { color: theme.primary }]}>CONNECTIONS</Text>
        </Text>
      </View>

      {/* Connect/Create Elder Section */}
      <View style={[styles.section, { backgroundColor: theme.card }]}>
        {/* Toggle between Connect and Create */}
        <View style={[styles.toggleContainer, { backgroundColor: theme.background }]}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              !showCreateForm && { backgroundColor: theme.primary },
              showCreateForm && { backgroundColor: 'transparent' },
            ]}
            onPress={() => setShowCreateForm(false)}
          >
            <Text
              style={[
                styles.toggleText,
                { color: !showCreateForm ? theme.card : theme.text },
              ]}
            >
              Connect Existing
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              showCreateForm && { backgroundColor: theme.primary },
              !showCreateForm && { backgroundColor: 'transparent' },
            ]}
            onPress={() => setShowCreateForm(true)}
          >
            <Text
              style={[
                styles.toggleText,
                { color: showCreateForm ? theme.card : theme.text },
              ]}
            >
              Create New Elder
            </Text>
          </TouchableOpacity>
        </View>

        {!showCreateForm ? (
          // Connect to Existing Elder
          <>
            <Text style={[styles.sectionTitle, { color: theme.secondary }]}>Connect to Existing Elder</Text>
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              Connect to an elder who already has an account. Enter their registered phone number.
            </Text>
            
            <TextInput 
              style={[styles.input, { 
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              }]} 
              placeholder="Elder's Phone Number" 
              placeholderTextColor={theme.textSecondary}
              value={elderPhone}
              onChangeText={setElderPhone}
              keyboardType="phone-pad"
            />

            <TouchableOpacity 
              style={[styles.connectButton, { backgroundColor: theme.primary }]}
              onPress={connectToElder}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <ActivityIndicator color={theme.card} />
              ) : (
                <Text style={[styles.buttonText, { color: theme.card }]}>CONNECT</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          // Create New Elder Account
          <>
            <Text style={[styles.sectionTitle, { color: theme.secondary }]}>Create Elder Account</Text>
            <Text style={[styles.helperText, { color: theme.textSecondary }]}>
              Create an account for an elder who cannot use the app. You will manage their medication schedules.
            </Text>
            
            <TextInput 
              style={[styles.input, { 
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              }]} 
              placeholder="Elder's Full Name *" 
              placeholderTextColor={theme.textSecondary}
              value={elderName}
              onChangeText={setElderName}
              autoCapitalize="words"
            />

            <TextInput 
              style={[styles.input, { 
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              }]} 
              placeholder="Elder's Email *" 
              placeholderTextColor={theme.textSecondary}
              value={elderEmail}
              onChangeText={setElderEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput 
              style={[styles.input, { 
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              }]} 
              placeholder="Elder's Phone Number *" 
              placeholderTextColor={theme.textSecondary}
              value={elderPhoneCreate}
              onChangeText={setElderPhoneCreate}
              keyboardType="phone-pad"
            />

            <TextInput 
              style={[styles.input, { 
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.text,
              }]} 
              placeholder="Password (Optional - auto-generated if empty)" 
              placeholderTextColor={theme.textSecondary}
              value={elderPassword}
              onChangeText={setElderPassword}
              secureTextEntry
            />

            <Text style={[styles.helperText, { color: theme.textSecondary, fontSize: 12, marginTop: -10, marginBottom: 15 }]}>
              Note: Password is optional. If left empty, a default password will be generated. The elder does not need to login.
            </Text>

            <TouchableOpacity 
              style={[styles.connectButton, { backgroundColor: theme.primary }]}
              onPress={createElderAccount}
              disabled={isCreating}
            >
              {isCreating ? (
                <ActivityIndicator color={theme.card} />
              ) : (
                <Text style={[styles.buttonText, { color: theme.card }]}>CREATE & CONNECT</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Connected Elders Section */}
      <View style={[styles.section, { backgroundColor: theme.card }]}>
        <Text style={[styles.sectionTitle, { color: theme.secondary }]}>
          Connected Elders ({connectedElders.length})
        </Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.text }]}>Loading connections...</Text>
          </View>
        ) : connectedElders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={50} color={theme.textSecondary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No connected elders yet
            </Text>
            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
              Connect to an elder using their phone number above
            </Text>
          </View>
        ) : (
          <FlatList
            data={connectedElders}
            keyExtractor={(item, index) => item.userId || `elder-${index}`}
            renderItem={({ item }) => (
              <View style={[styles.elderCard, { borderColor: theme.border }]}>
                <View style={styles.elderInfo}>
                  <Image 
                    source={item.profileImage ? { uri: item.profileImage } : require('@/assets/images/profile.png')} 
                    style={styles.elderImage} 
                  />
                  <View style={styles.elderDetails}>
                    <Text style={[styles.elderName, { color: theme.text }]}>{item.name}</Text>
                    <Text style={[styles.elderPhone, { color: theme.textSecondary }]}>{item.contactNumber}</Text>
                    <Text style={[styles.elderEmail, { color: theme.textSecondary }]}>{item.email}</Text>
                    <Text style={[styles.elderId, { color: theme.primary, fontSize: 12 }]}>
                      ID: {item.userId || 'N/A'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.elderActions}>
                  <View style={styles.actionRow}>
                    <TouchableOpacity 
                      style={[styles.actionButton, { backgroundColor: theme.secondary }]}
                      onPress={() => {
                        console.log('Details button pressed for elder:', item.name);
                        showElderDetails(item);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="information-circle" size={16} color={theme.card} />
                      <Text style={[styles.actionText, { color: theme.card }]}>Details</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={[styles.actionButton, { backgroundColor: theme.primary }]}
                      onPress={() => {
                        console.log('Monitor button pressed for elder:', item.name);
                        const elderId = item.userId || item._id || item.id;
                        console.log('Elder ID for monitor:', elderId);
                        selectElder(elderId, item.name);
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="eye" size={16} color={theme.card} />
                      <Text style={[styles.actionText, { color: theme.card }]}>Monitor</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableOpacity 
                    style={[styles.removeButton, { backgroundColor: theme.error }]}
                                          onPress={() => {
                        console.log('Remove button pressed for elder:', item.name);
                        const elderId = item.userId || item._id || item.id;
                        console.log('Elder ID for remove:', elderId);
                        removeElder(elderId);
                      }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={16} color={theme.card} />
                    <Text style={[styles.actionText, { color: theme.card }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            scrollEnabled={false}
          />
        )}
      </View>
    </View>
  );
}

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
  section: {
    marginTop: 20,
    padding: 20,
    borderRadius: 15,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  helperText: {
    fontSize: 14,
    marginBottom: 15,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 55,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    marginBottom: 15,
    fontSize: 16,
  },
  connectButton: {
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 30,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 5,
  },
  elderCard: {
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  elderInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  elderImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  elderDetails: {
    flex: 1,
  },
  elderName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  elderPhone: {
    fontSize: 14,
    marginBottom: 2,
  },
  elderEmail: {
    fontSize: 12,
  },
  elderId: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  elderActions: {
    flexDirection: 'column',
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 4,
    justifyContent: 'center',
  },
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 20,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
