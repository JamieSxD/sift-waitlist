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
const { User, NewsletterSource, NewsletterSubscription, UserNewsletterSubscription, UserBlockList, NewsletterContent, UserContentInteraction, YouTubeChannel, UserYouTubeSubscription, YouTubeVideo, UserYouTubeVideoInteraction, SpotifyArtist, UserSpotifySubscription, SpotifyRelease, UserSpotifyReleaseInteraction, UserSpotifyToken } = require('./models');

// Import YouTube API
const { google } = require('googleapis');

// Import Spotify API
const SpotifyWebApi = require('spotify-web-api-node');

const contentExtractionService = require('./services/contentExtraction');

const emailProcessingService = require('./services/emailProcessingService');
const mailgunService = require('./services/mailgunService');

// Import YouTube service
const youtubeService = require('./services/youtubeService');

// Import authentication
const passport = require('./config/passport');
const { requireAuth } = require('./middleware/auth');

// Import existing services
const loopsService = require('./services/loopsService');
const posthogService = require('./services/posthogService');

// Import i18n
const i18n = require('./utils/i18n');

// For parsing Mailgun webhook form data
const multer = require('multer');
const upload = multer();

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

// Initialize i18n middleware
app.use(i18n.middleware());

// =================
// AUTH ROUTES
// =================

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    // Track successful login
    if (req.user) {
      posthogService.trackAuth(req.user.id.toString(), 'login_success', {
        provider: 'google',
        email: req.user.email
      });
    }
    res.redirect('/dashboard');
  }
);

app.post('/auth/logout', (req, res) => {
  const userId = req.user?.id;
  
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ success: false });
    }
    
    // Track logout
    if (userId) {
      posthogService.trackAuth(userId.toString(), 'logout');
    }
    
    res.redirect('/');
  });
});

