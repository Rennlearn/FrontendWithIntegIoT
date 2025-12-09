import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

class SoundService {
  private soundObject: Audio.Sound | null = null;
  private isPlaying = false;
  private loopInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize the sound service
   */
  async initialize() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      console.log('[SoundService] Initialized');
    } catch (error) {
      console.error('[SoundService] Failed to initialize:', error);
    }
  }

  /**
   * Load and play alarm sound
   * @param soundType - Type of sound to play ('alarm', 'notification', 'reminder')
   */
  async playAlarmSound(soundType: 'alarm' | 'notification' | 'reminder' = 'alarm') {
    try {
      // Stop any currently playing sound
      await this.stopSound();

      // Get sound source (custom file if available)
      const soundSource = this.getSoundFile(soundType);
      
      if (soundSource) {
        // Use custom sound file
        const { sound } = await Audio.Sound.createAsync(
          soundSource,
          {
            shouldPlay: true,
            isLooping: true, // Loop the alarm sound
            volume: 1.0,
          }
        );

        this.soundObject = sound;
        this.isPlaying = true;

        // Set up completion handler
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
            this.isPlaying = false;
          }
        });

        console.log('[SoundService] Alarm sound started');
      } else {
        // No custom sound file - use haptic feedback pattern as fallback
        console.log('[SoundService] No custom sound file, using haptic feedback');
        await this.playHapticPattern();
        
        // Loop haptic pattern
        this.loopInterval = setInterval(async () => {
          if (this.isPlaying) {
            await this.playHapticPattern();
          }
        }, 2000);
      }
    } catch (error) {
      console.error('[SoundService] Failed to play alarm sound:', error);
      // Fallback to haptics
      await this.playHapticPattern();
    }
  }

  /**
   * Play haptic feedback pattern (vibration)
   */
  private async playHapticPattern() {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise(resolve => setTimeout(resolve, 100));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise(resolve => setTimeout(resolve, 100));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } catch (error) {
      console.error('[SoundService] Failed to play haptic pattern:', error);
    }
  }

  /**
   * Play a simple beep pattern (3 beeps)
   */
  async playBeepPattern(repeat: number = 3) {
    try {
      await this.stopSound();
      
      const soundSource = this.getSoundFile('notification');
      
      if (soundSource) {
        for (let i = 0; i < repeat; i++) {
          const { sound } = await Audio.Sound.createAsync(
            soundSource,
            {
              shouldPlay: true,
              isLooping: false,
              volume: 1.0,
            }
          );
          
          await new Promise(resolve => {
            sound.setOnPlaybackStatusUpdate((status) => {
              if (status.isLoaded && status.didJustFinish) {
                resolve(null);
              }
            });
          });
          
          await sound.unloadAsync();
          
          // Wait between beeps (except after last one)
          if (i < repeat - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } else {
        // Use haptics as fallback
        for (let i = 0; i < repeat; i++) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          if (i < repeat - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
      
      console.log('[SoundService] Beep pattern played');
    } catch (error) {
      console.error('[SoundService] Failed to play beep pattern:', error);
    }
  }

  /**
   * Stop the currently playing sound
   */
  async stopSound() {
    try {
      // Clear loop interval
      if (this.loopInterval) {
        clearInterval(this.loopInterval);
        this.loopInterval = null;
      }

      if (this.soundObject) {
        await this.soundObject.stopAsync();
        await this.soundObject.unloadAsync();
        this.soundObject = null;
      }
      
      this.isPlaying = false;
      console.log('[SoundService] Sound stopped');
    } catch (error) {
      console.error('[SoundService] Failed to stop sound:', error);
    }
  }

  /**
   * Play a short notification sound (single beep)
   */
  async playNotificationSound() {
    try {
      await this.stopSound();
      
      const soundSource = this.getSoundFile('notification');
      
      if (soundSource) {
        const { sound } = await Audio.Sound.createAsync(
          soundSource,
          {
            shouldPlay: true,
            isLooping: false,
            volume: 0.8,
          }
        );

        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            sound.unloadAsync();
          }
        });

        console.log('[SoundService] Notification sound played');
      } else {
        // Use haptics as fallback
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('[SoundService] Failed to play notification sound:', error);
    }
  }

  /**
   * Get sound file for a specific type
   * Add your custom sound files to assets/sounds/ and uncomment the appropriate return statement
   * 
   * @param soundType - Type of sound needed
   * @returns Sound file require() or null to use haptics/fallback
   */
  private getSoundFile(soundType: 'alarm' | 'notification' | 'reminder'): any {
    // Return null to use haptic feedback (works immediately, no files needed)
    // Uncomment the appropriate line when you add sound files to assets/sounds/
    
    switch (soundType) {
      case 'alarm':
        // return require('../../assets/sounds/alarm.mp3');
        return null; // Using haptics for now
      case 'notification':
        // return require('../../assets/sounds/notification.mp3');
        return null; // Using haptics for now
      case 'reminder':
        // return require('../../assets/sounds/reminder.mp3');
        return null; // Using haptics for now
      default:
        return null;
    }
  }

  /**
   * Check if sound is currently playing
   */
  isSoundPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  async setVolume(volume: number) {
    try {
      if (this.soundObject) {
        await this.soundObject.setVolumeAsync(Math.max(0, Math.min(1, volume)));
      }
    } catch (error) {
      console.error('[SoundService] Failed to set volume:', error);
    }
  }
}

export const soundService = new SoundService();
