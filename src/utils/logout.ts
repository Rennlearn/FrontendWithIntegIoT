import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Centralized logout utility function
 * 
 * Performs a complete logout by:
 * 1. Clearing all authentication and user-related data from AsyncStorage
 * 2. Resetting the navigation stack
 * 3. Navigating to the login screen
 * 
 * This ensures a clean logout state across the entire app.
 * 
 * @param router - Optional router instance from useRouter() hook.
 *                 If not provided, will attempt to use expo-router's direct router import.
 */
export const performCompleteLogout = async (router?: { replace: (path: string) => void }): Promise<void> => {
  try {
    // Clear all user-related data from AsyncStorage
    // This includes authentication tokens, user roles, and selected elder data
    await AsyncStorage.multiRemove([
      'token',
      'userRole',
      'selectedElderId',
      'selectedElderName',
      // Note: We intentionally do NOT clear 'backend_url_override' as it's a system setting
      // and not user-specific authentication data
    ]);

    // Reset navigation stack and navigate to login screen
    // Using replace ensures the user cannot navigate back to the dashboard
    if (router) {
      router.replace('/LoginScreen');
    } else {
      // Fallback: Try to use expo-router's direct router import
      // This works in expo-router v3+
      try {
        const { router: expoRouter } = await import('expo-router');
        expoRouter.replace('/LoginScreen');
      } catch (importError) {
        // If direct import fails, throw error - caller should provide router
        throw new Error('Router instance required for navigation');
      }
    }
  } catch (error) {
    console.error('[logout] Error during logout:', error);
    // Even if clearing storage fails, try to navigate to login
    // This ensures the user can still log out even if there's a storage issue
    if (router) {
      try {
        router.replace('/LoginScreen');
      } catch (navError) {
        console.error('[logout] Error navigating to login:', navError);
        throw new Error('Failed to complete logout');
      }
    } else {
      throw error;
    }
  }
};