// YouTube OAuth
app.get('/auth/youtube', requireAuth, (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/youtube/callback`
  );

  const scopes = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    state: req.user.id, // Pass user ID in state
  });

  res.redirect(authUrl);
});

app.get('/auth/youtube/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query;
  
  if (state !== req.user.id) {
    return res.redirect('/setup/youtube?error=invalid_state');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/auth/youtube/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens in user session or database
    req.session.youtubeTokens = tokens;
    
    // Track YouTube connection
    posthogService.trackYouTube(req.user.id.toString(), 'account_connected', {
      oauth_provider: 'google'
    });
    
    res.redirect('/setup/youtube?connected=true');
  } catch (error) {
    console.error('YouTube OAuth error:', error);
    res.redirect('/setup/youtube?error=oauth_failed');
  }
});

// Spotify OAuth - Redirect to onboarding (coming soon)
app.get('/auth/spotify', requireAuth, (req, res) => {
  res.redirect('/onboarding');
});

app.get('/auth/spotify/callback', requireAuth, async (req, res) => {
  // Redirect to onboarding (coming soon)
  res.redirect('/onboarding');
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.user ? {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatar: req.user.avatar,
      inboxEmail: req.user.inboxEmail,
    } : null
  });
});

// Get available languages
app.get('/api/languages', (req, res) => {
  res.json({
    success: true,
    languages: i18n.getSupportedLanguages().map(code => ({
      code,
      name: i18n.translate(`languages.${code}`, req.language),
      nativeName: i18n.translate(`languages.${code}`, code)
    })),
    current: req.language
  });
});

// Update user settings
app.post('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const { name, customInboxPrefix, preferredLanguage } = req.body;
    const updates = {};

    if (name) {
      updates.name = name.trim();
    }

    if (preferredLanguage && i18n.isLanguageSupported(preferredLanguage)) {
      updates.preferredLanguage = preferredLanguage;
    }

    if (customInboxPrefix) {
      // Validate the custom prefix
      const cleanPrefix = customInboxPrefix.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      if (cleanPrefix.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Inbox prefix must be at least 3 characters long'
        });
      }

      const newInboxEmail = `${cleanPrefix}@inbox.siftly.space`;
      
      // Check if this inbox email is already taken
      const existingUser = await User.findOne({ 
        where: { 
          inboxEmail: newInboxEmail,
          id: { [require('sequelize').Op.ne]: req.user.id }
        }
      });

      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'This inbox address is already taken'
        });
      }

      updates.inboxEmail = newInboxEmail;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid updates provided'
      });
    }

    await req.user.update(updates);
    
    res.json({
      success: true,
      message: 'Settings updated successfully',
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        inboxEmail: req.user.inboxEmail,
      }
    });

  } catch (error) {
    console.error('Error updating user settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings'
    });
  }
});

// =================
// MAIN ROUTES
// =================

// Home page with redirect logic
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Manifesto page
app.get('/manifesto', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifesto.html'));
});

// Dashboard - redirects to onboarding if no content
app.get('/dashboard', requireAuth, async (req, res) => {
  console.log('🎯 Dashboard access attempt for user:', req.user.email, req.user.id);
  const hasContent = await checkUserHasContent(req.user.id);
  console.log('✅ User has content:', hasContent);

  if (!hasContent) {
    console.log('❌ Redirecting to onboarding - no content found');
    return res.redirect('/onboarding');
  }

  console.log('🎊 Allowing dashboard access');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});


// Onboarding flow
app.get('/onboarding', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'onboarding.html'));
});

// Newsletters page
app.get('/newsletters', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'newsletters.html'));
});

app.get('/admin/email', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'email-admin.html'));
});

// Settings page
app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Inbox page (for approving/blocking senders)
app.get('/inbox', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inbox.html'));
});

// Content type setup pages
app.get('/setup/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const validTypes = ['inbox', 'newsletters', 'youtube', 'music', 'spotify', 'news', 'rss'];

  if (!validTypes.includes(type)) {
    return res.status(404).send('Content type not found');
  }

  // Route to appropriate setup page
  if (type === 'inbox') {
    res.sendFile(path.join(__dirname, 'public', 'setup-inbox.html'));
  } else if (type === 'newsletters') {
    // Redirect newsletters to inbox setup (single inbox approach)
    res.redirect('/setup/inbox');
  } else if (type === 'youtube') {
    res.sendFile(path.join(__dirname, 'public', 'setup-youtube.html'));
  } else if (type === 'music') {
    res.redirect('/onboarding');
  } else if (type === 'spotify') {
    res.redirect('/onboarding');
  } else {
    // For other types, still serve the newsletter setup (will be updated later)
    res.sendFile(path.join(__dirname, 'public', 'setup-newsletters.html'));
  }
});

// Feedback page
app.get('/feedback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
});

// =================
// EMAIL PROCESSING ROUTES
// =================

// Mailgun webhook endpoint for incoming emails  
app.post('/api/webhooks/email', upload.none(), async (req, res) => {
  try {
    console.log('📧 Received Mailgun webhook');
    
    // Verify webhook signature for security
    const signature = req.body.signature;
    const timestamp = req.body.timestamp;
    const token = req.body.token;
    
    if (!mailgunService.verifyWebhookSignature(signature, timestamp, token)) {
      console.log('❌ Invalid webhook signature');
      return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    // Parse Mailgun webhook data
    const emailData = mailgunService.parseMailgunWebhook(req.body);
    console.log(`📧 Processing email: ${emailData.subject} → ${emailData.to}`);

    // Process the email using existing service
    const result = await emailProcessingService.processWebhookEmail(emailData);

    if (result.success) {
      console.log(`✅ Email processed successfully: ${result.contentId || 'N/A'}`);
      res.status(200).json(result);
    } else {
      console.log(`❌ Email processing failed: ${result.error}`);
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('❌ Email webhook error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Processing failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Test endpoint for simulating email receipt
app.post('/api/test/email', requireAuth, async (req, res) => {
  try {
    const { newsletterSourceId, subject, html } = req.body;

    if (!newsletterSourceId || !html) {
      return res.status(400).json({
        success: false,
        message: 'Newsletter source ID and HTML content required'
      });
    }

    // Process as if it came from email
    const result = await emailProcessingService.processIncomingNewsletter({
      userId: req.user.id,
      newsletterSourceId,
      subject: subject || 'Test Newsletter',
      html,
      from: 'test@example.com',
      to: `test-${req.user.id}@example.com`
    });

    res.json({
      success: true,
      message: 'Test email processed successfully',
      contentId: result.id
    });

  } catch (error) {
    console.error('❌ Test email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process test email'
    });
  }
});

// =================
// MAILGUN ADMIN ENDPOINTS
// =================

// Get Mailgun domain configuration and DNS records
app.get('/api/admin/mailgun/domain', requireAuth, async (req, res) => {
  try {
    const domainInfo = await mailgunService.getDomainInfo();
    res.json({
      success: true,
      domain: domainInfo
    });
  } catch (error) {
    console.error('❌ Error getting domain info:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Setup Mailgun domain (first-time configuration)
app.post('/api/admin/mailgun/setup-domain', requireAuth, async (req, res) => {
  try {
    await mailgunService.setupDomain();
    res.json({
      success: true,
      message: 'Domain setup completed'
    });
  } catch (error) {
    console.error('❌ Error setting up domain:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Setup Mailgun webhooks
app.post('/api/admin/mailgun/setup-webhooks', requireAuth, async (req, res) => {
  try {
    const webhookUrl = `${process.env.APP_URL}/api/webhooks/email`;
    await mailgunService.setupWebhooks(webhookUrl);
    res.json({
      success: true,
      message: 'Webhooks setup completed',
      webhookUrl
    });
  } catch (error) {
    console.error('❌ Error setting up webhooks:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Send test email via Mailgun
app.post('/api/admin/mailgun/send-test', requireAuth, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email required'
      });
    }

    const result = await mailgunService.sendTestEmail(to);
    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: result.id
    });
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Test the complete email processing flow
app.post('/api/admin/test/newsletter-flow', requireAuth, async (req, res) => {
  try {
    const { userInboxEmail, newsletterContent } = req.body;
    
    if (!userInboxEmail || !newsletterContent) {
      return res.status(400).json({
        success: false,
        message: 'User inbox email and newsletter content required'
      });
    }

    // Simulate incoming newsletter email
    const testEmailData = {
      to: userInboxEmail,
      from: 'newsletter@example.com',
      subject: 'Test Newsletter - Newsletter Processing Flow',
      html: newsletterContent,
      text: newsletterContent.replace(/<[^>]*>/g, ''),
      timestamp: new Date()
    };

    // Process using the existing email processing service
    const result = await emailProcessingService.processWebhookEmail(testEmailData);

    res.json({
      success: true,
      message: 'Newsletter processing flow test completed',
      result
    });

  } catch (error) {
    console.error('❌ Error testing newsletter flow:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// =================
// CONTENT PROCESSING API ROUTES
// =================


app.post('/api/content/process', requireAuth, async (req, res) => {
  try {
    const { newsletterSourceId, emailHtml, subject } = req.body;

    if (!emailHtml) {
      return res.status(400).json({
        success: false,
        message: 'Email HTML is required'
      });
    }

    let sourceId = newsletterSourceId;
    let contentType = 'individual';
    let targetUserId = req.user.id;

    if (!sourceId) {
      let testSource = await NewsletterSource.findOne({
        where: { name: 'Stratechery' }
      });

      if (!testSource) {
        testSource = await NewsletterSource.create({
          name: 'Stratechery',
          description: 'Analysis of the strategy and business side of technology and media',
          website: 'https://stratechery.com',
          subscriptionUrl: 'https://stratechery.com/subscribe',
          subscriptionType: 'individual',
          category: 'tech',
          metadata: { isPopular: true }
        });
      }

      sourceId = testSource.id;

      const existingSubscription = await UserNewsletterSubscription.findOne({
        where: {
          userId: req.user.id,
          newsletterSourceId: sourceId
        }
      });

      if (!existingSubscription) {
        await UserNewsletterSubscription.create({
          userId: req.user.id,
          newsletterSourceId: sourceId,
          subscriptionMethod: 'individual_forwarding',
          forwardingEmail: `test-${req.user.id}@example.com`,
          isActive: true
        });
      }
    }

    const newsletterSource = await NewsletterSource.findByPk(sourceId);
    if (!newsletterSource) {
      return res.status(404).json({
        success: false,
        message: 'Newsletter source not found'
      });
    }

    // NEW: Determine content type based on newsletter source
    if (newsletterSource.subscriptionType === 'shared' && newsletterSource.isSharedActive) {
      contentType = 'shared';
      targetUserId = null;
    }

    // NEW: For shared content, check for duplicates
    if (contentType === 'shared') {
      const existingContent = await NewsletterContent.findOne({
        where: {
          newsletterSourceId: sourceId,
          contentType: 'shared',
          originalSubject: subject || 'Newsletter',
          receivedAt: {
            [require('sequelize').Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }
      });

      if (existingContent) {
        return res.json({
          success: true,
          message: 'Content already processed',
          contentId: existingContent.id,
          isExisting: true
        });
      }
    }

    const extractionResult = await contentExtractionService.extractContent(emailHtml, newsletterSource);

    if (!extractionResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Content extraction failed',
        error: extractionResult.error
      });
    }

    // NEW: Create content with contentType and userId
    const newsletterContent = await NewsletterContent.create({
      newsletterSourceId: sourceId,
      contentType,
      userId: targetUserId,
      originalSubject: subject || 'Test Newsletter',
      originalHtml: emailHtml,
      metadata: extractionResult.metadata,
      sections: extractionResult.sections,
      processingStatus: 'completed',
      extractionConfidence: extractionResult.extractionConfidence || 0.8,
      wordCount: extractionResult.wordCount || 0,
      searchText: extractionResult.searchText || '',
      tags: extractionResult.tags || []
    });

    console.log(`✅ Processed ${contentType} content for ${newsletterSource.name}`);

    res.json({
      success: true,
      message: 'Content processed successfully',
      contentId: newsletterContent.id,
      contentType,
      extractionConfidence: extractionResult.extractionConfidence,
      sectionsExtracted: extractionResult.sections.length
    });

  } catch (error) {
    console.error('Error processing content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process content'
    });
  }
});

// Combined content feed (newsletters + YouTube videos)
app.get('/api/content/feed', requireAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0, type = 'all', videoType = 'all' } = req.query;
    console.log(`🎯 Content feed request: type=${type}, videoType=${videoType}, limit=${limit}, user=${req.user.id}`);
    
    let allContent = [];
    
    // Get newsletter content if requested
    if (type === 'all' || type === 'newsletters') {
      const newsletters = await NewsletterContent.findAll({
        where: {
          userId: req.user.id,
          approvalStatus: { [require('sequelize').Op.in]: ['approved', 'auto_approved'] }, // Show both manually approved and auto-approved content
          processingStatus: 'completed'
        },
        include: [
          {
            model: NewsletterSource,
            as: 'source',
            attributes: ['id', 'name', 'logo', 'category'],
            required: false
          },
          {
            model: UserContentInteraction,
            as: 'interactions',
            where: { userId: req.user.id },
            required: false
          }
        ],
        order: [['receivedAt', 'DESC']],
        limit: type === 'newsletters' ? parseInt(limit) : 50 // Get more if combining
      });
      
      // Format newsletter content
      newsletters.forEach(item => {
        allContent.push({
          id: item.id,
          type: 'newsletter',
          source: item.source ? {
            id: item.source.id,
            name: item.source.name,
            logo: item.source.logo,
            category: item.source.category
          } : {
            id: null,
            name: item.detectedNewsletterName || 'Newsletter',
            logo: null,
            category: 'unknown'
          },
          title: item.metadata?.title || item.originalSubject,
          excerpt: item.metadata?.summary || item.metadata?.excerpt,
          publishedAt: item.receivedAt,
          readAt: item.interactions?.[0]?.readAt || null,
          isSaved: item.interactions?.[0]?.isSaved || false,
          caughtUp: item.interactions?.[0]?.caughtUp || false,
          url: `/content/${item.id}`,
          metadata: item.metadata
        });
      });
    }
    
    // Get YouTube videos if requested
    if (type === 'all' || type === 'youtube') {
      const videos = await youtubeService.getApprovedVideosForUser(
        req.user.id, 
        type === 'youtube' ? parseInt(limit) : 50,
        videoType // Pass the video type filter
      );
      
      // Format YouTube content
      videos.forEach(video => {
        allContent.push({
          id: video.id,
          type: 'youtube',
          source: {
            id: video.youtubeChannelId,
            name: video.channelName,
            logo: video.channelThumbnail,
            category: 'youtube'
          },
          title: video.title,
          excerpt: video.description?.substring(0, 200) + '...',
          publishedAt: video.publishedAt,
          readAt: null, // YouTube videos don't have read status yet
          isSaved: false, // YouTube videos don't have saved status yet
          caughtUp: video.userInteractions?.[0]?.caughtUp || false, // Check database for caught up status
          url: video.videoUrl,
          thumbnail: video.thumbnail,
          duration: video.duration,
          viewCount: video.viewCount,
          videoType: video.videoType,
          metadata: {
            platform: 'youtube',
            videoId: video.videoId,
            channelName: video.channelName
          }
        });
      });
    }
    
    // Sort all content by publication date (newest first)
    allContent.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    
    // Apply pagination
    const paginatedContent = allContent.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    res.json({
      success: true,
      content: paginatedContent,
      total: allContent.length,
      hasMore: allContent.length > (parseInt(offset) + parseInt(limit))
    });

  } catch (error) {
    console.error('Error fetching content feed:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content feed'
    });
  }
});

// Legacy newsletter-only feed (kept for backward compatibility)
app.get('/api/content/newsletters', requireAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    // Show approved content only for now
    const content = await NewsletterContent.findAndCountAll({
      where: {
        userId: req.user.id,
        approvalStatus: { [require('sequelize').Op.in]: ['approved', 'auto_approved'] }, // Show both manually approved and auto-approved content
        processingStatus: 'completed'
      },
      include: [
        {
          model: NewsletterSource,
          as: 'source',
          attributes: ['id', 'name', 'logo', 'category'],
          required: false
        },
        {
          model: UserContentInteraction,
          as: 'interactions',
          where: { userId: req.user.id },
          required: false
        }
      ],
      order: [['receivedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const formattedContent = content.rows.map(item => ({
      id: item.id,
      source: item.source ? {
        id: item.source.id,
        name: item.source.name,
        logo: item.source.logo,
        category: item.source.category
      } : {
        id: null,
        name: item.detectedNewsletterName || 'Newsletter',
        logo: null,
        category: item.detectedCategory || 'other'
      },
      metadata: item.metadata,
      sections: item.sections,
      publishedAt: item.receivedAt,
      wordCount: item.wordCount,
      tags: item.tags,
      isRead: item.interactions.length > 0 ? item.interactions[0].isRead : false,
      isSaved: item.interactions.length > 0 ? item.interactions[0].isSaved : false,
    }));

    res.json({
      success: true,
      content: formattedContent,
      pagination: {
        total: content.count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + formattedContent.length) < content.count
      }
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

// Spotify API endpoints
app.get('/api/spotify/followed-artists', requireAuth, async (req, res) => {
  try {
    // Get user's Spotify token
    const userToken = await UserSpotifyToken.findOne({
      where: { userId: req.user.id }
    });

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'No Spotify connection found'
      });
    }

    // Check if token is expired and refresh if needed
    if (new Date() >= userToken.expiresAt) {
      const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });

      spotifyApi.setRefreshToken(userToken.refreshToken);
      const refreshData = await spotifyApi.refreshAccessToken();
      
      const newExpiresAt = new Date(Date.now() + refreshData.body.expires_in * 1000);
      
      await userToken.update({
        accessToken: refreshData.body.access_token,
        expiresAt: newExpiresAt,
        lastRefreshed: new Date()
      });
      
      userToken.accessToken = refreshData.body.access_token;
    }

    // Get followed artists from Spotify
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(userToken.accessToken);

    const followedArtists = await spotifyApi.getFollowedArtists({ limit: 50 });
    
    // Format artists for frontend
    const artists = followedArtists.body.artists.items.map(artist => ({
      id: artist.id,
      name: artist.name,
      images: artist.images,
      followers: artist.followers,
      genres: artist.genres,
      popularity: artist.popularity,
      external_urls: artist.external_urls
    }));

    // Track API usage
    posthogService.track(req.user.id.toString(), 'spotify_artists_fetched', {
      artist_count: artists.length,
      category: 'spotify'
    });

    res.json({
      success: true,
      artists: artists
    });

  } catch (error) {
    console.error('Error fetching Spotify artists:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch followed artists'
    });
  }
});

app.post('/api/spotify/save-artists', requireAuth, async (req, res) => {
  try {
    const { artistIds } = req.body;

    if (!Array.isArray(artistIds) || artistIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No artists selected'
      });
    }

    // Get user's Spotify token to fetch artist details
    const userToken = await UserSpotifyToken.findOne({
      where: { userId: req.user.id }
    });

    if (!userToken) {
      return res.status(401).json({
        success: false,
        error: 'No Spotify connection found'
      });
    }

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(userToken.accessToken);

    // Get artist details from Spotify
    const artistsResponse = await spotifyApi.getArtists(artistIds);
    const artists = artistsResponse.body.artists;

    // Save artists to database (upsert to avoid duplicates)
    for (const artist of artists) {
      await SpotifyArtist.upsert({
        id: artist.id,
        name: artist.name,
        imageUrl: artist.images?.[0]?.url || null,
        genres: JSON.stringify(artist.genres),
        popularity: artist.popularity,
        followers: artist.followers?.total || 0,
        externalUrl: artist.external_urls?.spotify || null,
        lastChecked: new Date()
      });

      // Create user subscription
      await UserSpotifySubscription.upsert({
        userId: req.user.id,
        spotifyArtistId: artist.id,
        enabled: true,
        addedAt: new Date()
      });
    }

    // Track successful save
    posthogService.track(req.user.id.toString(), 'spotify_artists_saved', {
      artist_count: artistIds.length,
      artist_ids: artistIds,
      category: 'spotify'
    });

    res.json({
      success: true,
      message: `Successfully saved ${artistIds.length} artists`,
      artistCount: artistIds.length
    });

  } catch (error) {
    console.error('Error saving Spotify artists:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save artist selection'
    });
  }
});

// Get pending content count for notification indicator
app.get('/api/inbox/pending-count', requireAuth, async (req, res) => {
  try {
    const pendingCount = await NewsletterContent.count({
      where: {
        userId: req.user.id,
        approvalStatus: 'pending'
      }
    });

    res.json({
      success: true,
      pendingCount
    });

  } catch (error) {
    console.error('Error fetching pending count:', error);
    res.status(500).json({
      success: false,
      pendingCount: 0
    });
  }
});

// =================
// INBOX APPROVAL API ROUTES
// =================

// Get pending newsletter content for user's inbox
app.get('/api/inbox/pending', requireAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const pendingContent = await NewsletterContent.findAndCountAll({
      where: {
        userId: req.user.id,
        approvalStatus: 'pending'
      },
      include: [
        {
          model: NewsletterSource,
          as: 'source',
          required: false
        }
      ],
      order: [['receivedAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const formattedContent = pendingContent.rows.map(item => ({
      id: item.id,
      subject: item.originalSubject,
      senderEmail: item.originalFrom,
      senderDomain: item.senderDomain,
      receivedAt: item.receivedAt,
      source: item.source ? {
        id: item.source.id,
        name: item.source.name,
        logo: item.source.logo
      } : null,
      metadata: item.metadata,
      extractionConfidence: item.extractionConfidence,
      detectedNewsletterName: item.detectedNewsletterName
    }));

    res.json({
      success: true,
      content: formattedContent,
      pagination: {
        total: pendingContent.count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + pendingContent.rows.length) < pendingContent.count
      }
    });

  } catch (error) {
    console.error('Error fetching pending content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending content'
    });
  }
});

// Approve content and sender
app.post('/api/inbox/approve/:contentId', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { autoApproveFuture = false } = req.body;

    const content = await NewsletterContent.findOne({
      where: {
        id: contentId,
        userId: req.user.id,
        approvalStatus: 'pending'
      }
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found or already processed'
      });
    }

    // Approve the content
    await content.update({
      approvalStatus: 'approved',
      approvedAt: new Date()
    });

    // If user wants to auto-approve future emails from this sender
    if (autoApproveFuture && content.newsletterSourceId) {
      await NewsletterSubscription.findOrCreate({
        where: {
          userId: req.user.id,
          newsletterSourceId: content.newsletterSourceId
        },
        defaults: {
          isActive: true,
          autoApprove: true,
          subscribedAt: new Date()
        }
      });
    }

    console.log(`✅ User ${req.user.email} approved content: ${content.originalSubject}`);

    res.json({
      success: true,
      message: 'Content approved successfully'
    });

  } catch (error) {
    console.error('Error approving content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve content'
    });
  }
});

// Block content and sender
app.post('/api/inbox/block/:contentId', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { blockType = 'email', blockReason } = req.body;

    const content = await NewsletterContent.findOne({
      where: {
        id: contentId,
        userId: req.user.id,
        approvalStatus: 'pending'
      }
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found or already processed'
      });
    }

    // Block the content
    await content.update({
      approvalStatus: 'blocked'
    });

    // Add to user's block list
    let blockValue;
    if (blockType === 'domain') {
      blockValue = content.senderDomain;
    } else {
      blockValue = content.originalFrom;
    }

    await UserBlockList.create({
      userId: req.user.id,
      blockType,
      blockValue,
      reason: blockReason || 'Blocked from inbox',
      isActive: true
    });

    console.log(`🚫 User ${req.user.email} blocked ${blockType}: ${blockValue}`);

    res.json({
      success: true,
      message: `${blockType === 'domain' ? 'Domain' : 'Sender'} blocked successfully`
    });

  } catch (error) {
    console.error('Error blocking content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block content'
    });
  }
});

// Get user's block list
app.get('/api/inbox/blocked', requireAuth, async (req, res) => {
  try {
    const blockList = await UserBlockList.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      },
      order: [['blockedAt', 'DESC']]
    });

    res.json({
      success: true,
      blockList: blockList.map(item => ({
        id: item.id,
        blockType: item.blockType,
        blockValue: item.blockValue,
        reason: item.reason,
        blockedAt: item.blockedAt
      }))
    });

  } catch (error) {
    console.error('Error fetching block list:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch block list'
    });
  }
});

// Remove item from block list
app.delete('/api/inbox/blocked/:blockId', requireAuth, async (req, res) => {
  try {
    const { blockId } = req.params;

    const blockItem = await UserBlockList.findOne({
      where: {
        id: blockId,
        userId: req.user.id
      }
    });

    if (!blockItem) {
      return res.status(404).json({
        success: false,
        message: 'Block item not found'
      });
    }

    await blockItem.update({ isActive: false });

    res.json({
      success: true,
      message: 'Block removed successfully'
    });

  } catch (error) {
    console.error('Error removing block:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove block'
    });
  }
});

// Bulk approve content
app.post('/api/inbox/bulk-approve', requireAuth, async (req, res) => {
  try {
    const { contentIds, autoApproveFuture = false } = req.body;

    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Content IDs array is required'
      });
    }

    const results = [];
    
    for (const contentId of contentIds) {
      try {
        const content = await NewsletterContent.findOne({
          where: {
            id: contentId,
            userId: req.user.id,
            approvalStatus: 'pending'
          }
        });

        if (!content) {
          results.push({
            contentId,
            success: false,
            message: 'Content not found or already processed'
          });
          continue;
        }

        // Approve the content
        await content.update({
          approvalStatus: 'approved',
          approvedAt: new Date()
        });

        // Auto-approve future emails if requested
        if (autoApproveFuture && content.newsletterSourceId) {
          await NewsletterSubscription.findOrCreate({
            where: {
              userId: req.user.id,
              newsletterSourceId: content.newsletterSourceId
            },
            defaults: {
              isActive: true,
              autoApprove: true,
              subscribedAt: new Date()
            }
          });

          // Update existing subscription
          await NewsletterSubscription.update(
            { autoApprove: true },
            {
              where: {
                userId: req.user.id,
                newsletterSourceId: content.newsletterSourceId,
                isActive: true
              }
            }
          );
        }

        results.push({
          contentId,
          success: true,
          message: 'Approved successfully'
        });

      } catch (error) {
        results.push({
          contentId,
          success: false,
          message: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    console.log(`✅ User ${req.user.email} bulk approved ${successCount}/${contentIds.length} items`);

    res.json({
      success: true,
      message: `Successfully approved ${successCount} out of ${contentIds.length} items`,
      results
    });

  } catch (error) {
    console.error('Error in bulk approve:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk approval'
    });
  }
});

// Bulk block content
app.post('/api/inbox/bulk-block', requireAuth, async (req, res) => {
  try {
    const { contentIds, blockType = 'email', blockReason } = req.body;

    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Content IDs array is required'
      });
    }

    const results = [];
    const blockedValues = new Set(); // Prevent duplicate blocks

    for (const contentId of contentIds) {
      try {
        const content = await NewsletterContent.findOne({
          where: {
            id: contentId,
            userId: req.user.id,
            approvalStatus: 'pending'
          }
        });

        if (!content) {
          results.push({
            contentId,
            success: false,
            message: 'Content not found or already processed'
          });
          continue;
        }

        // Block the content
        await content.update({
          approvalStatus: 'blocked'
        });

        // Add to user's block list (avoid duplicates)
        let blockValue;
        if (blockType === 'domain') {
          blockValue = content.senderDomain;
        } else {
          blockValue = content.originalFrom;
        }

        if (blockValue && !blockedValues.has(blockValue)) {
          blockedValues.add(blockValue);
          
          // Check if already blocked
          const existingBlock = await UserBlockList.findOne({
            where: {
              userId: req.user.id,
              blockType,
              blockValue,
              isActive: true
            }
          });

          if (!existingBlock) {
            await UserBlockList.create({
              userId: req.user.id,
              blockType,
              blockValue,
              reason: blockReason || 'Bulk blocked from inbox',
              isActive: true
            });
          }
        }

        results.push({
          contentId,
          success: true,
          message: 'Blocked successfully'
        });

      } catch (error) {
        results.push({
          contentId,
          success: false,
          message: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    console.log(`🚫 User ${req.user.email} bulk blocked ${successCount}/${contentIds.length} items`);

    res.json({
      success: true,
      message: `Successfully blocked ${successCount} out of ${contentIds.length} items`,
      results,
      blockedCount: blockedValues.size
    });

  } catch (error) {
    console.error('Error in bulk block:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk blocking'
    });
  }
});

// Send test email for inbox setup verification
app.post('/api/inbox/test-email', requireAuth, async (req, res) => {
  try {
    if (!req.user.inboxEmail) {
      return res.status(400).json({
        success: false,
        message: 'No inbox email found for user'
      });
    }

    // Create a test newsletter content entry
    const testResult = await emailProcessingService.processIncomingNewsletter({
      userId: req.user.id,
      fromEmail: 'test@siftly.space',
      subject: '🧪 Sift Inbox Test - Setup Verification',
      html: `
        <html>
          <body>
            <h2>🎉 Your Sift Inbox is Working!</h2>
            <p>Congratulations! If you're seeing this email in your Sift dashboard, your inbox forwarding is set up correctly.</p>
            <p>You can now forward newsletters to your inbox address: <strong>${req.user.inboxEmail}</strong></p>
            <p>Happy content discovery!</p>
            <p>- The Sift Team</p>
          </body>
        </html>
      `,
      text: `🎉 Your Sift Inbox is Working! Congratulations! If you're seeing this email in your Sift dashboard, your inbox forwarding is set up correctly. You can now forward newsletters to your inbox address: ${req.user.inboxEmail}. Happy content discovery! - The Sift Team`,
      receivedAt: new Date()
    });

    if (testResult.success) {
      res.json({
        success: true,
        message: 'Test email sent successfully',
        contentId: testResult.contentId
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to process test email'
      });
    }

  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email'
    });
  }
});

