/**
 * Verification Service for ESP32-CAM pill verification
 * Handles communication with the local backend for pill verification
 */

// Backend URL - update this if your backend IP changes
// For development: use your Mac's IP address
// For production: use your deployed backend URL
const BACKEND_URL = 'http://10.177.65.91:5001'; // Local backend URL

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
   * @param containerId - Container identifier (morning, noon, evening)
   * @param pillConfig - Expected pill configuration with count
   * @returns Promise with success status
   */
  async triggerCapture(containerId: string, pillConfig: { count?: number }): Promise<{ ok: boolean; message: string }> {
    try {
      console.log(`[VerificationService] Triggering capture for ${containerId} with config:`, pillConfig);
      console.log(`[VerificationService] Backend URL: ${BACKEND_URL}`);
      
      const response = await fetch(`${BACKEND_URL}/set-schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          container_id: containerId,
          pill_config: pillConfig,
          times: [], // Not needed for verification trigger
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[VerificationService] Backend error (${response.status}):`, errorText);
        throw new Error(`Backend returned ${response.status}: ${errorText || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log(`[VerificationService] Capture triggered successfully:`, data);
      return { ok: data.ok || false, message: data.message || 'Capture triggered' };
    } catch (error) {
      console.error('[VerificationService] Error triggering capture:', error);
      
      // Provide more helpful error messages
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Cannot connect to backend at ${BACKEND_URL}. Make sure your backend server is running.`);
      }
      
      throw new Error(`Failed to trigger capture: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get latest verification result for a container
   * @param containerId - Container identifier (morning, noon, evening)
   * @returns Promise with verification result
   */
  async getVerificationResult(containerId: string): Promise<VerificationResult> {
    try {
      const response = await fetch(`${BACKEND_URL}/containers/${containerId}/verification`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, message: 'No verification found' };
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data as VerificationResult;
    } catch (error) {
      console.error('Error fetching verification result:', error);
      return { 
        success: false, 
        message: `Failed to fetch verification: ${error instanceof Error ? error.message : 'Unknown error'}` 
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
}

export default new VerificationService();

