// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const fs = require('fs').promises;
const path = require('path');

// Import Loops service
const loopsService = require('./services/loopsService');

const app = express();
const PORT = process.env.PORT || 3000;
const EMAIL_FILE = path.join(__dirname, 'emails.json');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize emails file if it doesn't exist
async function initializeEmailFile() {
  try {
    await fs.access(EMAIL_FILE);
  } catch (error) {
    await fs.writeFile(EMAIL_FILE, JSON.stringify({ emails: [] }, null, 2));
  }
}

// Load existing emails
async function loadEmails() {
  try {
    const data = await fs.readFile(EMAIL_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { emails: [] };
  }
}

// Save email to file (keeping your existing backup system)
async function saveEmail(email) {
  try {
    const data = await loadEmails();
    
    // Check if email already exists
    const existingEmail = data.emails.find(e => e.email === email);
    if (existingEmail) {
      throw new Error('Email already registered');
    }
    
    // Add new email with timestamp
    data.emails.push({
      email: email,
      timestamp: new Date().toISOString(),
      id: Date.now()
    });
    
    await fs.writeFile(EMAIL_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    throw error;
  }
}

// Email validation middleware
const validateEmail = [
  body('email')
    .isEmail()
    .trim()  // Just trim whitespace, don't normalize
    .withMessage('Please provide a valid email address')
];

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Email signup endpoint (enhanced with Loops integration)
app.post('/api/signup', validateEmail, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
        errors: errors.array()
      });
    }

    const { email } = req.body;
    console.log(`📝 Processing signup for: ${email}`);
    
    let fileSuccess = false;
    let loopsSuccess = false;
    let isDuplicate = false;

    // 1. Save to file first (your existing system)
    try {
      await saveEmail(email);
      fileSuccess = true;
      console.log(`✅ Email saved to file: ${email}`);
    } catch (error) {
      if (error.message === 'Email already registered') {
        isDuplicate = true;
        console.log(`ℹ️  Email already in file: ${email}`);
      } else {
        console.error('❌ Error saving to file:', error);
      }
    }

    // 2. Add to Loops (new integration)
    try {
      const loopsResult = await loopsService.addToWaitlist(email);
      if (loopsResult.success) {
        loopsSuccess = true;
        console.log(`✅ Email added to Loops: ${email}`);
      } else {
        console.log(`ℹ️  Loops addition failed: ${loopsResult.message}`);
      }
    } catch (error) {
      console.error('❌ Error with Loops integration:', error);
    }

    // 3. Determine response based on results
    if (isDuplicate) {
      // Email already exists - return same message as before
      return res.status(409).json({
        success: false,
        message: "You're already on our list! We'll be in touch soon."
      });
    }

    if (fileSuccess || loopsSuccess) {
      // Success if either method worked
      res.status(200).json({
        success: true,
        message: "You're on the list. We'll be in touch soon ✨"
      });
    } else {
      // Both methods failed
      console.error('❌ Both file and Loops saving failed for:', email);
      res.status(500).json({
        success: false,
        message: 'Something went wrong. Please try again later.'
      });
    }
    
  } catch (error) {
    console.error('❌ Unexpected error in signup:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again later.'
    });
  }
});

// Get email count (enhanced with Loops status)
app.get('/api/count', async (req, res) => {
  try {
    const data = await loadEmails();
    const loopsStatus = loopsService.getStatus();

    res.json({
      count: data.emails.length,
      loops: loopsStatus
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// Health check endpoint (new)
app.get('/api/health', async (req, res) => {
  try {
    const loopsStatus = await loopsService.testConnection();
    res.json({
      server: 'ok',
      loops: loopsStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      server: 'ok',
      loops: { success: false, message: 'Health check failed' },
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again later.'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Initialize and start server
async function startServer() {
  await initializeEmailFile();

  // Test Loops connection on startup
  const loopsStatus = await loopsService.testConnection();
  if (loopsStatus.success) {
    console.log('🚀 Loops integration ready');
  } else {
    console.log('⚠️  Loops integration not available:', loopsStatus.message);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📧 Loops configured: ${loopsService.getStatus().configured ? '✅' : '❌'}`);
  });
}

startServer().catch(console.error);