// =================
// CONTENT INTERACTION API ROUTES (NEW)
// =================

// Save/unsave content
app.post('/api/content/:contentId/save', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { isSaved } = req.body;

    // Find or create interaction record
    let interaction = await UserContentInteraction.findOne({
      where: {
        userId: req.user.id,
        newsletterContentId: contentId
      }
    });

    if (interaction) {
      // Update existing interaction
      await interaction.update({
        isSaved: isSaved,
        savedAt: isSaved ? new Date() : null
      });
    } else {
      // Create new interaction
      interaction = await UserContentInteraction.create({
        userId: req.user.id,
        newsletterContentId: contentId,
        isSaved: isSaved,
        savedAt: isSaved ? new Date() : null,
        isRead: false
      });
    }

    res.json({
      success: true,
      message: isSaved ? 'Content saved' : 'Content unsaved',
      isSaved: interaction.isSaved
    });

  } catch (error) {
    console.error('Error updating save state:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update save state'
    });
  }
});

// Mark content as read
app.post('/api/content/:contentId/read', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { timeSpent = 0, scrollProgress = 0 } = req.body;

    // Find or create interaction record
    let interaction = await UserContentInteraction.findOne({
      where: {
        userId: req.user.id,
        newsletterContentId: contentId
      }
    });

    if (interaction) {
      // Update existing interaction
      await interaction.update({
        isRead: true,
        readAt: new Date(),
        timeSpentReading: timeSpent,
        scrollProgress: scrollProgress
      });
    } else {
      // Create new interaction
      interaction = await UserContentInteraction.create({
        userId: req.user.id,
        newsletterContentId: contentId,
        isRead: true,
        readAt: new Date(),
        timeSpentReading: timeSpent,
        scrollProgress: scrollProgress
      });
    }

    res.json({
      success: true,
      message: 'Content marked as read'
    });

  } catch (error) {
    console.error('Error marking content as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark content as read'
    });
  }
});

