# How to Have an Active Connection

This guide explains step-by-step how to establish an active connection between a caregiver and an elder.

---

## Quick Summary

An **active connection** requires:
1. ✅ **Local Connection**: Elder in caregiver's connected list
2. ✅ **Database Connection**: CaregiverConnection record in database with `status: 'active'`
3. ✅ **Device Connection**: Elder's device connected (required for Monitor/Set/Modify screens)

---

## Step-by-Step Instructions

### Step 1: Ensure Elder Has an Account

**Prerequisites:**
- Elder must have a registered account with **Role 2 (Elder)**
- Elder must have a valid phone number registered

**If elder doesn't have an account:**
1. Elder goes to **Create Account** screen
2. Fills in:
   - Name
   - Email
   - Phone number (⚠️ **IMPORTANT**: Must match exactly)
   - Password
   - Role: **Elder** (Role 2)
3. Submits registration

---

### Step 2: Caregiver Connects to Elder

**Process:**
1. **Caregiver logs in** to their account (Role 3 - Caregiver)
2. **Goes to Caregiver Dashboard**
3. **Taps "INPUT ELDER'S PROFILE"** button
4. **Enters elder's phone number** (must match exactly the phone used during elder registration)
5. **Taps "CONNECT"** button

**What happens:**
- ✅ App searches for elder by phone number
- ✅ Validates elder has Role 2
- ✅ Creates **local connection** (saves to AsyncStorage)
- ✅ Creates **database connection** (CaregiverConnection record with `status: 'active'`)
- ✅ Elder appears in "Connected Elders" list

**Success Message:**
```
Successfully connected to [Elder Name]

Elder ID: [ID]
Phone: [Phone Number]
```

---

### Step 3: Select Elder for Monitoring

**Process:**
1. In the **"Connected Elders"** list, find the elder
2. **Tap "Monitor" button** (👁️ icon)
3. Elder is now selected for monitoring

**What happens:**
- ✅ `selectedElderId` is saved to AsyncStorage
- ✅ `selectedElderName` is saved to AsyncStorage
- ✅ Dashboard shows "Monitoring: [Elder Name]" banner
- ✅ "MONITOR & MANAGE" button becomes active

---

### Step 4: Elder Connects Device (For Full Functionality)

**Note:** This step is done by the **elder**, not the caregiver.

**Process:**
1. **Elder logs in** to their account
2. **Goes to Bluetooth Screen**
3. **Connects to pill box device** via Bluetooth
4. **Device is registered** in the system

**Why it's needed:**
- Required for setting/modifying schedules
- Required for medication adherence monitoring
- Required for alarm functionality

---

## Verification

### Check Local Connection (Dashboard)
- ✅ Elder appears in "Connected Elders" list
- ✅ "Monitoring: [Elder Name]" banner appears
- ✅ "MONITOR & MANAGE" button is enabled

### Check Database Connection (Other Screens)
- ✅ Can access Monitor & Manage screen
- ✅ Can access Set Schedule screen
- ✅ Can access Modify Schedule screen
- ✅ Can view adherence reports

### Check Device Connection
- ✅ Can set schedules (requires device)
- ✅ Can modify schedules (requires device)
- ✅ Alarms work properly (requires device)

---

## Troubleshooting

### Issue: "NO ACTIVE CONNECTION TO ELDER" on Dashboard

**Possible Causes:**
1. Elder not in connected list
2. Elder was removed from list
3. AsyncStorage was cleared

**Solution:**
1. Go to "INPUT ELDER'S PROFILE"
2. Re-connect to elder using phone number
3. Select elder for monitoring again

---

### Issue: "NO ACTIVE CONNECTION" on Monitor/Set/Modify Screens

**Possible Causes:**
1. No CaregiverConnection record in database
2. CaregiverConnection exists but `status !== 'active'`
3. `permissions.viewAdherence === false`
4. Elder has no device connected (404 error)

**Solution:**
1. **Check database connection:**
   - Re-connect to elder (this creates CaregiverConnection record)
   - Verify connection was created successfully

2. **Check device connection:**
   - Elder must connect their device via Bluetooth
   - Device must be registered in system

3. **Check permissions:**
   - CaregiverConnection should have `permissions.viewAdherence: true`
   - If not, may need backend admin to update

---

### Issue: Connection Created But Still Shows "NO ACTIVE CONNECTION"

**Possible Causes:**
1. CaregiverConnection record not created (API call failed)
2. Wrong caregiver/elder IDs
3. Backend API endpoint not available

**Solution:**
1. Check console logs for errors
2. Verify API endpoint is accessible
3. Try disconnecting and reconnecting elder
4. Check backend logs for CaregiverConnection creation

---

## API Endpoints Used

### Creating CaregiverConnection
```
POST /api/caregiver-connections
Headers:
  Authorization: Bearer <caregiver_token>
  Content-Type: application/json
Body:
{
  "caregiver": <caregiver_user_id>,
  "elder": <elder_user_id>,
  "status": "active",
  "permissions": {
    "viewAdherence": true
  }
}
```

### Checking Connection
```
GET /api/monitor/elder-device/:elderId
Headers:
  Authorization: Bearer <caregiver_token>
```

**Response Codes:**
- `200 OK`: Connection exists and is active ✅
- `401 Unauthorized`: Invalid/expired token ❌
- `403 Forbidden`: No permission or connection not active ❌
- `404 Not Found`: No device connection ❌

---

## Code References

### Creating Connection
- **File**: `app/components/ElderProfile.tsx`
- **Function**: `connectToElder()` (Line ~256)
- **What it does**:
  1. Searches for elder by phone number
  2. Validates elder has Role 2
  3. Creates CaregiverConnection record in database
  4. Saves elder to local connected list

### Checking Connection
- **File**: `app/MonitorManageScreen.tsx`
- **Function**: `checkCaregiverConnection()` (Line ~150)
- **What it checks**:
  1. Valid JWT token
  2. CaregiverConnection record exists
  3. Status is 'active'
  4. Has viewAdherence permission
  5. Elder has device connected

---

## Summary Checklist

To have a fully active connection:

- [ ] Elder has registered account (Role 2)
- [ ] Caregiver has logged in (Role 3)
- [ ] Caregiver connected to elder via phone number
- [ ] CaregiverConnection record created in database
- [ ] Elder selected for monitoring
- [ ] Elder's device connected via Bluetooth (for full functionality)

Once all steps are complete, you should be able to:
- ✅ View elder's schedules
- ✅ Set new schedules
- ✅ Modify existing schedules
- ✅ View adherence reports
- ✅ Monitor medication intake

