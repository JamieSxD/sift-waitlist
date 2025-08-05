require('dotenv').config();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const { body, validationResult } = require('express-validator');
const fs = require('fs').promises;
const path = require('path');

// Import database and models
const sequelize = require('./config/database');
const User = require('./models/User');

// Import authentication
const passport = require('./config/passport');
const { requireAuth } = require('./middleware/auth');

// Import existing services
const loopsService = require('./services/loopsService');

const app = express();
const PORT = process.env.PORT || 3000;
const EMAIL_FILE = path.join(__dirname, 'emails.json');

// Session store
const sessionStore = new SequelizeStore({
  db: sequelize,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Important: must be false for localhost
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// =================
// AUTH ROUTES
// =================

// Google OAuth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

// Logout route
app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.redirect('/');
  });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.user ? {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
    } : null
  });
});

// =================
// MAIN ROUTES (BEFORE STATIC FILES)
// =================

// Home page with redirect logic
app.get('/', (req, res) => {
  console.log('Home route hit, authenticated:', req.isAuthenticated());

  if (req.isAuthenticated()) {
    console.log('Redirecting to dashboard');
    return res.redirect('/dashboard');
  }

  console.log('Serving index.html');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =================
// PROTECTED ROUTES
// =================

// Dashboard (protected)
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Debug routes
app.get('/test-redirect', (req, res) => {
  console.log('Test route - authenticated:', req.isAuthenticated());
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.send('Not authenticated');
});

app.get('/debug', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.user,
    session: req.session
  });
});

// =================
// API ROUTES
// =================

async function initializeEmailFile() {
  try {
    await fs.access(EMAIL_FILE);
  } catch (error) {
    await fs.writeFile(EMAIL_FILE, JSON.stringify({ emails: [] }, null, 2));
  }
}

async function loadEmails() {
  try {
    const data = await fs.readFile(EMAIL_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { emails: [] };
  }
}

async function saveEmail(email) {
  try {
    const data = await loadEmails();
    const existingEmail = data.emails.find(e => e.email === email);
    if (existingEmail) {
      throw new Error('Email already registered');
    }
    
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

const validateEmail = [
  body('email').isEmail().trim().withMessage('Please provide a valid email address')
];

app.post('/api/signup', validateEmail, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
        errors: errors.array()
      });
    }

    const { email } = req.body;
    console.log(`📝 Processing waitlist signup for: ${email}`);
    
    let fileSuccess = false;
    let loopsSuccess = false;
    let isDuplicate = false;

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

    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        message: "You're already on our list! We'll be in touch soon."
      });
    }

    if (fileSuccess || loopsSuccess) {
      res.status(200).json({
        success: true,
        message: "You're on the list. We'll be in touch soon ✨"
      });
    } else {
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

// Feedback page
app.get('/feedback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
});

// =================
// STATIC FILES (AFTER ROUTES)
// =================

// Static files - MUST come after route definitions
app.use(express.static('public'));

// =================
// ERROR HANDLING
// =================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong. Please try again later.'
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// =================
// SERVER STARTUP
// =================

async function startServer() {
  try {
    await initializeEmailFile();

    // Initialize database
    await sequelize.authenticate();
    console.log('📊 Database connection established');

    // Sync database models
    await sequelize.sync();
    console.log('📊 Database models synchronized');

    // Create session table
    await sessionStore.sync();
    console.log('📊 Session store synchronized');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`🔐 Google OAuth configured: ${process.env.GOOGLE_CLIENT_ID ? '✅' : '❌'}`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();