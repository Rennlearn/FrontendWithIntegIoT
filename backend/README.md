# PillNow Backend API

This is the backend API server for the PillNow medication management system.

## Features

- **Authentication & Authorization**: JWT-based authentication with role-based access control
- **Medication Management**: CRUD operations for medication schedules
- **Caregiver System**: Manage caregiver-elder connections
- **Monitoring**: Real-time medication schedule monitoring
- **Notifications**: Test alarms and medication reminders
- **Security**: Rate limiting, CORS, and input validation

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `POST /api/auth/logout` - User logout

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update user profile

### Medications
- `GET /api/medications` - Get medication schedules
- `POST /api/medications` - Create medication schedule
- `PUT /api/medications/:id` - Update medication schedule
- `DELETE /api/medications/:id` - Delete medication schedule

### Caregivers
- `GET /api/caregivers/connections` - Get caregiver connections
- `POST /api/caregivers/connect` - Connect to elder
- `PUT /api/caregivers/select-elder` - Select elder to monitor

### Monitor
- `GET /api/monitor/current-user` - Get current user ID and validate Elder role
- `GET /api/monitor/selected-elder/:caregiverId` - Get selected elder ID for caregivers
- `GET /api/monitor/latest-schedule-id` - Get latest schedule ID
- `GET /api/monitor/schedule-data/:userId` - Load processed schedule data
- `POST /api/monitor/refresh-schedule-data/:userId` - Refresh schedule data

### Notifications
- `GET /api/notifications` - Get all notifications for a user
- `POST /api/notifications/test-alarm` - Create test alarm notification
- `PUT /api/notifications/:notificationId/dismiss` - Dismiss notification
- `GET /api/notifications/upcoming` - Get upcoming medication reminders

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with the following variables:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/pillnow
JWT_SECRET=your_jwt_secret_here
FRONTEND_URL=http://localhost:3000
```

3. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## Environment Variables

- `PORT` - Server port (default: 5000)
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `FRONTEND_URL` - Frontend URL for CORS

## Security Features

- **Helmet**: Security headers
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **CORS**: Configurable cross-origin resource sharing
- **Input Validation**: Request validation using express-validator
- **JWT Authentication**: Secure token-based authentication

## Database Models

- **User**: User accounts with roles (Admin, Caregiver, Elder)
- **MedicationSchedule**: Medication schedules with time slots
- **CaregiverConnection**: Caregiver-elder relationships

## Error Handling

The API includes comprehensive error handling with appropriate HTTP status codes and error messages.

## Health Check

- `GET /api/health` - Returns server status and timestamp