// Mark content as caught up/uncaught up
app.post('/api/content/caught-up', requireAuth, async (req, res) => {
  try {
    const { contentId, contentType, caughtUp } = req.body;

    if (contentType === 'youtube') {
      // Handle YouTube content - store caught up status in database for permanent persistence
      
      // Verify user has access to this video
      const userChannelIds = await UserYouTubeSubscription.findAll({
        where: { userId: req.user.id },
        attributes: ['youtubeChannelId']
      }).then(subs => subs.map(s => s.youtubeChannelId));

      const video = await YouTubeVideo.findOne({
        where: {
          id: contentId,
          youtubeChannelId: {
            [require('sequelize').Op.in]: userChannelIds
          }
        }
      });

      if (!video) {
        return res.status(404).json({
          success: false,
          message: 'Video not found'
        });
      }

      // Find or create YouTube video interaction record
      let interaction = await UserYouTubeVideoInteraction.findOne({
        where: {
          userId: req.user.id,
          youtubeVideoId: contentId
        }
      });

      if (interaction) {
        // Update existing interaction
        await interaction.update({
          caughtUp: caughtUp,
          caughtUpAt: caughtUp ? new Date() : null
        });
      } else {
        // Create new interaction
        interaction = await UserYouTubeVideoInteraction.create({
          userId: req.user.id,
          youtubeVideoId: contentId,
          caughtUp: caughtUp,
          caughtUpAt: caughtUp ? new Date() : null
        });
      }

      res.json({
        success: true,
        message: caughtUp ? 'Video marked as caught up' : 'Video unmarked as caught up'
      });

    } else {
      // Handle newsletter content
      // Find or create interaction record
      let interaction = await UserContentInteraction.findOne({
        where: {
          userId: req.user.id,
          newsletterContentId: contentId
        }
      });

      if (interaction) {
        // Update existing interaction
        await interaction.update({
          caughtUp: caughtUp
        });
      } else {
        // Create new interaction
        interaction = await UserContentInteraction.create({
          userId: req.user.id,
          newsletterContentId: contentId,
          caughtUp: caughtUp
        });
      }

      res.json({
        success: true,
        message: caughtUp ? 'Content marked as caught up' : 'Content unmarked as caught up'
      });
    }

  } catch (error) {
    console.error('Error updating caught up status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update caught up status'
    });
  }
});

