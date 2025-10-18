# MonitorManageScreen Refactoring Summary

## Overview
This document summarizes the refactoring of `MonitorManageScreen.tsx` to separate business logic from the frontend and move it to the backend API.

## Functions Moved to Backend

### 1. **User Authentication & Role Validation**
- **Original Function**: `getCurrentUserId()`
- **New Backend Endpoint**: `GET /api/monitor/current-user`
- **Purpose**: Validates JWT token, gets user ID, and checks Elder role permissions
- **Location**: `backend/routes/monitor.js`

### 2. **Elder Selection for Caregivers**
- **Original Function**: `getSelectedElderId()`
- **New Backend Endpoint**: `GET /api/monitor/selected-elder/:caregiverId`
- **Purpose**: Gets the selected elder ID for caregiver users
- **Location**: `backend/routes/monitor.js`

### 3. **Latest Schedule ID Retrieval**
- **Original Function**: `getLatestScheduleId()`
- **New Backend Endpoint**: `GET /api/monitor/latest-schedule-id`
- **Purpose**: Fetches the highest schedule ID from the database
- **Location**: `backend/routes/monitor.js`

### 4. **Schedule Data Loading & Processing**
- **Original Function**: `loadScheduleData()`
- **New Backend Endpoint**: `GET /api/monitor/schedule-data/:userId`
- **Purpose**: Loads and processes medication schedules with container organization
- **Location**: `backend/routes/monitor.js`

### 5. **Container Schedule Processing**
- **Original Function**: `getContainerSchedules()`
- **New Backend Function**: `processContainerSchedules()`
- **Purpose**: Processes schedules into container format (1, 2, 3)
- **Location**: `backend/routes/monitor.js`

### 6. **Data Refresh**
- **Original Function**: `handleRefresh()`
- **New Backend Endpoint**: `POST /api/monitor/refresh-schedule-data/:userId`
- **Purpose**: Triggers data refresh operations
- **Location**: `backend/routes/monitor.js`

## New Frontend Service

### MonitorService (`app/services/monitorService.ts`)
- **Purpose**: Handles all API calls to the backend monitor endpoints
- **Features**:
  - Automatic token management
  - Error handling
  - TypeScript interfaces for type safety
  - Cache-busting headers

## API Endpoints Created

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/monitor/current-user` | Get current user ID and validate Elder role |
| GET | `/api/monitor/selected-elder/:caregiverId` | Get selected elder ID for caregivers |
| GET | `/api/monitor/latest-schedule-id` | Get latest schedule ID |
| GET | `/api/monitor/schedule-data/:userId` | Load processed schedule data |
| POST | `/api/monitor/refresh-schedule-data/:userId` | Refresh schedule data |

## Benefits of This Refactoring

### 1. **Separation of Concerns**
- Frontend: Only UI rendering and user interaction
- Backend: Business logic, data processing, and database operations

### 2. **Security**
- JWT validation moved to backend
- Role-based access control centralized
- Sensitive operations protected

### 3. **Maintainability**
- Business logic centralized in backend
- Easier to update and test
- Clear API contracts

### 4. **Performance**
- Data processing on server side
- Reduced client-side computation
- Better caching strategies possible

### 5. **Scalability**
- Backend can handle multiple frontend clients
- Easier to add new features
- Better resource utilization

## Usage Example

### Before (Frontend with Business Logic)
```typescript
// Complex business logic in component
const getCurrentUserId = async (): Promise<number> => {
  // JWT decoding, role validation, error handling
  // 50+ lines of code
};

const loadScheduleData = async () => {
  // Multiple API calls, data processing, filtering
  // 70+ lines of code
};
```

### After (Frontend with API Calls Only)
```typescript
// Simple API calls using service
const loadScheduleData = async () => {
  const currentUserId = await monitorService.getCurrentUserId();
  const selectedElderId = await monitorService.getSelectedElderId(currentUserId.toString());
  const data = await monitorService.loadScheduleData(currentUserId, selectedElderId || undefined);
  
  setSchedules(data.schedules);
  setContainerSchedules(data.containerSchedules);
};
```

## Files Modified/Created

### Backend Files
- ✅ `backend/routes/monitor.js` (NEW)
- ✅ `backend/server.js` (Updated to include monitor routes)

### Frontend Files
- ✅ `app/services/monitorService.ts` (NEW)
- ✅ `app/MonitorManageScreen.tsx` (Refactored)

## Next Steps

1. **Test the new API endpoints** to ensure they work correctly
2. **Update other components** that might use similar logic
3. **Add error handling** for network failures
4. **Implement caching** strategies if needed
5. **Add API documentation** for the new endpoints

## Notes

- The frontend now only contains UI logic and API calls
- All business logic is centralized in the backend
- The API is RESTful and follows best practices
- TypeScript interfaces ensure type safety
- Error handling is consistent across all endpoints
