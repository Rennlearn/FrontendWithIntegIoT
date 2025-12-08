# Sound Setup Guide for Medication Alarms

This guide explains how to add custom sound files for medication alarms in the PillNow app.

## Current Implementation

The app uses `expo-av` for playing alarm sounds. The sound service is located at `app/services/soundService.ts`.

## Adding Custom Sound Files

### Step 1: Create Sound Files Directory

Create a directory for sound files:
```
assets/sounds/
```

### Step 2: Add Sound Files

Add your sound files to `assets/sounds/`:
- `alarm.mp3` - Main alarm sound (looping)
- `beep.mp3` - Short beep for patterns
- `notification.mp3` - Short notification sound

**Recommended formats:**
- **iOS**: `.m4a`, `.mp3`, `.wav`
- **Android**: `.mp3`, `.wav`, `.ogg`

**Recommended specifications:**
- Sample rate: 44.1 kHz
- Bit rate: 128 kbps or higher
- Duration: 1-3 seconds for looping sounds
- Format: MP3 or M4A

### Step 3: Update soundService.ts

Update the `getBeepSoundUri()` method to use your custom sound files:

```typescript
private getBeepSoundUri(): any {
  // Use custom sound files
  return require('../../assets/sounds/alarm.mp3');
}
```

Or for different sound types:

```typescript
private getSoundFile(soundType: 'alarm' | 'notification' | 'reminder'): any {
  switch (soundType) {
    case 'alarm':
      return require('../../assets/sounds/alarm.mp3');
    case 'notification':
      return require('../../assets/sounds/notification.mp3');
    case 'reminder':
      return require('../../assets/sounds/reminder.mp3');
    default:
      return require('../../assets/sounds/alarm.mp3');
  }
}
```

### Step 4: Configure Notification Sounds (Optional)

For push notifications, you can also specify custom sounds in `app.json`:

```json
{
  "expo": {
    "notification": {
      "icon": "./assets/images/icon.png",
      "color": "#4A90E2",
      "sounds": [
        "./assets/sounds/alarm.mp3",
        "./assets/sounds/notification.mp3"
      ]
    }
  }
}
```

Then use them in notifications:

```typescript
await Notifications.scheduleNotificationAsync({
  content: {
    title: '💊 Medication Reminder',
    body: 'Time to take your medication!',
    sound: 'alarm.mp3', // Custom sound file name
  },
  trigger: null,
});
```

## Sound Behavior

### Alarm Sound
- **Plays when**: Medication alarm is triggered
- **Behavior**: Loops continuously until dismissed
- **Volume**: 100% (1.0)
- **Stops when**: User dismisses notification or snoozes

### Notification Sound
- **Plays when**: General notifications
- **Behavior**: Plays once
- **Volume**: 80% (0.8)

### Beep Pattern
- **Plays when**: Quick alerts or confirmations
- **Behavior**: Plays 3 beeps with 200ms delay between
- **Volume**: 100% (1.0)

## Testing

1. **Test alarm sound**:
   - Set a medication schedule
   - Wait for alarm time
   - Verify sound plays and loops

2. **Test notification sound**:
   - Trigger a notification
   - Verify sound plays once

3. **Test sound stopping**:
   - Start alarm
   - Dismiss notification
   - Verify sound stops

## Troubleshooting

### Sound Not Playing

1. **Check file format**: Ensure sound files are in supported formats
2. **Check file path**: Verify require() path is correct
3. **Check volume**: Ensure device volume is not muted
4. **Check permissions**: On Android, ensure app has audio permissions
5. **Check audio mode**: Verify audio mode allows playback in background

### Sound Plays But Too Quiet

- Increase volume in `soundService.ts`:
  ```typescript
  volume: 1.0, // Maximum volume
  ```

### Sound Doesn't Stop

- Ensure `stopSound()` is called when dismissing notifications
- Check that sound object is properly cleaned up

## Platform-Specific Notes

### iOS
- Sounds play even in silent mode (configured in `setAudioModeAsync`)
- Custom sounds must be in app bundle
- System sounds are available without files

### Android
- Sounds respect system volume settings
- Custom sounds work from assets folder
- May need audio focus permissions

## Best Practices

1. **Keep sound files small**: < 500KB each
2. **Use appropriate formats**: MP3 for compatibility
3. **Test on both platforms**: iOS and Android handle sounds differently
4. **Provide fallback**: Always have a system default fallback
5. **Respect user preferences**: Consider adding sound settings in app

## Example Sound Files

You can find free alarm sounds at:
- [Freesound.org](https://freesound.org)
- [Zapsplat](https://www.zapsplat.com)
- [Mixkit](https://mixkit.co/free-sound-effects/alarm/)

Search for: "alarm", "notification", "beep", "medication reminder"

