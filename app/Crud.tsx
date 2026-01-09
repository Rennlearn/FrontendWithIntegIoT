import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, FlatList, Alert, TouchableOpacity, TextInput, Modal, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { RefreshCcw, Edit, Trash2, Search, User } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { jwtDecode } from 'jwt-decode';

// Define the navigation type
type RootStackParamList = {
  LoginScreen: undefined;
  Roles: undefined;
};

type NavigationProp = StackNavigationProp<RootStackParamList>;

interface DecodedToken {
  id: string;
}

interface UserData {
  id: string;
  fullname: string;
  username: string;
  type_id?: number | string;
  created_at: string;
  updated_at: string;
}

export default function UserListScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [newFullname, setNewFullname] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newTypeId, setNewTypeId] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserData | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let token = await AsyncStorage.getItem('token');
      if (!token) {
        Alert.alert('Error', 'No authentication token found. Please log in.');
        console.error('No token found.');
        return;
      }

      const response = await fetch('https://devapi-618v.onrender.com/api/user', {
        method: 'GET',
        headers: {
          Authorization: token,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.status}`);
      }

      const data = await response.json();
      setUsers(data);
      setFilteredUsers(data);
    } catch (error: unknown) {
      setError(error);
      const message = error instanceof Error ? error.message : 'Failed to fetch users. Please try again.';
      Alert.alert('Error', message);
      console.error('Fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredUsers(users);
    } else {
      const filtered = users.filter((user: UserData) => 
        user.fullname.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.username.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredUsers(filtered);
    }
  }, [searchQuery, users]);

  const prepareUpdateForm = (user: UserData) => {
    setSelectedUser(user);
    setNewFullname(user.fullname || '');
    setNewUsername(user.username || '');
    setNewPassword('');
    setNewTypeId(user.type_id ? user.type_id.toString() : '');
    setModalVisible(true);
  };

  const userInfo = (user: UserData) => {
    setSelectedUser(user);
    setInfoModalVisible(true);
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) {
      Alert.alert('Error', 'No user selected.');
      return;
    }

    if (!newFullname.trim()) {
      Alert.alert('Error', 'Please enter a valid name.');
      return;
    }

    let token = await AsyncStorage.getItem('token');
    if (!token) {
      Alert.alert('Error', 'No authentication token found. Please log in.');
      return;
    }

    const updateData = {
      fullname: newFullname.trim(),
      username: newUsername.trim() || selectedUser.username,
      ...(newPassword.trim() ? { password: newPassword.trim() } : {}),
      type_id: newTypeId ? parseInt(newTypeId) : selectedUser.type_id,
    };

    try {
      const response = await fetch(`https://devapi-618v.onrender.com/api/user/${selectedUser.id}`, {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      });

      if (response.ok) {
        Alert.alert('Success', 'User updated successfully!');
        setModalVisible(false);
        fetchUsers();
      } else {
        throw new Error(`Server error: ${response.status}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update user. Please try again.';
      console.error('Update error:', error);
      Alert.alert('Error', message);
    }
  };

  const handleDeleteUser = async (id: string | number) => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this user?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              let token = await AsyncStorage.getItem('token');
              if (!token) {
                Alert.alert('Error', 'No authentication token found. Please log in.');
                return;
              }
  
              const response = await axios.delete(`https://devapi-618v.onrender.com/api/user/${id}`, {
                headers: { Authorization: token },
              });
  
              if (response.status === 200) {
                Alert.alert('Success', 'User deleted successfully!');
                fetchUsers(); // Refresh user list
              }
            } catch (error) {
              Alert.alert('Error', 'Failed to delete user.');
              console.error('Delete error:', error);
            }
          },
        },
      ],
      { cancelable: false }
    );
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('token');
      navigation.replace('LoginScreen');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const fetchCurrentUser = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.warn('No token found');
        return;
      }

      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const userId = decodedToken.id;

      const response = await fetch(`https://devapi-618v.onrender.com/api/user/${userId}`, {
        method: 'GET',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data);
      } else {
        console.error('Failed to fetch user data');
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.navigate('Roles')}
        >
          <Ionicons name="arrow-back" size={24} color="#D14A99" />
        </TouchableOpacity>
        <Text style={styles.headerText}>User Management</Text>
        <TouchableOpacity 
          style={styles.profileButton} 
          onPress={() => setProfileModalVisible(true)}
        >
          <User size={24} {...({ color: '#D14A99' } as any)} />
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={20} style={styles.searchIcon} {...({ color: '#666' } as any)} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#666"
          />
        </View>
      </View>

      {/* User Listings */}
      <View style={styles.userListContainer}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#4A90E2" />
        ) : error ? (
          <View style={styles.retryContainer}>
            <Text style={styles.errorText}>Failed to load users.</Text>
            <TouchableOpacity onPress={fetchUsers} style={styles.retryButton}>
              <RefreshCcw size={18} {...({ color: '#fff' } as any)} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            showsVerticalScrollIndicator={false}
            data={filteredUsers}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <View style={styles.userCard}>
                <Text style={styles.userName}>{item.fullname}</Text>
                <Text style={styles.userDetails}>@{item.username}</Text>
                <Text style={styles.userCreated}>Joined: {new Date(item.created_at).toLocaleDateString()}</Text>

                {/* Action Buttons */}
                <View style={styles.actionButtonsContainer}>
                  <TouchableOpacity 
                    style={styles.menuButton}
                    onPress={() => {
                      Alert.alert(
                        'User Actions',
                        'Choose an action',
                        [
                          {
                            text: 'Delete',
                            onPress: () => handleDeleteUser(item.id),
                            style: 'destructive'
                          },
                          {
                            text: 'Update',
                            onPress: () => prepareUpdateForm(item)
                          },
                          {
                            text: 'Info',
                            onPress: () => userInfo(item)
                          },
                          {
                            text: 'Cancel',
                            style: 'cancel'
                          }
                        ]
                      );
                    }}
                  >
                    <Ionicons name="ellipsis-vertical" size={24} color="#666" />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* Update User Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeaderText}>Update User</Text>
            <TextInput style={styles.input} placeholder="Full Name" value={newFullname} onChangeText={setNewFullname} />
            <TextInput style={styles.input} placeholder="Username" value={newUsername} onChangeText={setNewUsername} />
            <TextInput style={styles.input} placeholder="Password" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
            <TextInput style={styles.inputUserType} placeholder="User Type" value={newTypeId} onChangeText={setNewTypeId} keyboardType="numeric" />
            <TouchableOpacity onPress={handleUpdateUser} style={styles.saveButton}>
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* User Info Modal */}
      <Modal visible={infoModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeaderText}>User Details</Text>
            <Text>ID: {selectedUser?.id}</Text>
            <Text>Fullname: {selectedUser?.fullname}</Text>
            <Text>Username: {selectedUser?.username}</Text>
            <Text>Created At: {new Date(selectedUser?.created_at || 0).toLocaleString()}</Text>
            <Text>Updated At: {new Date(selectedUser?.updated_at || 0).toLocaleString()}</Text>
            <TouchableOpacity onPress={() => setInfoModalVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Profile Modal */}
      <Modal visible={profileModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalHeaderText}>My Profile</Text>
            {currentUser ? (
              <>
                <Text style={styles.profileText}>Full Name: {currentUser.fullname}</Text>
                <Text style={styles.profileText}>Username: {currentUser.username}</Text>
                <Text style={styles.profileText}>Member Since: {new Date(currentUser.created_at).toLocaleDateString()}</Text>
                <Text style={styles.profileText}>Last Updated: {new Date(currentUser.updated_at).toLocaleDateString()}</Text>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                  <Text style={styles.logoutButtonText}>Logout</Text>
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.errorText}>Loading profile...</Text>
            )}
            <TouchableOpacity onPress={() => setProfileModalVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 20,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 40,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    paddingVertical: 15,
    marginBottom: 20,
    elevation: 8,
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    left: 15,
    padding: 8,
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#D14A99',
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  userListContainer: {
    flex: 1,
    marginTop: 10,
  },
  retryContainer: {
    alignItems: 'center',
  },
  errorText: {
    color: '#D14A99',
    marginBottom: 8,
    fontSize: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4A90E2',
    padding: 10,
    borderRadius: 15,
  },
  retryText: {
    color: '#FFFFFF',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: 'bold',
  },
  userCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 15,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    elevation: 3,
    position: 'relative',
  },
  userName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#D14A99',
    marginBottom: 8,
    marginRight: 120,
  },
  userDetails: {
    color: '#4A90E2',
    fontSize: 16,
    marginBottom: 4,
    fontWeight: '500',
  },
  userCreated: {
    color: '#666',
    fontSize: 14,
    fontStyle: 'italic',
    marginBottom: 12,
  },
  actionButtonsContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
  },
  menuButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 15,
    width: '90%',
  },
  modalHeaderText: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
    color: '#D14A99',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E4E7EB',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
    color: '#000',
  },
  inputUserType: {
    borderWidth: 1,
    borderColor: '#E4E7EB',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    fontSize: 16,
    backgroundColor: '#FAFAFA',
    color: '#000',
  },
  saveButton: {
    backgroundColor: '#4A90E2',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#D14A99',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  closeButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
  searchContainer: {
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 15,
    height: 50,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
  },
  profileButton: {
    position: 'absolute',
    right: 15,
    padding: 8,
  },
  profileText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 10,
  },
  logoutButton: {
    backgroundColor: '#FF4444',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});