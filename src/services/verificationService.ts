/**
 * Verification Service for ESP32-CAM pill verification
 * Handles communication with the local backend for pill verification
 */

// Backend URL is centralized in src/config.ts to provide a safe fallback when
// EXPO_PUBLIC_BACKEND_URL is not set on the device. This prevents capture
// triggers from silently failing when the env var is missing.
import { BACKEND_URL } from '@/config';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Basic validation and a helpful log to aid debugging on devices/emulators
if (!BACKEND_URL || !/^https?:\/\//.test(BACKEND_URL)) {
  // eslint-disable-next-line no-console
  console.warn(`[VerificationService] WARNING: BACKEND_URL may be invalid or missing: ${BACKEND_URL}`);
}



export interface VerificationResult {
  success: boolean;
  deviceId?: string;
  container?: string;
  expected?: any;
  result?: {
    pass_: boolean;
    count: number;
    classesDetected: Array<{ label: string; n: number }>;
    confidence: number;
  };
  timestamp?: string;
  message?: string;
}

class VerificationService {
  /**
   * Trigger ESP32-CAM capture for a container
   * @param containerId - Container identifier (container1, container2, container3)
   * @param pillConfig - Expected pill configuration with count AND optional label
   * @returns Promise with success status
   */
  async getBackendUrl(): Promise<string> {
    try {
      const override = await AsyncStorage.getItem('backend_url_override');
      if (override && String(override).trim()) return String(override).trim();
    } catch (e) {
      // ignore and fallback
    }
    return BACKEND_URL;
  }

  async triggerCapture(containerId: string, pillConfig: { count?: number; label?: string }, retryCount: number = 0): Promise<{ ok: boolean; message: string }> {
    const maxRetries = 2;
    const retryDelay = 2000; // 2 seconds
    
    try {
      const base = await this.getBackendUrl();
      console.log(`[VerificationService] Triggering capture for ${containerId}${retryCount > 0 ? ` (retry ${retryCount}/${maxRetries})` : ''}`);
      console.log(`[VerificationService] Expected config: count=${pillConfig.count || 0}, label=${pillConfig.label || 'none'}`);
      console.log(`[VerificationService] Using endpoint: ${base}/trigger-capture/${containerId}`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      // Use the dedicated trigger-capture endpoint
      // Send pill config in request body so backend can use it if not in memory
      // IMPORTANT: Include both count AND label for proper verification
      const response = await fetch(`${base}/trigger-capture/${containerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expected: pillConfig }), // Send full pill config (count + label)
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Backend error: ${response.status} - ${errorText}`;
        
        // Handle rate limiting (429) with retry logic
        if (response.status === 429) {
          if (retryCount < maxRetries) {
            const retryAfter = response.headers.get('Retry-After') || retryDelay / 1000;
            console.warn(`[VerificationService] Rate limited (429), retrying in ${retryAfter}s... (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1))); // Exponential backoff
            return this.triggerCapture(containerId, pillConfig, retryCount + 1);
          } else {
            errorMessage = `Too many requests. Please wait a moment before trying again.`;
            console.error(`[VerificationService] Rate limited (429) after ${maxRetries} retries`);
          }
        } else {
          // Append response status for better diagnostics
          errorMessage = `${errorMessage} (status: ${response.status})`;
          console.error(`[VerificationService] Backend error (${response.status}):`, errorText);
          console.warn(`[VerificationService] Diagnostic: Check BACKEND_URL (${await this.getBackendUrl()}) and network connectivity`);
        }
        
        return { ok: false, message: errorMessage };
      }

      const data = await response.json();
      console.log(`[VerificationService] Capture triggered successfully:`, data);
      return { ok: data.ok || false, message: data.message || 'Capture triggered' };
    } catch (error) {
      // Handle network errors gracefully - don't throw, return error status
      if (error instanceof TypeError) {
        if (error.message.includes('fetch') || error.message.includes('Network request failed') || error.message.includes('Failed to fetch')) {
          console.warn(`[VerificationService] Network error - backend unreachable at ${BACKEND_URL}`);
          return { 
            ok: false, 
            message: 'Backend unreachable. ESP32-CAM verification may still work via MQTT.' 
          };
        }
      }
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[VerificationService] Request timed out');
        return { ok: false, message: 'Request timed out' };
      }
      
      console.warn('[VerificationService] Error triggering capture:', error);
      return { 
        ok: false, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get latest verification result for a container
   * @param containerId - Container identifier (container1, container2, container3)
   * @returns Promise with verification result
   */
  async getVerificationResult(containerId: string): Promise<VerificationResult> {
    try {
      console.log(`[VerificationService] Getting verification result for ${containerId}`);
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
      
      const base = await this.getBackendUrl();
      const response = await fetch(`${base}/containers/${containerId}/verification`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[VerificationService] No verification found for ${containerId}`);
          return { success: false, message: 'No verification result yet' };
        }
        const errorText = await response.text();
        console.warn(`[VerificationService] Error getting verification (${response.status}):`, errorText);
        return { success: false, message: `Backend error: ${response.status}` };
      }

      const data = await response.json();
      console.log(`[VerificationService] Verification result:`, data);
      
      // Return the full verification data
      return {
        success: true,
        deviceId: data.deviceId,
        container: data.container,
        expected: data.expected,
        result: data.result,
        timestamp: data.timestamp,
        message: data.message || 'Verification complete',
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[VerificationService] Verification request timed out');
        return { success: false, message: 'Request timed out' };
      }
      
      // Handle network errors gracefully
      if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Network'))) {
        console.warn(`[VerificationService] Backend unreachable for verification`);
        return { success: false, message: 'Backend unreachable' };
      }
      
      console.warn('[VerificationService] Error getting verification:', error);
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Map container number (1, 2, 3) to container ID (morning, noon, evening)
   */
  getContainerId(containerNum: number): string {
    const mapping: Record<number, string> = {
      1: 'container1',
      2: 'container2',
      3: 'container3',
    };
    return mapping[containerNum] || 'morning';
  }

  /**
   * Get container number from container ID
   */
  getContainerNumber(containerId: string): number {
    const mapping: Record<string, number> = {
      container1: 1,
      container2: 2,
      container3: 3,
      morning: 1,
      noon: 2,
      evening: 3,
    };
    return mapping[containerId] || 1;
  }

  /**
   * Test backend connectivity
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const base = await this.getBackendUrl();
      console.log(`[VerificationService] Testing connection to ${base}`);
      const response = await fetch(`${base}/test`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[VerificationService] Connection test successful:', data);
        return { success: true, message: 'Backend is reachable' };
      } else {
        return { success: false, message: `Backend returned status ${response.status}` };
      }
    } catch (error) {
      console.error('[VerificationService] Connection test failed:', error);
      return { 
        success: false, 
        message: `Cannot connect to ${BACKEND_URL}. Make sure:\n1. Backend is running\n2. Device is on same WiFi network\n3. No firewall blocking port 5001` 
      };
    }
  }
}

export default new VerificationService();