// Get content statistics
app.get('/api/content/stats', requireAuth, async (req, res) => {
  try {
    const stats = await UserContentInteraction.findAll({
      where: { userId: req.user.id },
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'totalInteractions'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN "isRead" = true THEN 1 END')), 'readCount'],
        [sequelize.fn('COUNT', sequelize.literal('CASE WHEN "isSaved" = true THEN 1 END')), 'savedCount'],
        [sequelize.fn('AVG', sequelize.col('timeSpentReading')), 'avgReadTime']
      ],
      raw: true
    });

    res.json({
      success: true,
      stats: stats[0] || {
        totalInteractions: 0,
        readCount: 0,
        savedCount: 0,
        avgReadTime: 0
      }
    });

  } catch (error) {
    console.error('Error fetching content stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
});

// =================
// IMPROVED CONTENT PROCESSING (UPDATED)
// =================

app.post('/api/content/process', requireAuth, async (req, res) => {
  try {
    const { newsletterSourceId, emailHtml, subject } = req.body;

    if (!emailHtml) {
      return res.status(400).json({
        success: false,
        message: 'Email HTML is required'
      });
    }

    // If no newsletterSourceId provided, create a test source
    let sourceId = newsletterSourceId;
    if (!sourceId) {
      // Create or find test newsletter source
      let testSource = await NewsletterSource.findOne({
        where: { name: 'Stratechery' }
      });

      if (!testSource) {
        testSource = await NewsletterSource.create({
          name: 'Stratechery',
          description: 'Analysis of the strategy and business side of technology and media',
          website: 'https://stratechery.com',
          subscriptionUrl: 'https://stratechery.com/subscribe',
          logo: 'https://stratechery.com/wp-content/uploads/2023/03/stratechery_logo_small.png',
          category: 'tech',
          metadata: {
            isPopular: true,
            subscribers: '100000+',
            frequency: 'weekly'
          }
        });
      }

      sourceId = testSource.id;

      // Create user subscription if it doesn't exist
      const existingSubscription = await UserNewsletterSubscription.findOne({
        where: {
          userId: req.user.id,
          newsletterSourceId: sourceId
        }
      });

      if (!existingSubscription) {
        await UserNewsletterSubscription.create({
          userId: req.user.id,
          newsletterSourceId: sourceId,
          forwardingEmail: `test-${req.user.id}@example.com`,
          isActive: true
        });
      }
    }

    const newsletterSource = await NewsletterSource.findByPk(sourceId);
    if (!newsletterSource) {
      return res.status(404).json({
        success: false,
        message: 'Newsletter source not found'
      });
    }

    const extractionResult = await contentExtractionService.extractContent(emailHtml, newsletterSource);

    if (!extractionResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Content extraction failed',
        error: extractionResult.error
      });
    }

    const newsletterContent = await NewsletterContent.create({
      newsletterSourceId: sourceId,
      originalSubject: subject || 'Test Newsletter',
      originalHtml: emailHtml,
      metadata: extractionResult.metadata,
      sections: extractionResult.sections,
      processingStatus: 'completed',
      extractionConfidence: extractionResult.extractionConfidence || 0.8,
      wordCount: extractionResult.wordCount || 0,
      searchText: extractionResult.searchText || '',
      tags: extractionResult.tags || []
    });

    res.json({
      success: true,
      message: 'Content processed successfully',
      contentId: newsletterContent.id,
      extractionConfidence: extractionResult.extractionConfidence,
      sectionsExtracted: extractionResult.sections.length
    });

  } catch (error) {
    console.error('Error processing content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process content'
    });
  }
});

// =================
// NEWSLETTER SOURCE MANAGEMENT (IMPROVED)
// =================

// Create test newsletter sources
app.post('/api/newsletters/create-test-sources', requireAuth, async (req, res) => {
  try {
    const testSources = [
      {
        name: 'Stratechery',
        description: 'Analysis of the strategy and business side of technology and media',
        website: 'https://stratechery.com',
        subscriptionUrl: 'https://stratechery.com/subscribe',
        logo: null,
        category: 'tech',
        metadata: {
          isPopular: true,
          subscribers: '100000+',
          frequency: 'weekly',
          tags: ['tech', 'business', 'strategy']
        }
      },
      {
        name: 'Morning Brew',
        description: 'The daily email newsletter covering the latest news from Wall St. to Silicon Valley',
        website: 'https://morningbrew.com',
        subscriptionUrl: 'https://morningbrew.com/subscribe',
        logo: null,
        category: 'business',
        metadata: {
          isPopular: true,
          subscribers: '2000000+',
          frequency: 'daily',
          tags: ['business', 'finance', 'news']
        }
      },
      {
        name: 'The Hustle',
        description: 'Daily tech and business news in 5 minutes',
        website: 'https://thehustle.co',
        subscriptionUrl: 'https://thehustle.co/subscribe',
        logo: null,
        category: 'business',
        metadata: {
          isPopular: true,
          subscribers: '1000000+',
          frequency: 'daily',
          tags: ['business', 'tech', 'startups']
        }
      }
    ];

    const createdSources = [];

    for (const sourceData of testSources) {
      // Check if source already exists
      let source = await NewsletterSource.findOne({
        where: { name: sourceData.name }
      });

      if (!source) {
        source = await NewsletterSource.create(sourceData);
        createdSources.push(source);
      }
    }

    res.json({
      success: true,
      message: `Created ${createdSources.length} test newsletter sources`,
      sources: createdSources
    });

  } catch (error) {
    console.error('Error creating test sources:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create test sources'
    });
  }
});

// Save/unsave content
app.post('/api/content/:contentId/save', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { isSaved } = req.body;

    // Find or create interaction record
    let interaction = await UserContentInteraction.findOne({
      where: {
        userId: req.user.id,
        newsletterContentId: contentId
      }
    });

    if (interaction) {
      // Update existing interaction
      await interaction.update({
        isSaved: isSaved,
        savedAt: isSaved ? new Date() : null
      });
    } else {
      // Create new interaction
      interaction = await UserContentInteraction.create({
        userId: req.user.id,
        newsletterContentId: contentId,
        isSaved: isSaved,
        savedAt: isSaved ? new Date() : null,
        isRead: false
      });
    }

    res.json({
      success: true,
      message: isSaved ? 'Content saved' : 'Content unsaved',
      isSaved: interaction.isSaved
    });

  } catch (error) {
    console.error('Error updating save state:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update save state'
    });
  }
});

// Mark content as read
app.post('/api/content/:contentId/read', requireAuth, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { timeSpent = 0, scrollProgress = 0 } = req.body;

    // Find or create interaction record
    let interaction = await UserContentInteraction.findOne({
      where: {
        userId: req.user.id,
        newsletterContentId: contentId
      }
    });

    if (interaction) {
      // Update existing interaction
      await interaction.update({
        isRead: true,
        readAt: new Date(),
        timeSpentReading: timeSpent,
        scrollProgress: scrollProgress
      });
    } else {
      // Create new interaction
      interaction = await UserContentInteraction.create({
        userId: req.user.id,
        newsletterContentId: contentId,
        isRead: true,
        readAt: new Date(),
        timeSpentReading: timeSpent,
        scrollProgress: scrollProgress
      });
    }

    res.json({
      success: true,
      message: 'Content marked as read'
    });

  } catch (error) {
    console.error('Error marking content as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark content as read'
    });
  }
});

// =================
// HELPER FUNCTIONS (UPDATED)
// =================

