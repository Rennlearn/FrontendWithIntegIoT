import { useState, useCallback } from 'react';
import { notificationService, NotificationData, TestAlarmData } from '@/services/notificationService';

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [currentNotification, setCurrentNotification] = useState<NotificationData | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showTestAlarm = useCallback(async (data: TestAlarmData = {}) => {
    try {
      setIsLoading(true);
      setError(null);

      let notification: NotificationData;
      try {
        notification = await notificationService.createTestAlarm(data);
      } catch (backendError) {
        console.warn('Backend unavailable, using local notification:', backendError);
        notification = notificationService.createLocalTestNotification(data);
      }

      setCurrentNotification(notification);
      setIsModalVisible(true);
    } catch (error) {
      console.error('Error showing test alarm:', error);
      setError('Failed to create test alarm');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const showNotification = useCallback((notification: NotificationData) => {
    setCurrentNotification(notification);
    setIsModalVisible(true);
  }, []);

  const closeNotification = useCallback(() => {
    setIsModalVisible(false);
    setCurrentNotification(null);
  }, []);

  const dismissNotification = useCallback(async (notificationId: string) => {
    try {
      await notificationService.dismissNotification(notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
    } catch (error) {
      console.error('Error dismissing notification:', error);
    }
  }, []);

  const fetchNotifications = useCallback(async (userId?: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedNotifications = await notificationService.getNotifications(userId);
      setNotifications(fetchedNotifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setError('Failed to fetch notifications');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchUpcomingReminders = useCallback(async (userId?: string, hours: number = 24) => {
    try {
      setIsLoading(true);
      setError(null);
      const reminders = await notificationService.getUpcomingReminders(userId, hours);
      return reminders;
    } catch (error) {
      console.error('Error fetching upcoming reminders:', error);
      setError('Failed to fetch upcoming reminders');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    notifications,
    currentNotification,
    isModalVisible,
    isLoading,
    error,
    showTestAlarm,
    showNotification,
    closeNotification,
    dismissNotification,
    fetchNotifications,
    fetchUpcomingReminders,
    hasNotifications: notifications.length > 0,
    hasCurrentNotification: currentNotification !== null,
  };
};




