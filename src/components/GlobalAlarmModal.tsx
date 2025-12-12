import React from 'react';
import { useGlobalAlarm } from '@/context/AlarmContext';
import AlarmModal from './AlarmModal';
import BluetoothService from '@/services/BluetoothService';

const GlobalAlarmModal: React.FC = () => {
  const { alarmState, hideAlarm } = useGlobalAlarm();

  const handleStopAlarm = async (containerNum: number) => {
    try {
      const isConnected = await BluetoothService.isConnectionActive();
      if (isConnected) {
        console.log(`[GlobalAlarmModal] Stopping alarm for Container ${containerNum}`);
        await BluetoothService.sendCommand('ALARMSTOP\n');
      }
    } catch (error) {
      console.error('[GlobalAlarmModal] Error stopping alarm:', error);
    }
    hideAlarm();
  };

  return (
    <AlarmModal
      visible={alarmState.visible}
      container={alarmState.container}
      time={alarmState.time}
      onDismiss={hideAlarm}
      onStopAlarm={handleStopAlarm}
    />
  );
};

export default GlobalAlarmModal;