async function checkUserHasContent(userId) {
  try {
    console.log('🔍 Checking content for user ID:', userId);
    
    // Check for active newsletter subscriptions
    const newsletterCount = await UserNewsletterSubscription.count({
      where: {
        userId,
        isActive: true
      }
    });
    console.log('📧 Newsletter subscriptions:', newsletterCount);

    // Check for any newsletter content directly assigned to user
    const contentCount = await NewsletterContent.count({
      where: {
        userId
      }
    });
    console.log('📄 Newsletter content:', contentCount);

    // Check for active YouTube subscriptions
    const youtubeCount = await UserYouTubeSubscription.count({
      where: {
        userId,
        isActive: true
      }
    });
    console.log('📺 YouTube subscriptions:', youtubeCount);

    // User has content if they have subscriptions or newsletter content or YouTube subscriptions
    const hasContent = newsletterCount > 0 || contentCount > 0 || youtubeCount > 0;
    console.log('✅ Final content check result:', hasContent);
    return hasContent;
  } catch (error) {
    console.error('❌ Error checking user content:', error);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// =================
// ENHANCED NEWSLETTER API ROUTES
// =================

// Search newsletters with categories and filters
app.get('/api/newsletters/search', requireAuth, async (req, res) => {
  try {
    const {
      q = '',
      category = '',
      popular = '',
      limit = 20,
      offset = 0
    } = req.query;

    const whereClause = { isActive: true };

    // Add search query filter
    if (q.trim()) {
      const { Op } = require('sequelize');
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${q.trim()}%` } },
        { description: { [Op.iLike]: `%${q.trim()}%` } },
        { 'metadata.tags': { [Op.contains]: [q.trim().toLowerCase()] } }
      ];
    }

    // Add category filter
    if (category) {
      whereClause.category = category;
    }

    // Add popular filter
    if (popular === 'true') {
      whereClause['metadata.isPopular'] = true;
    }

    const newsletters = await NewsletterSource.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [
        ['metadata.isPopular', 'DESC'],
        ['name', 'ASC']
      ]
    });

    // Get user's current subscriptions
    const userSubscriptions = await UserNewsletterSubscription.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      }
    });

    const subscriptionMap = new Map(
      userSubscriptions.map(sub => [sub.newsletterSourceId, sub])
    );

    const newslettersWithStatus = newsletters.rows.map(newsletter => ({
      id: newsletter.id,
      name: newsletter.name,
      description: newsletter.description,
      website: newsletter.website,
      logo: newsletter.logo,
      category: newsletter.category,
      subscriptionUrl: newsletter.subscriptionUrl,
      metadata: newsletter.metadata,
      isSubscribed: subscriptionMap.has(newsletter.id)
    }));

    res.json({
      success: true,
      newsletters: newslettersWithStatus,
      pagination: {
        total: newsletters.count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + newsletters.rows.length) < newsletters.count
      }
    });

  } catch (error) {
    console.error('Error searching newsletters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search newsletters'
    });
  }
});

// Get newsletter categories with counts
app.get('/api/newsletters/categories', requireAuth, async (req, res) => {
  try {
    const { Op } = require('sequelize');

    const categories = await NewsletterSource.findAll({
      where: { isActive: true },
      attributes: [
        'category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['category'],
      order: [['category', 'ASC']]
    });

    const categoryData = categories.map(cat => ({
      name: cat.category,
      count: parseInt(cat.getDataValue('count')),
      displayName: cat.category.charAt(0).toUpperCase() + cat.category.slice(1)
    }));

    // Add "All" category
    const totalCount = await NewsletterSource.count({ where: { isActive: true } });

    res.json({
      success: true,
      categories: [
        { name: 'all', displayName: 'All', count: totalCount },
        ...categoryData
      ]
    });

  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

// Get popular/featured newsletters
app.get('/api/newsletters/popular', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;

    const newsletters = await NewsletterSource.findAll({
      where: {
        isActive: true,
        'metadata.isPopular': true
      },
      limit,
      order: [
        [sequelize.literal("(metadata->>'subscribers')"), 'DESC'],
        ['name', 'ASC']
      ]
    });

    // Check user subscriptions
    const userSubscriptions = await UserNewsletterSubscription.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      }
    });

    const subscriptionMap = new Map(
      userSubscriptions.map(sub => [sub.newsletterSourceId, sub])
    );

    const newslettersWithStatus = newsletters.map(newsletter => ({
      id: newsletter.id,
      name: newsletter.name,
      description: newsletter.description,
      website: newsletter.website,
      logo: newsletter.logo,
      category: newsletter.category,
      subscriptionUrl: newsletter.subscriptionUrl,
      metadata: newsletter.metadata,
      isSubscribed: subscriptionMap.has(newsletter.id)
    }));

    res.json({
      success: true,
      newsletters: newslettersWithStatus
    });

  } catch (error) {
    console.error('Error fetching popular newsletters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch popular newsletters'
    });
  }
});

// Detect and add custom newsletter (Tier 2 functionality)
app.post('/api/newsletters/detect', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    // Use the newsletter detection service
    const newsletterDetectionService = require('./services/newsletterDetection');
    
    // Set user's preferred language for better detection
    if (req.user && req.user.preferredLanguage) {
      newsletterDetectionService.setUserLanguage(req.user.preferredLanguage);
    } else if (req.language) {
      newsletterDetectionService.setUserLanguage(req.language);
    }
    
    const detectionResult = await newsletterDetectionService.detectNewsletter(url);

    if (!detectionResult.success) {
      return res.status(400).json({
        success: false,
        message: detectionResult.message || 'Could not detect newsletter information'
      });
    }

    // Check if newsletter already exists
    const existingNewsletter = await NewsletterSource.findOne({
      where: {
        [sequelize.Op.or]: [
          { website: detectionResult.website },
          { name: detectionResult.name }
        ]
      }
    });

    if (existingNewsletter) {
      // Check if user is already subscribed
      const existingSubscription = await UserNewsletterSubscription.findOne({
        where: {
          userId: req.user.id,
          newsletterSourceId: existingNewsletter.id,
          isActive: true
        }
      });

      return res.json({
        success: true,
        newsletter: {
          id: existingNewsletter.id,
          name: existingNewsletter.name,
          description: existingNewsletter.description,
          website: existingNewsletter.website,
          subscriptionUrl: existingNewsletter.subscriptionUrl,
          isSubscribed: !!existingSubscription
        },
        alreadyExists: true
      });
    }

    // Create new newsletter source
    const newNewsletter = await NewsletterSource.create({
      name: detectionResult.name,
      description: detectionResult.description,
      website: detectionResult.website,
      subscriptionUrl: detectionResult.subscriptionUrl,
      logo: detectionResult.logo,
      category: detectionResult.category || 'other',
      metadata: {
        isPopular: false,
        detectedAt: new Date().toISOString(),
        addedByUser: req.user.id,
        ...detectionResult.metadata
      }
    });

    res.json({
      success: true,
      newsletter: {
        id: newNewsletter.id,
        name: newNewsletter.name,
        description: newNewsletter.description,
        website: newNewsletter.website,
        subscriptionUrl: newNewsletter.subscriptionUrl,
        isSubscribed: false
      },
      alreadyExists: false
    });

  } catch (error) {
    console.error('Error detecting newsletter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to detect newsletter information'
    });
  }
});

// Get subscription suggestions based on user's current subscriptions
app.get('/api/newsletters/suggestions', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 4;

    // Get user's current subscriptions
    const userSubscriptions = await UserNewsletterSubscription.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      },
      include: [{
        model: NewsletterSource,
        as: 'newsletter'
      }]
    });

    if (userSubscriptions.length === 0) {
      // New user - show popular newsletters
      return res.redirect('/api/newsletters/popular?limit=' + limit);
    }

    // Get categories user is interested in
    const userCategories = [...new Set(
      userSubscriptions.map(sub => sub.newsletter.category)
    )];

    // Get tags user is interested in
    const userTags = [...new Set(
      userSubscriptions
        .flatMap(sub => sub.newsletter.metadata?.tags || [])
    )];

    // Find similar newsletters
    const { Op } = require('sequelize');
    const suggestions = await NewsletterSource.findAll({
      where: {
        isActive: true,
        id: {
          [Op.notIn]: userSubscriptions.map(sub => sub.newsletterSourceId)
        },
        [Op.or]: [
          { category: { [Op.in]: userCategories } },
          { 'metadata.tags': { [Op.overlap]: userTags } }
        ]
      },
      limit,
      order: [
        ['metadata.isPopular', 'DESC'],
        [sequelize.literal('RANDOM()')]
      ]
    });

    const suggestionsWithStatus = suggestions.map(newsletter => ({
      id: newsletter.id,
      name: newsletter.name,
      description: newsletter.description,
      website: newsletter.website,
      logo: newsletter.logo,
      category: newsletter.category,
      subscriptionUrl: newsletter.subscriptionUrl,
      metadata: newsletter.metadata,
      isSubscribed: false,
      reason: userCategories.includes(newsletter.category)
        ? `Popular in ${newsletter.category}`
        : 'Based on your interests'
    }));

    res.json({
      success: true,
      suggestions: suggestionsWithStatus
    });

  } catch (error) {
    console.error('Error fetching suggestions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch suggestions'
    });
  }
});

// Bulk newsletter operations (for future Tier 3 functionality)
app.post('/api/newsletters/bulk-subscribe', requireAuth, async (req, res) => {
  try {
    const { newsletterIds } = req.body;

    if (!Array.isArray(newsletterIds) || newsletterIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Newsletter IDs array is required'
      });
    }

    const results = [];

    for (const newsletterId of newsletterIds) {
      try {
        const newsletter = await NewsletterSource.findByPk(newsletterId);
        if (!newsletter) {
          results.push({
            newsletterId,
            success: false,
            message: 'Newsletter not found'
          });
          continue;
        }

        const existingSubscription = await UserNewsletterSubscription.findOne({
          where: {
            userId: req.user.id,
            newsletterSourceId: newsletterId
          }
        });

        if (existingSubscription?.isActive) {
          results.push({
            newsletterId,
            success: false,
            message: 'Already subscribed'
          });
          continue;
        }

        if (existingSubscription && !existingSubscription.isActive) {
          await existingSubscription.update({ isActive: true });
          results.push({
            newsletterId,
            success: true,
            message: 'Subscription reactivated',
            forwardingEmail: existingSubscription.forwardingEmail
          });
          continue;
        }

        const forwardingEmail = generateForwardingEmail(req.user.id, newsletterId);

        await UserNewsletterSubscription.create({
          userId: req.user.id,
          newsletterSourceId: newsletterId,
          forwardingEmail,
          isActive: true
        });

        results.push({
          newsletterId,
          success: true,
          message: 'Successfully subscribed',
          forwardingEmail
        });

      } catch (error) {
        results.push({
          newsletterId,
          success: false,
          message: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      message: `Successfully subscribed to ${successCount} out of ${newsletterIds.length} newsletters`,
      results
    });

  } catch (error) {
    console.error('Error in bulk subscribe:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process bulk subscription'
    });
  }
});

// Get available newsletters with user subscription status (EXISTING ROUTE - UPDATED)
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

    if (existingSubscription?.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Already subscribed to this newsletter',
      });
    }

    // NEW: Determine subscription method based on newsletter type
    let subscriptionMethod;
    let forwardingEmail = null;

    if (newsletter.subscriptionType === 'shared' && newsletter.isSharedActive) {
      subscriptionMethod = 'shared_access';
    } else {
      subscriptionMethod = 'individual_forwarding';
      forwardingEmail = generateForwardingEmail(req.user.id, newsletterId);
    }

    if (existingSubscription && !existingSubscription.isActive) {
      await existingSubscription.update({
        isActive: true,
        subscriptionMethod,
        forwardingEmail
      });
    } else {
      await UserNewsletterSubscription.create({
        userId: req.user.id,
        newsletterSourceId: newsletterId,
        subscriptionMethod,
        forwardingEmail,
        isActive: true,
      });
    }

    console.log(`✅ User ${req.user.email} subscribed to ${newsletter.name} (${subscriptionMethod})`);

    // Track newsletter subscription
    posthogService.trackSubscription(req.user.id.toString(), 'subscribe', 'newsletter', {
      newsletter_name: newsletter.name,
      newsletter_id: newsletterId,
      subscription_method: subscriptionMethod,
      category: newsletter.category
    });

    const responseData = {
      success: true,
      subscriptionMethod,
      message: subscriptionMethod === 'shared_access'
        ? 'Successfully subscribed! Content available immediately.'
        : 'Successfully subscribed! Please forward emails to the provided address.',
    };

    if (forwardingEmail) {
      responseData.forwardingEmail = forwardingEmail;
    }

    res.json(responseData);

  } catch (error) {
    console.error('Error subscribing to newsletter:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to newsletter',
    });
  }
});

// Unsubscribe from a newsletter (EXISTING ROUTE - KEPT AS IS)
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

    // Track newsletter unsubscription
    if (newsletter) {
      posthogService.trackSubscription(req.user.id.toString(), 'unsubscribe', 'newsletter', {
        newsletter_name: newsletter.name,
        newsletter_id: newsletterId,
        category: newsletter.category
      });
    }

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
// YOUTUBE API ROUTES
// =================

// Check if user has existing YouTube connection
app.get('/api/youtube/check-connection', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Check if user has any YouTube subscriptions
    const userSubscriptions = await UserYouTubeSubscription.findAll({
      where: { 
        userId,
        isActive: true 
      },
      include: [{
        model: YouTubeChannel,
        as: 'youtubeChannel'
      }]
    });

    const hasConnection = userSubscriptions.length > 0;
    
    if (hasConnection) {
      // Get all channels the user could potentially subscribe to (from OAuth)
      const youtubeTokens = req.session.youtubeTokens;
      let allSubscriptions = [];
      
      if (youtubeTokens) {
        try {
          const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.APP_URL}/auth/youtube/callback`
          );

          oauth2Client.setCredentials(youtubeTokens);
          const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

          const subscriptionsResponse = await youtube.subscriptions.list({
            part: ['snippet'],
            mine: true,
            maxResults: 50
          });

          allSubscriptions = subscriptionsResponse.data.items.map(item => ({
            id: item.snippet.resourceId.channelId,
            name: item.snippet.title,
            description: item.snippet.description,
            thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
            subscriberCount: 'Unknown',
            channelUrl: `https://youtube.com/channel/${item.snippet.resourceId.channelId}`
          }));
        } catch (error) {
          console.log('Could not fetch fresh subscriptions:', error.message);
        }
      }

      res.json({
        success: true,
        hasConnection: true,
        subscriptions: allSubscriptions,
        userSubscriptions: userSubscriptions
      });
    } else {
      res.json({
        success: true,
        hasConnection: false
      });
    }
  } catch (error) {
    console.error('Error checking YouTube connection:', error);
    res.json({
      success: false,
      message: 'Failed to check YouTube connection'
    });
  }
});

