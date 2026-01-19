/* Central configuration for runtime constants */

import AsyncStorage from '@react-native-async-storage/async-storage';

// CRITICAL: Default backend URL - ALWAYS use 10.129.153.91:5001
// DO NOT use old IPs like 10.128.151.91:5001
// Fallback backend URL used when EXPO_PUBLIC_BACKEND_URL is not provided.
// Update this default to match your local backend when testing on device/emulator.
// Note: If your Mac's IP changes (e.g., phone hotspot), use the backend override in Monitor screen
const DEFAULT_BACKEND_URL = 'http://10.129.153.91:5001';
const OLD_INVALID_IPS = ['10.128.151.91', '10.165.11.91'];

// Validate that BACKEND_URL doesn't contain old IPs
let validatedBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || DEFAULT_BACKEND_URL;
if (OLD_INVALID_IPS.some(oldIP => validatedBackendUrl.includes(oldIP))) {
  console.error(`[config] 🚨 CRITICAL: BACKEND_URL contains old IP! (${validatedBackendUrl})`);
  console.error(`[config] 🚨 FORCING to use correct IP: ${DEFAULT_BACKEND_URL}`);
  validatedBackendUrl = DEFAULT_BACKEND_URL;
}

export const BACKEND_URL = validatedBackendUrl;

// Log the final BACKEND_URL on module load
console.log(`[config] ✅ BACKEND_URL initialized to: ${BACKEND_URL}`);

// Get the effective backend URL
// FORCE DEFAULT: ALWAYS use BACKEND_URL (current Mac IP: 10.129.153.91)
// IGNORES AsyncStorage overrides completely to prevent using old IPs
// This ensures the app ALWAYS connects to the correct IP address
export async function getBackendUrl(): Promise<string> {
  // CRITICAL: Always clear any AsyncStorage overrides that might contain old IPs
  // This prevents the app from ever using the old IP (10.128.151.91)
  try {
    const override = await AsyncStorage.getItem('backend_url_override');
    if (override) {
      const trimmedOverride = String(override).trim();
      const containsInvalidIP = OLD_INVALID_IPS.some(invalidIP => trimmedOverride.includes(invalidIP));
      
      if (containsInvalidIP) {
        console.warn(`[config] 🚨 Found invalid IP in override (${trimmedOverride}). Clearing immediately.`);
        await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
      }
    }
  } catch (e) {
    // Ignore errors - we'll just use the default
  }
  
  // CRITICAL: Double-check that BACKEND_URL itself doesn't contain old IPs
  if (OLD_INVALID_IPS.some(oldIP => BACKEND_URL.includes(oldIP))) {
    console.error(`[config] 🚨 CRITICAL ERROR: BACKEND_URL contains old IP! (${BACKEND_URL})`);
    console.error(`[config] 🚨 This should never happen! Using fallback: ${DEFAULT_BACKEND_URL}`);
    return DEFAULT_BACKEND_URL;
  }
  
  // ALWAYS return the default BACKEND_URL - never use AsyncStorage overrides
  // This ensures the app ALWAYS connects to http://10.129.153.91:5001
  // Only log on first call to reduce verbosity
  if (!(global as any).__getBackendUrlLogged) {
    console.log(`[config] ✅ getBackendUrl() initialized - will always return: ${BACKEND_URL}`);
    (global as any).__getBackendUrlLogged = true;
  }
  return BACKEND_URL;
}

// Convenience helper for runtime connectivity checks
// Always uses getBackendUrl() which returns the default BACKEND_URL (10.129.153.91:5001)
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
