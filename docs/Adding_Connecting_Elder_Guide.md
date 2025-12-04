# Guide: Adding/Connecting to an Elder

This guide explains the complete process of how a caregiver can add or connect to an elder in the PillNow application.

## Overview

The process involves two main steps:
1. **Elder Registration**: The elder must first create an account (if they don't have one)
2. **Caregiver Connection**: The caregiver connects to the elder using the elder's phone number

---

## Step-by-Step Process

### Part 1: Elder Account Registration (If Not Already Registered)

Before a caregiver can connect to an elder, the elder must have a registered account with **Role 2 (Elder)**.

#### Process:
1. **Navigate to Create Account Screen**
   - From the Login Screen, tap "Create Account" or navigate to `/Create`
   
2. **Fill in Registration Form**
   - **Name**: Elder's full name
   - **Email**: Elder's email address
   - **Phone**: Elder's phone number (⚠️ **IMPORTANT**: This is used for connection)
   - **Password**: Secure password (minimum 6 characters)
   - **Role**: Select **"Elder"** (Role 2)

3. **Submit Registration**
   - Tap "CREATE ACCOUNT" button
   - Account is created on the backend
   - Elder is redirected to Login Screen

#### Code Reference:
- **File**: `app/Create.tsx`
- **API Endpoint**: `POST /api/users/register`
- **Required Fields**: `name`, `email`, `phone`, `password`, `role: 2`

---

### Part 2: Caregiver Connecting to Elder

Once the elder has an account, the caregiver can connect to them.

#### Process:

1. **Navigate to Elder Connections Screen**
   - From **Caregiver Dashboard**, tap **"INPUT ELDER'S PROFILE"** button
   - This navigates to `/EldersProf` screen
   - **File**: `app/CaregiverDashboard.tsx` (Line 241)

2. **Enter Elder's Phone Number**
   - In the "Connect to Elder" section
   - Enter the **exact phone number** used during elder registration
   - Phone number is used to search for the elder account

3. **Tap "CONNECT" Button**
   - The app searches for an elder account with that phone number
   - Validates that the account has Role 2 (Elder)
   - Checks if already connected

4. **Connection Process** (Backend):
   - Tries multiple API endpoints to find the elder:
     - `/api/elders/phone/{phone}`
     - `/api/users/elder/{phone}`
     - `/api/users/phone/{phone}?role=2`
     - `/api/users?phone={phone}&role=2`
   - Validates the user has Role 2 (Elder)
   - Returns elder information if found

5. **Success/Error Handling**:
   - **Success**: Elder is added to connected elders list
   - **Error Cases**:
     - Elder not found → "No elder account found with this phone number"
     - Wrong role → "This phone number belongs to a [admin/caregiver] account"
     - Already connected → "Already in your list"

6. **Storage**:
   - Connected elders are saved to local storage
   - Storage key: `caregiver_connections_{caregiverId}`
   - Data persists across app sessions

#### Code Reference:
- **File**: `app/components/ElderProfile.tsx`
- **Function**: `connectToElder()` (Line 107-268)
- **Storage**: `AsyncStorage` with key `caregiver_connections_{caregiverId}`

---

## Connected Elders Management

### Viewing Connected Elders

After connecting, the elder appears in the "Connected Elders" list showing:
- **Name**: Elder's name
- **Phone**: Contact number
- **Email**: Email address
- **ID**: Elder's user ID

### Actions Available:

1. **Details Button** (ℹ️)
   - Shows full elder information in an alert dialog
   - Displays: Name, Email, Phone, Elder ID

2. **Monitor Button** (👁️)
   - Selects this elder for monitoring
   - Saves `selectedElderId` to AsyncStorage
   - When selected, caregiver can view this elder's schedules in Monitor & Manage screen
   - **Code**: `selectElder()` function (Line 343-367)

3. **Remove Button** (❌)
   - Removes elder from connected list
   - Requires confirmation
   - Removes from local storage
   - **Code**: `removeElder()` function (Line 271-330)

---

## Data Flow Diagram

```
┌─────────────────────┐
│  Elder Registration │
│  (Create.tsx)       │
│  Role: 2 (Elder)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Elder Account      │
│  Stored in Database │
│  Phone: +1234567890 │
└──────────┬──────────┘
           │
           │
           ▼
┌─────────────────────┐
│  Caregiver Dashboard│
│  Tap "INPUT ELDER'S │
│  PROFILE"           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ElderProfile Screen│
│  Enter Phone Number │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  API Search          │
│  Find Elder by Phone│
│  Validate Role = 2   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Save to Local      │
│  Storage            │
│  caregiver_         │
│  connections_{id}   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Display in List    │
│  Enable Monitoring  │
└─────────────────────┘
```

---

## Key Technical Details

### Authentication
- Caregiver must be logged in (JWT token required)
- Token is used to authenticate API requests
- Caregiver ID is extracted from JWT token

### API Endpoints Used
The app tries multiple endpoints in order:
1. `GET /api/elders/phone/{phone}`
2. `GET /api/users/elder/{phone}`
3. `GET /api/users/phone/{phone}?role=2`
4. `GET /api/users?phone={phone}&role=2`

### Data Storage
- **Location**: Local device storage (AsyncStorage)
- **Key Format**: `caregiver_connections_{caregiverId}`
- **Data Format**: JSON array of elder objects
- **Persistence**: Survives app restarts

### Elder Object Structure
```typescript
interface ElderUser {
  userId?: string;      // Primary ID
  _id?: string;         // Alternative ID
  id?: string;          // Alternative ID
  name: string;         // Elder's name
  email: string;        // Email address
  contactNumber: string; // Phone number
  profileImage?: string; // Optional profile image
  role: number;         // Must be 2 (Elder)
}
```

---

## Common Issues & Solutions

### Issue 1: "Elder Not Found"
**Cause**: Phone number doesn't match any registered elder account
**Solution**: 
- Verify the phone number is correct
- Ensure elder has registered with Role 2
- Check phone number format matches exactly

### Issue 2: "Invalid User Type"
**Cause**: Phone number belongs to Admin (Role 1) or Caregiver (Role 3)
**Solution**: 
- Only accounts with Role 2 (Elder) can be connected
- Elder must re-register with correct role

### Issue 3: "Already Connected"
**Cause**: Elder is already in the connected list
**Solution**: 
- Check the "Connected Elders" list
- Use "Monitor" button to select for monitoring
- Use "Remove" if you want to disconnect and reconnect

### Issue 4: Connection Not Persisting
**Cause**: Storage issue or caregiver ID mismatch
**Solution**: 
- Check AsyncStorage permissions
- Verify caregiver is logged in
- Check console logs for storage errors

---

## Testing the Flow

### Test Scenario 1: New Elder Connection
1. Register a new elder account (Role 2) with phone: `+1234567890`
2. Login as caregiver (Role 3)
3. Navigate to Elder Connections
4. Enter phone: `+1234567890`
5. Tap "CONNECT"
6. ✅ Should see success message and elder in list

### Test Scenario 2: Duplicate Connection
1. Connect to an elder (from Scenario 1)
2. Try to connect again with same phone
3. ✅ Should see "Already Connected" error

### Test Scenario 3: Wrong Role
1. Register account with Role 3 (Caregiver) and phone: `+9876543210`
2. Try to connect as caregiver
3. ✅ Should see "Invalid User Type" error

### Test Scenario 4: Monitor Elder
1. Connect to an elder
2. Tap "Monitor" button
3. Navigate to Monitor & Manage screen
4. ✅ Should see that elder's schedules

---

## Files Involved

1. **`app/Create.tsx`**
   - Elder account registration
   - Role selection

2. **`app/CaregiverDashboard.tsx`**
   - Entry point to Elder Connections
   - Button: "INPUT ELDER'S PROFILE"

3. **`app/EldersProf.tsx`**
   - Wrapper component
   - Navigation handling

4. **`app/components/ElderProfile.tsx`**
   - Main connection logic
   - UI for connecting and managing elders
   - Local storage management

---

## Summary

The process is straightforward:
1. **Elder registers** with Role 2 and provides phone number
2. **Caregiver navigates** to Elder Connections screen
3. **Caregiver enters** elder's phone number
4. **System searches** for elder account and validates role
5. **Connection is saved** to local storage
6. **Caregiver can monitor** elder's medication schedules

The connection is stored locally on the caregiver's device and persists across app sessions.


