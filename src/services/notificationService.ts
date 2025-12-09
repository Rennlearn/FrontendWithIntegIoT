import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NotificationData {
  id: string;
  type: 'medication' | 'test_alarm' | 'reminder';
  title: string;
  message: string;
  medicineName?: string;
  containerId?: number;
  scheduledTime?: string;
  isTest?: boolean;
  createdAt: string;
}

export interface TestAlarmData {
  medicationName?: string;
  containerId?: number;
  scheduledTime?: string;
}

class NotificationService {
  private baseUrl = 'https://pillnow-database.onrender.com/api/notifications';

  private async getAuthHeaders() {
    const token = await AsyncStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    } as Record<string, string>;
  }

  async createTestAlarm(data: TestAlarmData = {}): Promise<NotificationData> {
    try {
      const response = await fetch(`${this.baseUrl}/test-alarm`, {
        method: 'POST',
        headers: await this.getAuthHeaders(),
        body: JSON.stringify({
          medicationName: data.medicationName || 'Losartan',
          containerId: data.containerId || 1,
          scheduledTime: data.scheduledTime || '08:00 AM'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.notification as NotificationData;
    } catch (error) {
      console.error('Error creating test alarm:', error);
      throw error;
    }
  }

  async getNotifications(userId?: string): Promise<NotificationData[]> {
    try {
      const url = userId ? `${this.baseUrl}?userId=${userId}` : this.baseUrl;
      const response = await fetch(url, {
        method: 'GET',
        headers: await this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return (result.notifications || []) as NotificationData[];
    } catch (error) {
      console.error('Error fetching notifications:', error);
      throw error;
    }
  }

  async dismissNotification(notificationId: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/${notificationId}/dismiss`, {
        method: 'PUT',
        headers: await this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await response.json();
    } catch (error) {
      console.error('Error dismissing notification:', error);
      throw error;
    }
  }

  async getUpcomingReminders(userId?: string, hours: number = 24): Promise<any[]> {
    try {
      const params = new URLSearchParams();
      if (userId) params.append('userId', userId);
      params.append('hours', hours.toString());

      const response = await fetch(`${this.baseUrl}/upcoming?${params}`, {
        method: 'GET',
        headers: await this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.upcomingReminders || [];
    } catch (error) {
      console.error('Error fetching upcoming reminders:', error);
      throw error;
    }
  }

  createLocalTestNotification(data: TestAlarmData = {}): NotificationData {
    return {
      id: `local_test_${Date.now()}`,
      type: 'test_alarm',
      title: `Test Alarm: ${data.medicationName || 'Losartan'}`,
      message: `Test notification for ${data.medicationName || 'Losartan'} in container ${data.containerId || 1}`,
      medicineName: data.medicationName || 'Losartan',
      containerId: data.containerId || 1,
      scheduledTime: data.scheduledTime || '08:00 AM',
      isTest: true,
      createdAt: new Date().toISOString()
    } as NotificationData;
  }
}

export const notificationService = new NotificationService();


