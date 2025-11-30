import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';

const BACKEND_URL = 'http://10.56.196.91:5001';

interface Notification {
  id: string;
  type: 'verification' | 'schedule';
  scheduleType?: string;
  container: string;
  title: string;
  message: string;
  timestamp: string;
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
}

export default function NotificationScreen() {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/notifications`);
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
      } else {
        console.error('Failed to load notifications:', response.status);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    // Refresh every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const removeNotification = useCallback(async (id: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/notifications/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setNotifications((prev) => prev.filter((notif) => notif.id !== id));
      } else {
        // If delete fails, just remove from local state
        setNotifications((prev) => prev.filter((notif) => notif.id !== id));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      // Remove from local state anyway
      setNotifications((prev) => prev.filter((notif) => notif.id !== id));
    }
  }, []);

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
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.notificationCard, { backgroundColor: theme.card }]}>
            <View style={styles.textContainer}>
              <Text style={[styles.notificationTitle, { color: theme.text }]}>{item.title}</Text>
              <Text style={[styles.notificationMessage, { color: theme.textSecondary }]}>{item.message}</Text>
            </View>
            <TouchableOpacity onPress={() => removeNotification(item.id)}>
              <Ionicons name="close" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={[styles.emptyMessage, { color: theme.textSecondary }]}>
            No notifications available
          </Text>
        }
      />
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
});