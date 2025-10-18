const express = require('express');
const { body, validationResult } = require('express-validator');
const { auth, requireAdminOrCaregiver } = require('../middleware/auth');
const MedicationSchedule = require('../models/MedicationSchedule');
const User = require('../models/User');

const router = express.Router();

// Get all notifications for a user (caregiver can see elder's notifications)
router.get('/', auth, async (req, res) => {
  try {
    const { userId, type = 'all', status = 'active' } = req.query;
    
    // Determine target user
    let targetUserId = req.user.userId;
    if (userId && (req.user.role === 1 || req.user.role === 3)) {
      targetUserId = userId;
    }
    
    let query = { userId: targetUserId };
    
    // Filter by type
    if (type === 'medication') {
      query.medicationName = { $exists: true };
    } else if (type === 'reminder') {
      query.type = 'reminder';
    }
    
    // Filter by status
    if (status === 'active') {
      query.isActive = true;
      query.$or = [
        { endDate: null },
        { endDate: { $gt: new Date() } }
      ];
    } else if (status === 'inactive') {
      query.isActive = false;
    }
    
    const schedules = await MedicationSchedule.find(query)
      .sort({ createdAt: -1 });
    
    // Convert schedules to notifications
    const notifications = schedules.map(schedule => ({
      id: schedule._id,
      type: 'medication',
      title: `Medication Reminder: ${schedule.medicationName}`,
      message: `Time to take ${schedule.dosage} of ${schedule.medicationName}`,
      scheduledTime: schedule.timeSlots[0]?.time || '08:00',
      medicationName: schedule.medicationName,
      dosage: schedule.dosage,
      containerId: schedule.container || 1,
      isActive: schedule.isActive,
      createdAt: schedule.createdAt
    }));
    
    res.json({
      success: true,
      notifications
    });
    
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching notifications'
    });
  }
});

// Create test notification/alarm (for the Test Alarm button)
router.post('/test-alarm', auth, requireAdminOrCaregiver, [
  body('medicationName').optional().trim().isLength({ min: 1 }).withMessage('Medication name is required'),
  body('containerId').optional().isInt({ min: 1, max: 3 }).withMessage('Container ID must be 1, 2, or 3'),
  body('scheduledTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid time format (HH:MM) is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { medicationName = 'Losartan', containerId = 1, scheduledTime = '08:00 AM' } = req.body;
    
    // Create a test notification
    const testNotification = {
      id: `test_${Date.now()}`,
      type: 'test_alarm',
      title: `Test Alarm: ${medicationName}`,
      message: `Test notification for ${medicationName} in container ${containerId}`,
      medicineName: medicationName,
      containerId: parseInt(containerId),
      scheduledTime,
      isTest: true,
      createdAt: new Date()
    };
    
    res.json({
      success: true,
      message: 'Test alarm created successfully',
      notification: testNotification
    });
    
  } catch (error) {
    console.error('Error creating test alarm:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating test alarm'
    });
  }
});

// Mark notification as read/dismissed
router.put('/:notificationId/dismiss', auth, async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    // For test notifications, just return success
    if (notificationId.startsWith('test_')) {
      return res.json({
        success: true,
        message: 'Test notification dismissed'
      });
    }
    
    // For real medication schedules, you could add a dismissed field
    // For now, we'll just return success
    res.json({
      success: true,
      message: 'Notification dismissed'
    });
    
  } catch (error) {
    console.error('Error dismissing notification:', error);
    res.status(500).json({
      success: false,
      message: 'Server error dismissing notification'
    });
  }
});

// Get upcoming medication reminders
router.get('/upcoming', auth, async (req, res) => {
  try {
    const { userId, hours = 24 } = req.query;
    
    // Determine target user
    let targetUserId = req.user.userId;
    if (userId && (req.user.role === 1 || req.user.role === 3)) {
      targetUserId = userId;
    }
    
    const now = new Date();
    const futureTime = new Date(now.getTime() + (parseInt(hours) * 60 * 60 * 1000));
    
    const schedules = await MedicationSchedule.find({
      userId: targetUserId,
      isActive: true,
      $or: [
        { endDate: null },
        { endDate: { $gt: now } }
      ]
    });
    
    const upcomingReminders = [];
    
    schedules.forEach(schedule => {
      schedule.timeSlots.forEach(slot => {
        if (slot.isActive) {
          const [hours, minutes] = slot.time.split(':').map(Number);
          const reminderTime = new Date();
          reminderTime.setHours(hours, minutes, 0, 0);
          
          // If time has passed today, set for tomorrow
          if (reminderTime <= now) {
            reminderTime.setDate(reminderTime.getDate() + 1);
          }
          
          if (reminderTime <= futureTime) {
            upcomingReminders.push({
              id: `${schedule._id}_${slot.time}`,
              medicationName: schedule.medicationName,
              dosage: schedule.dosage,
              scheduledTime: slot.time,
              reminderDateTime: reminderTime,
              containerId: schedule.container || 1,
              scheduleId: schedule._id
            });
          }
        }
      });
    });
    
    // Sort by reminder time
    upcomingReminders.sort((a, b) => a.reminderDateTime - b.reminderDateTime);
    
    res.json({
      success: true,
      upcomingReminders
    });
    
  } catch (error) {
    console.error('Error fetching upcoming reminders:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching upcoming reminders'
    });
  }
});

module.exports = router;
