import { Stack } from "expo-router";
import { ThemeProvider } from "@/context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalAlarmHandler from "./components/GlobalAlarmHandler";
import { ModalManagerProvider } from "./components/ModalManager";
import { useEffect } from "react";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKEND_URL } from '@/config';

// CRITICAL: Global error handler for unhandled promise rejections
// Prevents white screens from async errors that ErrorBoundary can't catch
const setupGlobalErrorHandlers = () => {
  // Handle unhandled promise rejections (React Native ErrorUtils)
  if (typeof global !== 'undefined' && (global as any).ErrorUtils) {
    const ErrorUtils = (global as any).ErrorUtils;
    const originalHandler = ErrorUtils.getGlobalHandler?.();
    
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      console.error('[GlobalErrorHandler] Unhandled error:', error, 'isFatal:', isFatal);
      
      // Log error details for debugging
      if (error instanceof Error) {
        console.error('[GlobalErrorHandler] Error message:', error.message);
        console.error('[GlobalErrorHandler] Error stack:', error.stack);
      }
      
      // Call original handler if it exists
      if (originalHandler) {
        originalHandler(error, isFatal);
      }
      
      // Prevent app crash - don't rethrow
      // ErrorBoundary will catch render errors, this handles async errors
    });
  }
  
  // Handle unhandled promise rejections (Web/Expo)
  if (typeof window !== 'undefined' && window.addEventListener) {
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      console.error('[GlobalErrorHandler] Unhandled promise rejection:', event.reason);
      event.preventDefault?.(); // Prevent default error behavior
    };
    
    window.addEventListener('unhandledrejection', rejectionHandler);
  }
};

// FORCE CLEAR: Remove ALL overrides on app startup
// CRITICAL: The app ALWAYS uses the default BACKEND_URL (10.129.153.91:5001)
// This prevents the app from ever connecting to old IPs like 10.128.151.91:5001
const forceClearOldIPs = async () => {
  try {
    console.log(`[RootLayout] 🧹 FORCE CLEAR: Removing ALL backend URL overrides`);
    console.log(`[RootLayout] ✅ App will ALWAYS use default URL: ${BACKEND_URL}`);
    
    // ALWAYS clear ALL overrides - the app should never use AsyncStorage overrides
    // This ensures the app ALWAYS connects to the correct IP (10.129.153.91:5001)
    await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
    
    // Wait a bit to ensure AsyncStorage has processed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify it's cleared - retry multiple times if needed
    let verify = await AsyncStorage.getItem('backend_url_override');
    let attempts = 0;
    const maxAttempts = 5;
    
    while (verify && attempts < maxAttempts) {
      const verifyTrimmed = String(verify).trim();
      const invalidIPs = ['10.128.151.91', '10.165.11.91'];
      const containsInvalidIP = invalidIPs.some(invalidIP => verifyTrimmed.includes(invalidIP));
      
      if (containsInvalidIP) {
        console.error(`[RootLayout] 🚨 CRITICAL: Invalid IP still in AsyncStorage! (${verifyTrimmed}) - Attempt ${attempts + 1}/${maxAttempts}`);
      } else {
        console.warn(`[RootLayout] ⚠️ Override still exists (${verifyTrimmed}) - Attempt ${attempts + 1}/${maxAttempts}`);
      }
      
      await AsyncStorage.multiRemove(['backend_url_override', 'backend_url_manual_override']);
      await new Promise(resolve => setTimeout(resolve, 100 * (attempts + 1))); // Exponential backoff
      verify = await AsyncStorage.getItem('backend_url_override');
      attempts++;
    }
    
    if (verify) {
      console.error(`[RootLayout] ❌ Failed to clear override after ${maxAttempts} attempts!`);
    } else {
      console.log(`[RootLayout] ✅ Successfully cleared all overrides - app will use default: ${BACKEND_URL}`);
    }
  } catch (e) {
    console.warn('[RootLayout] Error during force clear:', e);
  }
};

export default function RootLayout() {
  useEffect(() => {
    setupGlobalErrorHandlers();
    // Force clear old IPs on app startup
    forceClearOldIPs();
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ModalManagerProvider>
        {/* Mount global BT alarm handler once so alarms/mismatch modals work on every screen */}
        <GlobalAlarmHandler />
        <Stack screenOptions={{ headerShown: false }} />
        </ModalManagerProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
