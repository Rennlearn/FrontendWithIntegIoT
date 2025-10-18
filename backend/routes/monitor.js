const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const MedicationSchedule = require('../models/MedicationSchedule');
const CaregiverConnection = require('../models/CaregiverConnection');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Get current user ID and validate Elder role
router.get('/current-user', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID not found in token' });
    }

    // Get user from database to validate role
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user role allows Elder access (role 2 for Elder)
    if (user.role !== 2) {
      return res.status(403).json({ 
        error: 'Access Denied', 
        message: 'Only Elders can access medication schedules' 
      });
    }

    res.json({ 
      userId: userId,
      role: user.role,
      message: 'User validated successfully' 
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get selected elder ID for caregivers
router.get('/selected-elder/:caregiverId', authenticateToken, async (req, res) => {
  try {
    const { caregiverId } = req.params;
    
    // Find caregiver connection to get selected elder
    const connection = await CaregiverConnection.findOne({ 
      caregiverId: caregiverId 
    });
    
    if (!connection) {
      return res.json({ selectedElderId: null });
    }

    res.json({ selectedElderId: connection.selectedElderId });
  } catch (error) {
    console.error('Error getting selected elder:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get latest schedule ID
router.get('/latest-schedule-id', authenticateToken, async (req, res) => {
  try {
    const latestSchedule = await MedicationSchedule.findOne()
      .sort({ scheduleId: -1 })
      .select('scheduleId');
    
    const latestScheduleId = latestSchedule ? latestSchedule.scheduleId : 0;
    
    res.json({ latestScheduleId });
  } catch (error) {
    console.error('Error getting latest schedule ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Load schedule data with processing
router.get('/schedule-data/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { selectedElderId } = req.query;

    // Determine which user's schedules to fetch
    const targetUserId = selectedElderId || userId;

    // Fetch schedules for the target user (medications are stored within schedules)
    let userSchedules = await MedicationSchedule.find({ userId: targetUserId });

    // Sort by schedule ID (highest first) and take top 3, then arrange by container number
    const sortedSchedules = userSchedules
      .sort((a, b) => b.scheduleId - a.scheduleId) // Sort by highest schedule ID first
      .slice(0, 3) // Take top 3 highest schedule IDs
      .sort((a, b) => {
        // Then arrange by container number (1, 2, 3)
        const containerA = parseInt(a.container);
        const containerB = parseInt(b.container);
        return containerA - containerB;
      });

    // Process container schedules
    const containerSchedules = processContainerSchedules(sortedSchedules);

    res.json({
      schedules: sortedSchedules,
      containerSchedules
    });
  } catch (error) {
    console.error('Error loading schedule data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process container schedules helper function
function processContainerSchedules(schedules) {
  const containerSchedules = {
    1: { pill: null, alarms: [] },
    2: { pill: null, alarms: [] },
    3: { pill: null, alarms: [] }
  };
  
  if (!schedules.length) {
    return containerSchedules;
  }
  
  // Group schedules by container
  const schedulesByContainer = {};
  schedules.forEach((schedule) => {
    const containerNum = parseInt(schedule.container) || 1;
    if (!schedulesByContainer[containerNum]) {
      schedulesByContainer[containerNum] = [];
    }
    schedulesByContainer[containerNum].push(schedule);
  });
  
  // Process each container
  for (let containerNum = 1; containerNum <= 3; containerNum++) {
    const containerSchedulesList = schedulesByContainer[containerNum] || [];
    
    if (containerSchedulesList.length > 0) {
      const firstSchedule = containerSchedulesList[0];
      const medicationName = firstSchedule.medicationName || 'Unknown Medication';
      
      containerSchedules[containerNum] = {
        pill: medicationName,
        alarms: containerSchedulesList.map((schedule) => {
          const dateStr = schedule.date;
          const timeStr = schedule.time;
          const combinedDateTime = `${dateStr}T${timeStr}`;
          return new Date(combinedDateTime);
        })
      };
    }
  }
  
  return containerSchedules;
}

// Refresh schedule data
router.post('/refresh-schedule-data/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { selectedElderId } = req.body;

    // This endpoint triggers a refresh of schedule data
    // You can add any additional refresh logic here
    
    res.json({ 
      message: 'Schedule data refreshed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing schedule data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
