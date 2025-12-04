# Medication Schedule Display Logic

This document explains how medication schedules are fetched, processed, and displayed across different screens in the PillNow application.

## Overview

Schedules are displayed in three main screens:
1. **MonitorManageScreen** - Shows current schedules with status and verification
2. **ModifyButton** - Shows schedules for editing/deleting
3. **Adherence** - Shows all schedules with adherence tracking

---

## 1. MonitorManageScreen.tsx

### Data Fetching Flow

```typescript
loadScheduleData() {
  1. Get current user ID from JWT token
  2. Fetch medications from API
  3. Fetch schedules from API (with auth token)
  4. Filter schedules by user:
     - If caregiver has selected elder → show elder's schedules
     - Otherwise → show current user's schedules
  5. Sort and limit:
     - Sort by scheduleId (highest first)
     - Take top 3 schedules
     - Re-sort by container number (1, 2, 3)
  6. Sync to Bluetooth (if connected)
  7. Update state: setMedications() and setSchedules()
}
```

### Filtering Logic

```typescript
// Lines 214-227
if (selectedElderId) {
  // Caregiver viewing elder's schedules
  userSchedules = allSchedules.filter((schedule) => {
    return parseInt(schedule.user) === parseInt(selectedElderId);
  });
} else {
  // User viewing their own schedules
  userSchedules = allSchedules.filter((schedule) => {
    return parseInt(schedule.user) === currentUserId;
  });
}
```

### Sorting Logic

```typescript
// Lines 229-238
const sortedSchedules = userSchedules
  .sort((a, b) => b.scheduleId - a.scheduleId)  // Highest scheduleId first
  .slice(0, 3)                                    // Take top 3
  .sort((a, b) => {                               // Then sort by container
    return parseInt(a.container) - parseInt(b.container);
  });
```

### Status Derivation

```typescript
// Lines 354-365
deriveStatus(schedule) {
  if (!schedule?.date || !schedule?.time) 
    return schedule?.status || 'Pending';
  
  // Parse date/time
  const [y, m, d] = schedule.date.split('-').map(Number);
  const [hh, mm] = schedule.time.split(':').map(Number);
  const when = new Date(y, m-1, d, hh, mm);
  const now = new Date();
  
  // If status is Pending and time has passed → Missed
  if (schedule.status === 'Pending' && now > when) 
    return 'Missed';
  
  return schedule.status;
}
```

### Display Rendering

```typescript
// Lines 403-454
schedules.map((schedule) => {
  1. Find medication name from medication ID
  2. Display:
     - Container number
     - Status badge (Pending/Missed/Taken)
     - Medication name
     - Date
     - Time
     - Verification status (if available)
})
```

### Container Grouping

```typescript
// Lines 274-322
getContainerSchedules() {
  // Groups schedules by container (1, 2, 3)
  // Returns: {
  //   1: { pill: "Medication Name", alarms: [Date, Date, ...] },
  //   2: { pill: "Medication Name", alarms: [Date, Date, ...] },
  //   3: { pill: "Medication Name", alarms: [Date, Date, ...] }
  // }
}
```

---

## 2. ModifyButton.tsx

### Data Fetching Flow

```typescript
loadScheduleData() {
  1. Fetch schedules from API (with auth token)
  2. Get all schedules (no user filtering)
  3. Sort and limit:
     - Sort by scheduleId (highest first)
     - Take top 3 schedules
     - Re-sort by container number (1, 2, 3)
  4. Update state: setSchedules()
}
```

### Load Saved Data (for editing)

```typescript
// Lines 167-252
loadSavedData() {
  1. Fetch all schedules from API
  2. Filter by current user ID
  3. Group schedules by container
  4. For each container:
     - Sort by timestamp (most recent first)
     - Find latest date
     - Get all schedules from latest date
     - Extract medication name
     - Convert dates to Date objects
  5. Update state: setSelectedPills() and setAlarms()
}
```

### Display Rendering

