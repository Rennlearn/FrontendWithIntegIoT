/* Central configuration for runtime constants */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Fallback backend URL used when EXPO_PUBLIC_BACKEND_URL is not provided.
// Update this default to match your local backend when testing on device/emulator.
// Note: If your Mac's IP changes (e.g., phone hotspot), use the backend override in Monitor screen
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.165.11.91:5001';

// Get the effective backend URL (checks for override in AsyncStorage)
export async function getBackendUrl(): Promise<string> {
  try {
    const override = await AsyncStorage.getItem('backend_url_override');
    if (override && String(override).trim()) {
      return String(override).trim();
    }
  } catch (e) {
    // ignore and fallback
  }
  return BACKEND_URL;
}

// Convenience helper for runtime connectivity checks
// Now respects backend URL override from AsyncStorage
export async function testBackendReachable(timeoutMs: number = 3000): Promise<boolean> {
  try {
    const backendUrl = await getBackendUrl();
    console.log(`[config] Testing backend reachability: ${backendUrl}/test`);
    
    // Validate URL format
    if (!backendUrl || (!backendUrl.startsWith('http://') && !backendUrl.startsWith('https://'))) {
      console.warn(`[config] Invalid backend URL format: ${backendUrl}`);
      return false;
    }
    
    // Use AbortSignal.timeout if available, otherwise fallback to AbortController
    let signal: AbortSignal;
    let timeoutId: any = null;
    
    if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
      // @ts-ignore - AbortSignal.timeout may not be in types
      signal = AbortSignal.timeout(timeoutMs);
    } else {
    const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      signal = controller.signal;
    }
    
    try {
      const res = await fetch(`${backendUrl}/test`, { 
        signal,
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        // Add cache control to prevent caching issues
        cache: 'no-store',
      });
      
      if (timeoutId) clearTimeout(timeoutId);
      
      const isReachable = res.ok;
      console.log(`[config] Backend reachability test: ${isReachable ? '✅ Reachable' : '❌ Unreachable'} (status: ${res.status})`);
      return isReachable;
    } catch (fetchError: any) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // Check if it's a network error vs timeout
      if (fetchError.name === 'AbortError' || fetchError.message?.includes('timeout')) {
        console.warn(`[config] Backend reachability test timed out after ${timeoutMs}ms for ${backendUrl}`);
      } else if (fetchError.message?.includes('Network request failed') || fetchError.message?.includes('Failed to fetch')) {
        console.warn(`[config] Backend reachability test failed: Network error (backend may be unreachable or HTTP blocked)`);
        console.warn(`[config] Troubleshooting: 1) Check backend is running, 2) Check device and Mac are on same network, 3) Check Android allows HTTP (network security config)`);
      } else if (fetchError.message?.includes('cleartext') || fetchError.message?.includes('CLEARTEXT')) {
        console.error(`[config] ⚠️ HTTP blocked by Android! Add network security config to allow cleartext traffic.`);
      } else {
        console.warn(`[config] Backend reachability test failed:`, fetchError.message || fetchError);
      }
      return false;
    }
  } catch (error: any) {
    const backendUrl = await getBackendUrl().catch(() => BACKEND_URL);
    console.warn(`[config] Backend reachability test error for ${backendUrl}:`, error?.message || error);
    return false;
  }
}

if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
  // Be verbose in dev, helps debugging missing env values on device
  // eslint-disable-next-line no-console
  console.warn(`[config] EXPO_PUBLIC_BACKEND_URL not set; falling back to ${BACKEND_URL}`);
}

export default BACKEND_URL;