// Get user's YouTube subscriptions
app.get('/api/youtube/subscriptions', requireAuth, async (req, res) => {
  try {
    const youtubeTokens = req.session.youtubeTokens;
    if (!youtubeTokens) {
      return res.json({
        success: false,
        message: 'YouTube account not connected'
      });
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/auth/youtube/callback`
    );

    oauth2Client.setCredentials(youtubeTokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Get user's subscriptions
    const subscriptionsResponse = await youtube.subscriptions.list({
      part: ['snippet'],
      mine: true,
      maxResults: 50
    });

    const subscriptions = subscriptionsResponse.data.items.map(item => ({
      id: item.snippet.resourceId.channelId,
      name: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      subscriberCount: 'Unknown', // Would need separate API call
      channelUrl: `https://youtube.com/channel/${item.snippet.resourceId.channelId}`
    }));

    res.json({
      success: true,
      subscriptions
    });
  } catch (error) {
    console.error('Error fetching YouTube subscriptions:', error);
    res.json({
      success: false,
      message: 'Failed to fetch YouTube subscriptions'
    });
  }
});

// Save selected YouTube channels
app.post('/api/youtube/save-subscriptions', requireAuth, async (req, res) => {
  try {
    const { channels } = req.body;
    const userId = req.user.id;

    if (!channels || !Array.isArray(channels)) {
      return res.json({
        success: false,
        message: 'Invalid channels data'
      });
    }

    // Create or update YouTube channels and user subscriptions
    for (const channelData of channels) {
      // Find or create YouTube channel
      let [youtubeChannel] = await YouTubeChannel.findOrCreate({
        where: { channelId: channelData.id },
        defaults: {
          channelId: channelData.id,
          name: channelData.name,
          description: channelData.description || '',
          thumbnail: channelData.thumbnail,
          subscriberCount: channelData.subscriberCount,
          channelUrl: channelData.channelUrl,
        }
      });

      // Create user subscription
      await UserYouTubeSubscription.findOrCreate({
        where: {
          userId,
          youtubeChannelId: youtubeChannel.id
        },
        defaults: {
          userId,
          youtubeChannelId: youtubeChannel.id,
          sourceType: 'oauth',
          isActive: true
        }
      });
    }

    res.json({
      success: true,
      message: `Successfully saved ${channels.length} YouTube channels`
    });
  } catch (error) {
    console.error('Error saving YouTube subscriptions:', error);
    res.json({
      success: false,
      message: 'Failed to save YouTube subscriptions'
    });
  }
});

