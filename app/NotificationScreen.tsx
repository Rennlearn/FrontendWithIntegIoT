import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

const BACKEND_URL = 'http://10.56.196.91:5001';
const API_BASE_URL = 'https://pillnow-database.onrender.com/api';

interface DecodedToken {
  id: string;
  userId?: string;
  role?: string;
}

interface Notification {
  id: string;
  type: 'verification' | 'schedule' | 'medication_reminder' | 'schedule_update' | 'status_change';
  scheduleType?: string;
  container: string | number;
  title: string;
  message: string;
  timestamp: string;
  scheduleId?: string;
  medicationName?: string;
  status?: string;
  date?: string;
  time?: string;
  changes?: {
    countChanged?: boolean;
    countDiff?: number;
    beforeCount?: number;
    afterCount?: number;
    pillsChanged?: Array<{ type: string; before: number; after: number; change: number }>;
    typesChanged?: boolean;
  };
  beforeImage?: string;
  afterImage?: string;
  read?: boolean;
}

export default function NotificationScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Get current user ID from JWT token
  const getCurrentUserId = useCallback(async (): Promise<number | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const rawId = decodedToken.userId ?? decodedToken.id;
      const userId = parseInt(rawId);
      return isNaN(userId) ? null : userId;
    } catch (error) {
      console.error('Error getting user ID:', error);
      return null;
    }
  }, []);

  // Get auth headers
  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await AsyncStorage.getItem('token');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token.trim()}`;
    }
    return headers;
  }, []);

  // Load medication schedule notifications
  const loadScheduleNotifications = useCallback(async (userId: number): Promise<Notification[]> => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/medication_schedules/notifications/pending`, {
        headers
      });
      
      if (!response.ok) {
        console.warn('Failed to load schedule notifications:', response.status);
        return [];
      }

      const data = await response.json();
      const schedules = data.schedules || data.data || [];
      
      // Transform schedules into notifications
      const scheduleNotifications: Notification[] = schedules.map((schedule: any) => {
        const scheduleDate = new Date(`${schedule.date}T${schedule.time}`);
        const now = new Date();
        const timeDiff = scheduleDate.getTime() - now.getTime();
        const minutesUntil = Math.floor(timeDiff / 60000);
        
        let title = '💊 Medication Reminder';
        let message = `Time to take medication from Container ${schedule.container}`;
        
        if (schedule.medicationName) {
          message = `Time to take ${schedule.medicationName} from Container ${schedule.container}`;
        }
        
        if (minutesUntil > 0 && minutesUntil <= 60) {
          title = `⏰ Upcoming: ${schedule.medicationName || 'Medication'}`;
          message = `${schedule.medicationName || 'Medication'} in Container ${schedule.container} at ${schedule.time}`;
        } else if (minutesUntil <= 0 && minutesUntil >= -30) {
          title = '💊 Medication Due Now';
          message = `${schedule.medicationName || 'Medication'} from Container ${schedule.container} is due now`;
        }

        return {
          id: `schedule_${schedule._id || schedule.scheduleId}`,
          type: 'medication_reminder' as const,
          container: schedule.container,
          title,
          message,
          timestamp: scheduleDate.toISOString(),
          scheduleId: schedule._id || schedule.scheduleId?.toString(),
          medicationName: schedule.medicationName,
          status: schedule.status,
          date: schedule.date,
          time: schedule.time,
          read: schedule.alertSent || false,
        };
      });

      return scheduleNotifications;
    } catch (error) {
      console.error('Error loading schedule notifications:', error);
      return [];
    }
  }, [getAuthHeaders]);

  // Load verification notifications from IoT backend
  const loadVerificationNotifications = useCallback(async (): Promise<Notification[]> => {
    try {
      const response = await fetch(`${BACKEND_URL}/notifications`);
      if (response.ok) {
        const data = await response.json();
        const verificationNotifs = (data.notifications || []).map((notif: any) => ({
          ...notif,
          type: notif.type === 'schedule' ? 'schedule_update' : 'verification',
        }));
        return verificationNotifs;
      }
      return [];
    } catch (error) {
      console.error('Error loading verification notifications:', error);
      return [];
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const userId = await getCurrentUserId();
      
      // Load both types of notifications
      const [scheduleNotifs, verificationNotifs] = await Promise.all([
        userId ? loadScheduleNotifications(userId) : [],
        loadVerificationNotifications(),
      ]);

      // Combine and sort by timestamp (newest first)
      const allNotifications = [...scheduleNotifs, ...verificationNotifs].sort((a, b) => {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      setNotifications(allNotifications);
    } catch (error) {
      console.error('Error loading notifications:', error);
      Alert.alert('Error', 'Failed to load notifications. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getCurrentUserId, loadScheduleNotifications, loadVerificationNotifications]);

  useEffect(() => {
    loadNotifications();
    // Refresh every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const markNotificationAsRead = useCallback(async (notification: Notification) => {
    try {
      // If it's a schedule notification, mark alert as sent
      if (notification.type === 'medication_reminder' && notification.scheduleId) {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/medication_schedules/notifications/mark-sent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            scheduleId: notification.scheduleId,
          }),
        });
        
        if (response.ok) {
          console.log('Marked schedule notification as sent');
        }
      } else {
        // For verification notifications, delete from IoT backend
        const response = await fetch(`${BACKEND_URL}/notifications/${notification.id}`, {
          method: 'DELETE'
        });
        if (!response.ok) {
          console.warn('Failed to delete notification:', response.status);
        }
      }
      
      // Remove from local state
      setNotifications((prev) => prev.filter((notif) => notif.id !== notification.id));
    } catch (error) {
      console.error('Error marking notification as read:', error);
      // Remove from local state anyway
      setNotifications((prev) => prev.filter((notif) => notif.id !== notification.id));
    }
  }, [getAuthHeaders]);

  const removeNotification = useCallback(async (id: string) => {
    const notification = notifications.find(n => n.id === id);
    if (notification) {
      await markNotificationAsRead(notification);
    } else {
      setNotifications((prev) => prev.filter((notif) => notif.id !== id));
    }
  }, [notifications, markNotificationAsRead]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadNotifications();
  }, [loadNotifications]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary }]}>
          ALERTS AND <Text style={[styles.highlight, { color: theme.primary }]}>NOTIFICATIONS</Text>
        </Text>
      </View>

      {/* Bell Icon */}
      <View style={[styles.bellContainer, { backgroundColor: theme.card }]}>
        <Image source={require('@/assets/images/bell.png')} style={styles.bellIcon} />
      </View>

      {/* Notification List */}
      {loading && notifications.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.textSecondary }]}>Loading notifications...</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isUnread = !item.read;
            const notificationDate = new Date(item.timestamp);
            const timeAgo = getTimeAgo(notificationDate);
            
            return (
              <View style={[
                styles.notificationCard, 
                { 
                  backgroundColor: theme.card,
                  borderLeftWidth: isUnread ? 4 : 0,
                  borderLeftColor: isUnread ? theme.primary : 'transparent',
                }
              ]}>
                <View style={styles.notificationContent}>
                  <View style={styles.iconContainer}>
                    <Ionicons 
                      name={getNotificationIcon(item.type)} 
                      size={24} 
                      color={getNotificationColor(item.type, theme)} 
                    />
                  </View>
                  <View style={styles.textContainer}>
                    <View style={styles.notificationHeader}>
                      <Text style={[styles.notificationTitle, { color: theme.text }]}>
                        {item.title}
                      </Text>
                      {isUnread && (
                        <View style={[styles.unreadBadge, { backgroundColor: theme.primary }]} />
                      )}
                    </View>
                    <Text style={[styles.notificationMessage, { color: theme.textSecondary }]}>
                      {item.message}
                    </Text>
                    {item.time && (
                      <View style={styles.notificationMeta}>
                        <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                        <Text style={[styles.notificationTime, { color: theme.textSecondary }]}>
                          {item.date} at {item.time} • {timeAgo}
                        </Text>
                      </View>
                    )}
                    {item.container && (
                      <View style={styles.containerBadge}>
                        <Ionicons name="cube-outline" size={12} color={theme.primary} />
                        <Text style={[styles.containerText, { color: theme.primary }]}>
                          Container {item.container}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={() => removeNotification(item.id)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={20} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            );
          }}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="notifications-off-outline" size={64} color={theme.textSecondary} />
              <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
                No notifications available
              </Text>
              <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                You're all caught up!
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  header: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
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
    flex: 1,
  },
  highlight: {
    color: '#4A90E2',
  },
  bellContainer: {
    alignItems: 'center',
    marginTop: 120,
    marginBottom: 20,
    padding: 20,
    borderRadius: 15,
    elevation: 5,
  },
  bellIcon: {
    width: 80,
    height: 80,
  },
  listContainer: {
    paddingBottom: 20,
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    elevation: 2,
  },
  textContainer: {
    flex: 1,
    marginRight: 10,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  notificationMessage: {
    fontSize: 12,
    marginTop: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyMessage: {
    textAlign: 'center',
    fontSize: 16,
    marginTop: 20,
    fontWeight: '600',
  },
  emptySubtext: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 8,
    paddingHorizontal: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  notificationTime: {
    fontSize: 11,
  },
  changesContainer: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    gap: 6,
  },
  changeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  changeText: {
    fontSize: 12,
    flex: 1,
  },
  containerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  containerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  closeButton: {
    padding: 5,
  },
  notificationContent: {
    flexDirection: 'row',
    flex: 1,
  },
  iconContainer: {
    marginRight: 12,
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  unreadBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  notificationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
});

// Helper functions
function getNotificationIcon(type: string): string {
  switch (type) {
    case 'medication_reminder':
      return 'medical';
    case 'schedule_update':
      return 'calendar';
    case 'status_change':
      return 'checkmark-circle';
    case 'verification':
      return 'camera';
    default:
      return 'notifications';
  }
}

function getNotificationColor(type: string, theme: any): string {
  switch (type) {
    case 'medication_reminder':
      return theme.primary;
    case 'schedule_update':
      return theme.secondary;
    case 'status_change':
      return theme.success;
    case 'verification':
      return theme.warning;
    default:
      return theme.textSecondary;
  }
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}