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
const { User, NewsletterSource, NewsletterSubscription, UserNewsletterSubscription, UserBlockList, NewsletterContent, UserContentInteraction } = require('./models');

const contentExtractionService = require('./services/contentExtraction');

const emailProcessingService = require('./services/emailProcessingService');

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
      inboxEmail: req.user.inboxEmail,
    } : null
  });
});

// Update user settings
app.post('/api/user/settings', requireAuth, async (req, res) => {
  try {
    const { name, customInboxPrefix } = req.body;
    const updates = {};

    if (name) {
      updates.name = name.trim();
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
  const validTypes = ['inbox', 'newsletters', 'youtube', 'music', 'news', 'rss'];

  if (!validTypes.includes(type)) {
    return res.status(404).send('Content type not found');
  }

  // Route to appropriate setup page
  if (type === 'inbox') {
    res.sendFile(path.join(__dirname, 'public', 'setup-inbox.html'));
  } else if (type === 'newsletters') {
    // Redirect newsletters to inbox setup (single inbox approach)
    res.redirect('/setup/inbox');
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

// Webhook endpoint for incoming emails
app.post('/api/webhooks/email', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const result = await emailProcessingService.processWebhookEmail(req.body);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('❌ Email webhook error:', error);
    res.status(500).json({ success: false, message: 'Processing failed' });
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

    // Only show approved content for single inbox approach
    const content = await NewsletterContent.findAndCountAll({
      where: {
        userId: req.user.id,
        approvalStatus: 'approved',
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
    // Check for active newsletter subscriptions
    const newsletterCount = await UserNewsletterSubscription.count({
      where: {
        userId,
        isActive: true
      }
    });

    // Check for any newsletter content directly assigned to user
    const contentCount = await NewsletterContent.count({
      where: {
        userId
      }
    });

    // User has content if they have subscriptions or newsletter content
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