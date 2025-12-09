import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = 'https://pillnow-database.onrender.com/api';

// Interface for API responses
interface CurrentUserResponse {
  userId: string;
  role: number;
  message: string;
}

interface SelectedElderResponse {
  selectedElderId: string | null;
}

interface LatestScheduleIdResponse {
  latestScheduleId: number;
}

interface ScheduleDataResponse {
  schedules: any[];
  containerSchedules: Record<number, { pill: string | null, alarms: Date[] }>;
}

interface RefreshResponse {
  message: string;
  timestamp: string;
}

class MonitorService {
  // Get authorization header with token
  private async getAuthHeaders(): Promise<HeadersInit> {
    const token = await AsyncStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'If-Modified-Since': '0'
    };
  }

  // Get current user ID and validate Elder role
  async getCurrentUserId(): Promise<number> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/monitor/current-user`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get current user');
      }

      const data: CurrentUserResponse = await response.json();
      return parseInt(data.userId);
    } catch (error) {
      console.error('Error getting current user ID:', error);
      throw error;
    }
  }

  // Get selected elder ID for caregivers
  async getSelectedElderId(caregiverId: string): Promise<string | null> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/monitor/selected-elder/${caregiverId}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        console.error('Error getting selected elder ID:', response.statusText);
        return null;
      }

      const data: SelectedElderResponse = await response.json();
      return data.selectedElderId;
    } catch (error) {
      console.error('Error getting selected elder ID:', error);
      return null;
    }
  }

  // Get latest schedule ID
  async getLatestScheduleId(): Promise<number> {
    try {
      const headers = await this.getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/monitor/latest-schedule-id`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        console.error('Error getting latest schedule ID:', response.statusText);
        return 0;
      }

      const data: LatestScheduleIdResponse = await response.json();
      return data.latestScheduleId;
    } catch (error) {
      console.error('Error getting latest schedule ID:', error);
      return 0;
    }
  }

  // Load schedule data with processing
  async loadScheduleData(userId: number, selectedElderId?: string): Promise<{
    schedules: any[];
    containerSchedules: Record<number, { pill: string | null, alarms: Date[] }>;
  }> {
    try {
      const headers = await this.getAuthHeaders();
      const queryParams = selectedElderId ? `?selectedElderId=${selectedElderId}` : '';
      
      const response = await fetch(`${API_BASE_URL}/monitor/schedule-data/${userId}${queryParams}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to load schedule data');
      }

      const data: ScheduleDataResponse = await response.json();
      return {
        schedules: data.schedules,
        containerSchedules: data.containerSchedules
      };
    } catch (error) {
      console.error('Error loading schedule data:', error);
      throw error;
    }
  }

  // Refresh schedule data
  async refreshScheduleData(userId: number, selectedElderId?: string): Promise<RefreshResponse> {
    try {
      const headers = await this.getAuthHeaders();
      const body = selectedElderId ? { selectedElderId } : {};
      
      const response = await fetch(`${API_BASE_URL}/monitor/refresh-schedule-data/${userId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to refresh schedule data');
      }

      const data: RefreshResponse = await response.json();
      return data;
    } catch (error) {
      console.error('Error refreshing schedule data:', error);
      throw error;
    }
  }
}

export default new MonitorService();
