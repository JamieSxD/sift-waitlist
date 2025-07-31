const express = require('express');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const fs = require('fs').promises;
const path = require('path');

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

// Save email to file
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
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
];

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Email signup endpoint
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
    
    // Save email
    await saveEmail(email);
    
    res.status(200).json({
      success: true,
      message: "You're on the list. We'll be in touch soon ✨"
    });
    
  } catch (error) {
    if (error.message === 'Email already registered') {
      return res.status(409).json({
        success: false,
        message: "You're already on our list! We'll be in touch soon."
      });
    }
    
    console.error('Error saving email:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again later.'
    });
  }
});

// Get email count (optional admin endpoint)
app.get('/api/count', async (req, res) => {
  try {
    const data = await loadEmails();
    res.json({ count: data.emails.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
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
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);