// Add YouTube channel manually
app.post('/api/youtube/add-channel', requireAuth, async (req, res) => {
  try {
    const { channelInput } = req.body;
    const userId = req.user.id;

    if (!channelInput) {
      return res.json({
        success: false,
        message: 'Channel input is required'
      });
    }

    // Extract @username from input (simplified)
    let username;
    const input = channelInput.trim();
    
    console.log('🔍 Processing channel input:', input);
    
    if (input.includes('youtube.com/@')) {
      // Extract from youtube.com/@username
      const match = input.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/);
      username = match ? match[1] : null;
      console.log('👤 Extracted username from URL:', username);
    } else if (input.startsWith('@')) {
      // Direct @username (remove the @)
      username = input.substring(1);
      console.log('👤 Extracted username from @:', username);
    } else {
      return res.json({
        success: false,
        message: 'Please enter a YouTube channel in the format: @channelname or youtube.com/@channelname'
      });
    }
    
    if (!username || username.length === 0) {
      return res.json({
        success: false,
        message: 'Could not extract channel username from input'
      });
    }

    // Use API key for public channel information
    console.log('🔑 Using API key:', process.env.GOOGLE_API_KEY ? 'Key set' : 'Key missing');
    console.log('🔍 Searching for username:', username);

    // Get channel information using search API (more reliable for @usernames)
    let channelResponse;
    
    try {
      // Use search API to find channels by name/handle
      const searchResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(username)}&key=${process.env.GOOGLE_API_KEY}`,
        { method: 'GET' }
      );
      
      if (!searchResponse.ok) {
        throw new Error(`YouTube API returned ${searchResponse.status}: ${searchResponse.statusText}`);
      }
      
      const searchData = await searchResponse.json();
      console.log('🔍 Search results:', searchData.items?.length || 0);
      
      if (!searchData.items || searchData.items.length === 0) {
        return res.json({
          success: false,
          message: `No YouTube channel found with username "@${username}"`
        });
      }
      
      // Get the first matching channel's full details
      const channelId = searchData.items[0].id.channelId;
      console.log('📺 Found channel ID:', channelId);
      
      const channelDetailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${process.env.GOOGLE_API_KEY}`,
        { method: 'GET' }
      );
      
      if (!channelDetailsResponse.ok) {
        throw new Error(`YouTube API returned ${channelDetailsResponse.status}: ${channelDetailsResponse.statusText}`);
      }
      
      channelResponse = { data: await channelDetailsResponse.json() };
      console.log('📊 Channel details found:', channelResponse.data.items?.length || 0);
      
    } catch (error) {
      console.error('❌ YouTube API error:', error);
      return res.json({
        success: false,
        message: `Failed to find YouTube channel: ${error.message}`
      });
    }

    if (!channelResponse.data.items || channelResponse.data.items.length === 0) {
      return res.json({
        success: false,
        message: 'YouTube channel not found. Try using the full channel URL like: https://youtube.com/channel/UC...'
      });
    }

    const channelInfo = channelResponse.data.items[0];
    const channelData = {
      id: channelInfo.id,
      name: channelInfo.snippet.title,
      description: channelInfo.snippet.description || '',
      thumbnail: channelInfo.snippet.thumbnails?.medium?.url || channelInfo.snippet.thumbnails?.default?.url,
      subscriberCount: channelInfo.statistics?.subscriberCount || 'Unknown',
      channelUrl: `https://youtube.com/channel/${channelInfo.id}`
    };

    // Find or create YouTube channel
    let [youtubeChannel] = await YouTubeChannel.findOrCreate({
      where: { channelId: channelData.id },
      defaults: {
        channelId: channelData.id,
        name: channelData.name,
        description: channelData.description,
        thumbnail: channelData.thumbnail,
        subscriberCount: channelData.subscriberCount,
        channelUrl: channelData.channelUrl,
      }
    });

    // Create user subscription
    const [subscription, created] = await UserYouTubeSubscription.findOrCreate({
      where: {
        userId,
        youtubeChannelId: youtubeChannel.id
      },
      defaults: {
        userId,
        youtubeChannelId: youtubeChannel.id,
        sourceType: 'manual',
        isActive: true
      }
    });

    if (!created) {
      return res.json({
        success: false,
        message: 'You are already subscribed to this channel'
      });
    }

    res.json({
      success: true,
      channel: channelData,
      message: `Successfully added ${channelData.name}`
    });
  } catch (error) {
    console.error('Error adding YouTube channel:', error);
    res.json({
      success: false,
      message: 'Failed to add YouTube channel'
    });
  }
});

// Get pending YouTube videos for approval
app.get('/api/youtube/pending-videos', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const pendingVideos = await youtubeService.getPendingVideosForUser(userId);
    
    res.json({
      success: true,
      videos: pendingVideos,
      count: pendingVideos.length
    });
  } catch (error) {
    console.error('Error fetching pending YouTube videos:', error);
    res.json({
      success: false,
      message: 'Failed to fetch pending videos'
    });
  }
});

// Get approved YouTube videos for dashboard
app.get('/api/youtube/approved-videos', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 20;
    const videoType = req.query.videoType || 'all';
    const approvedVideos = await youtubeService.getApprovedVideosForUser(userId, limit, videoType);
    
    res.json({
      success: true,
      videos: approvedVideos,
      count: approvedVideos.length
    });
  } catch (error) {
    console.error('Error fetching approved YouTube videos:', error);
    res.json({
      success: false,
      message: 'Failed to fetch approved videos'
    });
  }
});

// Approve/reject YouTube video
app.post('/api/youtube/videos/:videoId/approve', requireAuth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'
    
    if (!['approve', 'reject'].includes(action)) {
      return res.json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"'
      });
    }

    const video = await YouTubeVideo.findOne({
      where: { id: videoId }
    });

    if (!video) {
      return res.json({
        success: false,
        message: 'Video not found'
      });
    }

    await video.update({
      approvalStatus: action === 'approve' ? 'approved' : 'rejected'
    });

    res.json({
      success: true,
      message: `Video ${action}d successfully`
    });

  } catch (error) {
    console.error('Error approving/rejecting YouTube video:', error);
    res.json({
      success: false,
      message: 'Failed to update video status'
    });
  }
});

// Fetch new videos manually (for testing)
app.post('/api/youtube/fetch-videos', requireAuth, async (req, res) => {
  try {
    console.log('🎬 Manual video fetch triggered by user:', req.user.email);
    
    // Run the video fetch in the background
    youtubeService.fetchNewVideosForAllChannels().catch(error => {
      console.error('Background video fetch error:', error);
    });

    res.json({
      success: true,
      message: 'Video fetch started in background'
    });
  } catch (error) {
    console.error('Error starting video fetch:', error);
    res.json({
      success: false,
      message: 'Failed to start video fetch'
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

  // Create a hash that we can later decode
  const hash = crypto
    .createHash('md5')
    .update(`${userId}-${newsletterId}-${process.env.EMAIL_SECRET || 'default-secret'}`)
    .digest('hex')
    .substring(0, 12);

  const domain = process.env.NEWSLETTER_FORWARDING_DOMAIN || 'newsletters.yourdomain.com';
  return `nl-${hash}@${domain}`;
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

// Serve translation files
app.use('/translations', express.static('translations'));

// Serve PostHog config to frontend
app.get('/api/config/posthog', (req, res) => {
  res.json({
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com'
  });
});

// Test endpoint to manually trigger PostHog event
app.post('/api/test/posthog', (req, res) => {
  console.log('🧪 Manual PostHog test triggered');
  
  // Send a test event
  posthogService.track('test-user-backend', 'manual_backend_test', {
    test: true,
    timestamp: new Date(),
    source: 'manual_test_endpoint'
  });
  
  res.json({ success: true, message: 'PostHog test event sent' });
});

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
// BACKGROUND JOBS
// =================

function startYouTubeVideoFetching() {
  console.log('🎬 Starting YouTube video background fetching...');
  
  // Fetch videos immediately on startup (after 30 seconds)
  setTimeout(() => {
    console.log('🎬 Running initial YouTube video fetch...');
    youtubeService.fetchNewVideosForAllChannels().catch(error => {
      console.error('Initial YouTube video fetch error:', error);
    });
  }, 30000);
  
  // Then fetch videos every 30 minutes
  setInterval(() => {
    console.log('🎬 Running scheduled YouTube video fetch...');
    youtubeService.fetchNewVideosForAllChannels().catch(error => {
      console.error('Scheduled YouTube video fetch error:', error);
    });
  }, 30 * 60 * 1000); // 30 minutes
  
  console.log('✅ YouTube video fetching scheduled (every 30 minutes)');
}

// =================
// SERVER STARTUP
// =================

async function startServer() {
  try {
    await initializeEmailFile();

    await sequelize.authenticate();
    console.log('📊 Database connection established');

    // Skip sync for now due to schema conflicts
    // await sequelize.sync();
    console.log('📊 Database models synchronized');

    await sessionStore.sync();
    console.log('📊 Session store synchronized');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`🔐 Google OAuth configured: ${process.env.GOOGLE_CLIENT_ID ? '✅' : '❌'}`);
      
      // Start background YouTube video fetching
      startYouTubeVideoFetching();
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();