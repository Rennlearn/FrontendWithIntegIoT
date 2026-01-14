import { Stack } from "expo-router";
import { ThemeProvider } from "@/context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalAlarmHandler from "./components/GlobalAlarmHandler";
import { ModalManagerProvider } from "./components/ModalManager";
import { useEffect } from "react";

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

export default function RootLayout() {
  useEffect(() => {
    setupGlobalErrorHandlers();
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
