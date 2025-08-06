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
const { User, NewsletterSource, UserNewsletterSubscription } = require('./models');

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
    secure: false,
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

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    res.redirect('/');
  });
});

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
// MAIN ROUTES
// =================

// Home page with redirect logic
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Dashboard - redirects to onboarding if no content
app.get('/dashboard', requireAuth, async (req, res) => {
  const hasContent = await checkUserHasContent(req.user.id);

  if (!hasContent) {
    return res.redirect('/onboarding');
  }

  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Onboarding flow
app.get('/onboarding', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

// Content type setup pages
app.get('/setup/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const validTypes = ['newsletters', 'youtube', 'music', 'news', 'rss'];

  if (!validTypes.includes(type)) {
    return res.status(404).send('Content type not found');
  }

  res.sendFile(path.join(__dirname, 'public', 'setup-newsletters.html'));
});

// Feedback page
app.get('/feedback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
});

// =================
// CONTENT API ROUTES
// =================

// Get user's content feed
app.get('/api/content/feed', requireAuth, async (req, res) => {
  try {
    const content = await getUserContentFeed(req.user.id);
    res.json({
      success: true,
      content
    });
  } catch (error) {
    console.error('Error fetching content feed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content feed'
    });
  }
});

// Check if user has any content sources
app.get('/api/user/has-content', requireAuth, async (req, res) => {
  try {
    const hasContent = await checkUserHasContent(req.user.id);
    res.json({
      success: true,
      hasContent
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      hasContent: false
    });
  }
});

// =================
// NEWSLETTER API ROUTES
// =================

// Get available newsletters with user subscription status
app.get('/api/newsletters/available', requireAuth, async (req, res) => {
  try {
    const newsletters = await NewsletterSource.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']],
    });

    const userSubscriptions = await UserNewsletterSubscription.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      },
    });

    const subscriptionMap = new Map(
      userSubscriptions.map(sub => [sub.newsletterSourceId, sub])
    );

    const newslettersWithStatus = newsletters.map(newsletter => ({
      id: newsletter.id,
      name: newsletter.name,
      description: newsletter.description,
      website: newsletter.website,
      category: newsletter.category,
      metadata: newsletter.metadata,
      isSubscribed: subscriptionMap.has(newsletter.id),
    }));

    res.json({
      success: true,
      newsletters: newslettersWithStatus,
    });
  } catch (error) {
    console.error('Error fetching newsletters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch newsletters',
    });
  }
});

// Subscribe to a newsletter
app.post('/api/newsletters/subscribe', requireAuth, async (req, res) => {
  try {
    const { newsletterId } = req.body;

    if (!newsletterId) {
      return res.status(400).json({
        success: false,
        message: 'Newsletter ID is required',
      });
    }

    const newsletter = await NewsletterSource.findByPk(newsletterId);
    if (!newsletter) {
      return res.status(404).json({
        success: false,
        message: 'Newsletter not found',
      });
    }

    const existingSubscription = await UserNewsletterSubscription.findOne({
      where: {
        userId: req.user.id,
        newsletterSourceId: newsletterId,
      },
    });

    if (existingSubscription) {
      if (existingSubscription.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Already subscribed to this newsletter',
        });
      } else {
        await existingSubscription.update({ isActive: true });
        return res.json({
          success: true,
          message: 'Subscription reactivated',
          forwardingEmail: existingSubscription.forwardingEmail,
        });
      }
    }

    const forwardingEmail = generateForwardingEmail(req.user.id, newsletterId);

    const subscription = await UserNewsletterSubscription.create({
      userId: req.user.id,
      newsletterSourceId: newsletterId,
      forwardingEmail,
      isActive: true,
    });

    console.log(`✅ User ${req.user.email} subscribed to ${newsletter.name}`);

    res.json({
      success: true,
      message: 'Successfully subscribed',
      forwardingEmail: subscription.forwardingEmail,
    });
  } catch (error) {
    console.error('Error subscribing to newsletter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to newsletter',
    });
  }
});

// Unsubscribe from a newsletter
app.post('/api/newsletters/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { newsletterId } = req.body;

    if (!newsletterId) {
      return res.status(400).json({
        success: false,
        message: 'Newsletter ID is required',
      });
    }

    const subscription = await UserNewsletterSubscription.findOne({
      where: {
        userId: req.user.id,
        newsletterSourceId: newsletterId,
        isActive: true,
      },
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found',
      });
    }

    await subscription.update({ isActive: false });

    const newsletter = await NewsletterSource.findByPk(newsletterId);
    console.log(`❌ User ${req.user.email} unsubscribed from ${newsletter?.name}`);

    res.json({
      success: true,
      message: 'Successfully unsubscribed',
    });
  } catch (error) {
    console.error('Error unsubscribing from newsletter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe from newsletter',
    });
  }
});

// =================
// WAITLIST API ROUTES (for landing page)
// =================

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

// =================
// HELPER FUNCTIONS
// =================

function generateForwardingEmail(userId, newsletterId) {
  const crypto = require('crypto');
  const hash = crypto
    .createHash('md5')
    .update(`${userId}-${newsletterId}-${Date.now()}`)
    .digest('hex')
    .substring(0, 8);

  const domain = process.env.NEWSLETTER_FORWARDING_DOMAIN || 'newsletters.sift.example.com';
  return `newsletter-${hash}@${domain}`;
}

async function checkUserHasContent(userId) {
  try {
    const newsletterCount = await UserNewsletterSubscription.count({
      where: {
        userId,
        isActive: true
      }
    });

    // TODO: Check other content types when implemented
    return newsletterCount > 0;
  } catch (error) {
    console.error('Error checking user content:', error);
    return false;
  }
}

async function getUserContentFeed(userId) {
  try {
    // Mock data for now
    const mockContent = [
      {
        id: 1,
        type: 'newsletter',
        source: { name: 'Morning Brew', icon: 'M' },
        title: 'Tesla\'s surprise quarter, Netflix password crackdown, and more',
        excerpt: 'Tesla shocked everyone by beating delivery expectations despite supply chain challenges...',
        time: '2 hours ago',
        url: '#'
      },
      {
        id: 2,
        type: 'youtube',
        source: { name: 'Marques Brownlee', icon: 'MB' },
        title: 'iPhone 15 Pro Review: Titanium is Tough!',
        excerpt: 'The iPhone 15 Pro brings titanium construction, Action Button, and USB-C...',
        time: '5 hours ago',
        url: '#'
      }
    ];

    return mockContent;
  } catch (error) {
    console.error('Error fetching user content feed:', error);
    throw error;
  }
}

// Waitlist file management functions
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

// =================
// STATIC FILES (AFTER ROUTES)
// =================

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

    await sequelize.authenticate();
    console.log('📊 Database connection established');

    await sequelize.sync();
    console.log('📊 Database models synchronized');

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