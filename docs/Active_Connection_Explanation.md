# What Does "Active Connection" Mean?

In the PillNow system, there are **three different types of connections** that can exist between a caregiver and an elder:

## 1. **Local Connection** (Elder in Connected List)
- **What it is**: The elder is stored in the caregiver's local device storage (AsyncStorage)
- **How it's created**: When a caregiver uses "Connect to Elder" and enters the elder's phone number
- **Storage location**: `caregiver_connections_{caregiverId}` in AsyncStorage
- **Purpose**: Quick reference list of elders the caregiver has connected to
- **Status**: This is just a local list - it doesn't create a database record

## 2. **Database Connection** (CaregiverConnection Record)
- **What it is**: A record in the backend database that links a caregiver to an elder
- **Required fields**:
  - `caregiver`: Caregiver's user ID
  - `elder`: Elder's user ID
  - `status`: Must be `'active'` (or `'Active'` or `'ACTIVE'`)
  - `permissions.viewAdherence`: Must be `true` (defaults to true if not specified)
- **How it's created**: Created on the backend when caregiver-elder relationship is established
- **Purpose**: Authorizes the caregiver to view/manage the elder's data
- **Checked via**: `/api/monitor/elder-device/:elderId` endpoint

## 3. **Device Connection** (Elder's Device Connected)
- **What it is**: The elder has a physical device (Arduino/ESP32) connected to the system
- **How it's created**: When an elder connects their pill box device via Bluetooth
- **Purpose**: Required for medication schedules to work with the physical device
- **Checked via**: `/api/monitor/elder-device/:elderId` endpoint (returns 404 if no device)

---

## Current Implementation Differences

### **CaregiverDashboard** (Home Screen)
- **Checks**: Only Local Connection (elder in connected list)
- **Why**: For dashboard purposes, if elder is in the list, they can be monitored
- **Code**: `checkCaregiverConnection()` only checks AsyncStorage

### **MonitorManageScreen, SetScreen, ModifyScheduleScreen**
- **Checks**: Database Connection + Device Connection
- **Why**: These screens need to actually interact with the elder's data and device
- **Code**: Calls `/api/monitor/elder-device/:elderId` endpoint
- **Requirements**:
  - Valid JWT token (caregiver's token)
  - Active CaregiverConnection record (`status: 'active'`)
  - `permissions.viewAdherence: true`
  - Elder must have a device connected (returns 404 if not)

---

## Why "NO ACTIVE CONNECTION" Appears

The message appears when:

1. **On Dashboard**: Elder is not in the local connected list
2. **On Other Screens**: One of these is missing:
   - No CaregiverConnection record in database
   - CaregiverConnection exists but `status !== 'active'`
   - `permissions.viewAdherence === false`
   - Elder has no device connected (404 error)

---

## How to Establish an Active Connection

### Step 1: Local Connection (ElderProfile Screen)
1. Go to "INPUT ELDER'S PROFILE"
2. Enter elder's phone number
3. Tap "CONNECT"
4. Elder is added to local list

### Step 2: Database Connection (Backend)
- This should be created automatically when the caregiver-elder relationship is established
- If not, it needs to be created via backend API
- The CaregiverConnection record must have:
  ```json
  {
    "caregiver": <caregiver_user_id>,
    "elder": <elder_user_id>,
    "status": "active",
    "permissions": {
      "viewAdherence": true
    }
  }
  ```

### Step 3: Device Connection (Elder's Device)
- Elder must connect their pill box device via Bluetooth
- Device must be registered in the system
- This is done by the elder, not the caregiver

---

## Summary

**"Active Connection"** means different things in different contexts:

- **Dashboard**: Elder is in local connected list ✅
- **Monitor/Set/Modify Screens**: Database connection exists + Device connected ✅✅

The dashboard uses a simpler check (local list only) because it's just for selecting which elder to monitor. The other screens need full verification because they actually access the elder's data and device.

