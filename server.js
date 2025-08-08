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

const contentExtractionService = require('./services/contentExtraction');
const { NewsletterContent, UserContentInteraction } = require('./models');

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

app.get('/api/content/feed', requireAuth, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const userSubscriptions = await UserNewsletterSubscription.findAll({
      where: {
        userId: req.user.id,
        isActive: true
      }
    });

    if (userSubscriptions.length === 0) {
      return res.json({
        success: true,
        content: [],
        pagination: { total: 0, hasMore: false }
      });
    }

    // NEW: Separate shared and individual subscriptions
    const sharedSubscriptions = userSubscriptions.filter(sub => sub.subscriptionMethod === 'shared_access');
    const individualSubscriptions = userSubscriptions.filter(sub => sub.subscriptionMethod === 'individual_forwarding');

    const sharedNewsletterIds = sharedSubscriptions.map(sub => sub.newsletterSourceId);
    const individualNewsletterIds = individualSubscriptions.map(sub => sub.newsletterSourceId);

    // NEW: Build where clause for both content types
    const { Op } = require('sequelize');
    const whereClause = {
      processingStatus: 'completed',
      [Op.or]: []
    };

    if (sharedNewsletterIds.length > 0) {
      whereClause[Op.or].push({
        contentType: 'shared',
        newsletterSourceId: { [Op.in]: sharedNewsletterIds }
      });
    }

    if (individualNewsletterIds.length > 0) {
      whereClause[Op.or].push({
        contentType: 'individual',
        newsletterSourceId: { [Op.in]: individualNewsletterIds },
        userId: req.user.id
      });
    }

    if (whereClause[Op.or].length === 0) {
      return res.json({
        success: true,
        content: [],
        pagination: { total: 0, hasMore: false }
      });
    }

    const content = await NewsletterContent.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: NewsletterSource,
          as: 'source',
          attributes: ['id', 'name', 'logo', 'category']
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
      source: {
        id: item.source.id,
        name: item.source.name,
        logo: item.source.logo,
        category: item.source.category
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
    const newsletterCount = await UserNewsletterSubscription.count({
      where: {
        userId,
        isActive: true
      }
    });

    // Also check if user has any newsletter content
    const contentCount = await NewsletterContent.count({
      include: [{
        model: NewsletterSource,
        as: 'source',
        include: [{
          model: UserNewsletterSubscription,
          as: 'subscriptions',
          where: {
            userId,
            isActive: true
          }
        }]
      }]
    });

    return newsletterCount > 0 || contentCount > 0;
  } catch (error) {
    console.error('Error checking user content:', error);
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