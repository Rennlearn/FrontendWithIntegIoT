import React, { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { useRouter } from 'expo-router';
import ElderProfile from './components/ElderProfile';

export default function EldersProf() {
  const router = useRouter();

  const handleElderSelected = (elderId: string, elderName: string) => {
    // Navigate back to dashboard after elder selection
    router.back();
  };

  const handleBack = () => {
    router.back();
  };

  // Handle Android hardware back button
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true; // Prevent default behavior
    });

    return () => backHandler.remove();
  }, []);

  return (
    <ElderProfile 
      onElderSelected={handleElderSelected}
      onBack={handleBack}
    />
  );
}
