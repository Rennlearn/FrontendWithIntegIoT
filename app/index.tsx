import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FlashScreen from './FlashScreen';

/**
 * Root index route for Expo Router.
 * Redirects to FlashScreen which handles initial navigation flow.
 * 
 * CRITICAL: This file was previously using React Navigation (NavigationContainer, Drawer)
 * which conflicts with Expo Router. Fixed to use Expo Router navigation instead.
 */
export default function Index() {
  const router = useRouter();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) {
          // Token exists, decode to check role and redirect
          try {
            const decodedToken = JSON.parse(atob(token.split('.')[1]));
            const roleId = parseInt(decodedToken.role || decodedToken.user?.role || "0");
            
            // Check token expiration
            const exp = decodedToken.exp;
            if (exp && exp * 1000 < Date.now()) {
              // Token expired, go to flash screen which will redirect to login
              return;
            }
            
            // Valid token, redirect to appropriate dashboard
            if (roleId === 3) {
              router.replace('/CaregiverDashboard');
            } else if (roleId === 2) {
              router.replace('/ElderDashboard');
            }
            // If roleId is 0 or unknown, continue to flash screen
          } catch (error) {
            // Invalid token format, continue to flash screen
            console.warn('[Index] Invalid token format:', error);
          }
        }
      } catch (error) {
        console.error('[Index] Error checking auth:', error);
      }
    };
    
    checkAuth();
  }, [router]);

  // Show flash screen which handles the initial navigation flow
  return <FlashScreen />;
}
