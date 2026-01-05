/* Central configuration for runtime constants */

// Fallback backend URL used when EXPO_PUBLIC_BACKEND_URL is not provided.
// Update this default to match your local backend when testing on device/emulator.
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://10.128.151.91:5001';

// Convenience helper for runtime connectivity checks
export async function testBackendReachable(timeoutMs: number = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BACKEND_URL}/test`, { signal: controller.signal });
    clearTimeout(id);
    return res.ok;
  } catch {
    return false;
  }
}

if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
  // Be verbose in dev, helps debugging missing env values on device
  // eslint-disable-next-line no-console
  console.warn(`[config] EXPO_PUBLIC_BACKEND_URL not set; falling back to ${BACKEND_URL}`);
}

export default BACKEND_URL;