```typescript
// Lines 693-730
schedules.map((schedule) => {
  1. Find medication name from medication ID
  2. Display:
     - Container number
     - Status badge
     - Medication name
     - Date
     - Time
     - Edit button
     - Delete button
})
```

---

## 3. Adherence.tsx

### Data Fetching Flow

```typescript
fetchAdherenceData() {
  1. Fetch schedules from API (with auth token)
  2. Fetch medications from API
  3. Process each schedule:
     - Find medication name from medication ID
     - Parse date and time
     - Calculate status:
       * If status === 'Taken' → 'Taken'
       * If status === 'Pending' and time passed → 'Missed'
       * Otherwise → 'Pending'
  4. Transform to MedicationRow format
  5. Update state: setMedications()
}
```

### Status Calculation

```typescript
// Lines 54-60
schedules.map((s) => {
  const [y, m, d] = s.date.split('-').map(Number);
  const [hh, mm] = s.time.split(':').map(Number);
  const when = new Date(y, m-1, d, hh, mm);
  const now = new Date();
  
  let status = s.status === 'Taken' ? 'Taken' : 'Pending';
  if (status === 'Pending' && now > when) 
    status = 'Missed';
  
  return {
    _id: s._id,
    containerId: s.container,
    medicineName: medication.name,
    scheduledTime: s.time,
    date: s.date,
    status: status
  };
});
```

### Display Rendering

```typescript
// Lines 119-134
renderMedicationCard({ item }) {
  Display:
    - Container number
    - Status icon (checkmark/close/time)
    - Medication name
    - Scheduled time
    - Date
    - Status text
}
```

---

## Common Patterns

### 1. Medication Name Resolution

All screens use the same pattern to resolve medication names:

```typescript
const medication = medications.find(med => med.medId === schedule.medication);
const medicationName = medication ? medication.name : `ID: ${schedule.medication}`;
```

### 2. Date/Time Parsing

```typescript
// Parse date string "YYYY-MM-DD"
const [year, month, day] = dateStr.split('-').map(Number);

// Parse time string "HH:MM"
const [hours, minutes] = timeStr.split(':').map(Number);

// Create Date object
const date = new Date(year, month - 1, day, hours, minutes);
```

### 3. Authentication

All API calls include authentication:

```typescript
const token = await AsyncStorage.getItem('token');
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  // ... other headers
};
if (token) {
  headers['Authorization'] = `Bearer ${token.trim()}`;
}
```

### 4. Status Colors

- **Pending**: Warning color (yellow/orange)
- **Missed**: Error color (red)
- **Taken**: Success color (green)

---

## Data Flow Summary

```
API (medication_schedules)
    ↓
Fetch with Auth Token
    ↓
Filter by User/Elder
    ↓
Sort & Limit (top 3, by container)
    ↓
Resolve Medication Names
    ↓
Calculate Status (Pending/Missed/Taken)
    ↓
Group by Container (optional)
    ↓
Render in UI
```

---

## Key Differences Between Screens

| Feature | MonitorManageScreen | ModifyButton | Adherence |
|---------|-------------------|--------------|-----------|
| User Filtering | ✅ Yes (user/elder) | ❌ No | ❌ No |
| Limit Results | ✅ Top 3 | ✅ Top 3 | ❌ All |
| Status Calculation | ✅ Real-time | ✅ From API | ✅ Real-time |
| Edit/Delete | ❌ No | ✅ Yes | ❌ No |
| Verification Display | ✅ Yes | ❌ No | ❌ No |
| Bluetooth Sync | ✅ Yes | ❌ No | ❌ No |

---

## Notes

1. **Schedule ID**: Used to identify the most recent schedule set. Higher IDs = newer schedules.

2. **Container Number**: Schedules are grouped by container (1, 2, or 3) for display.

3. **Status Derivation**: Status can be calculated client-side (real-time) or read from the API.

4. **Time Zones**: Dates are created in local timezone, not UTC.

5. **Empty States**: All screens show "No pending schedules found" when schedules array is empty.







