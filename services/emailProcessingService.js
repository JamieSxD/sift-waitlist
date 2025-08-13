// services/emailProcessingService.js - Single Inbox Approach
const { User, NewsletterSource, NewsletterContent, NewsletterSubscription, UserBlockList } = require('../models');
const contentExtractionService = require('./contentExtraction');
const newsletterDetectionService = require('./newsletterDetection');
const { isInboxEmail } = require('../utils/emailUtils');

class EmailProcessingService {

  /**
   * Validate if email is an inbox email
   */
  validateInboxEmail(email) {
    return isInboxEmail(email);
  }

  /**
   * Find user by their inbox email
   */
  async findUserByInboxEmail(email) {
    try {
      if (!this.validateInboxEmail(email)) {
        console.log('❌ Invalid inbox email format:', email);
        return null;
      }

      const user = await User.findOne({
        where: { inboxEmail: email }
      });

      return user;
    } catch (error) {
      console.error('Error finding user by inbox email:', error);
      return null;
    }
  }

  /**
   * Check if email should be blocked for this user
   */
  async isEmailBlocked(userId, fromEmail, subject, senderDomain) {
    try {
      const { Op } = require('sequelize');

      const blockList = await UserBlockList.findOne({
        where: {
          userId,
          isActive: true,
          [Op.or]: [
            { blockType: 'email', blockValue: fromEmail },
            { blockType: 'domain', blockValue: senderDomain },
            {
              blockType: 'keyword',
              blockValue: {
                [Op.iLike]: subject
              }
            }
          ]
        }
      });

      return !!blockList;
    } catch (error) {
      console.error('Error checking block list:', error);
      return false;
    }
  }

  /**
   * Detect or create newsletter source from email
   */
  async detectNewsletterSource(fromEmail, subject, htmlContent, userId) {
    try {
      const senderDomain = fromEmail.split('@')[1]?.toLowerCase();

      // First, try to find existing newsletter source by sender info
      let newsletterSource = await this.findExistingNewsletterSource(fromEmail, senderDomain, subject);

      if (!newsletterSource) {
        // Try to detect newsletter using our detection service
        const detectionResult = await this.detectNewsletterFromContent(fromEmail, subject, htmlContent, senderDomain);

        if (detectionResult.success) {
          // Create new newsletter source from detection
          newsletterSource = await NewsletterSource.create({
            name: detectionResult.name,
            description: detectionResult.description || 'Auto-detected newsletter',
            website: detectionResult.website,
            category: detectionResult.category || this.detectCategory(subject + ' ' + (detectionResult.description || '')),
            metadata: {
              detectedFromEmail: true,
              firstDetectedBy: userId,
              senderDomain,
              ...detectionResult.metadata
            }
          });

          console.log(`✅ Auto-detected new newsletter source: ${newsletterSource.name}`);
        }
      } else {
        // Update existing source metadata if needed
        await this.updateNewsletterSourceMetadata(newsletterSource, fromEmail, senderDomain, subject);
      }

      return newsletterSource;
    } catch (error) {
      console.error('Error detecting newsletter source:', error);
      return null;
    }
  }

  /**
   * Enhanced newsletter detection from email content
   */
  async detectNewsletterFromContent(fromEmail, subject, htmlContent, senderDomain) {
    try {
      // Enhanced detection logic
      let newsletterName = this.extractNewsletterName(fromEmail, subject);
      let website = null;
      let description = null;
      let category = 'other';

      // Try to extract website from email content
      if (htmlContent) {
        const websiteMatch = htmlContent.match(/https?:\/\/(www\.)?([^\/\s"'<>]+)/g);
        if (websiteMatch) {
          // Find the most likely website (prefer domain matches)
          website = websiteMatch.find(url => url.includes(senderDomain.replace(/^mail\./, ''))) || websiteMatch[0];
        }
      }

      // Enhanced category detection
      category = this.detectCategory(subject + ' ' + (htmlContent || ''));

      // Try to extract description from email content or subject
      description = this.extractNewsletterDescription(subject, htmlContent);

      return {
        success: true,
        name: newsletterName,
        website,
        description,
        category,
        metadata: {
          detectedAt: new Date().toISOString(),
          detectionMethod: 'content_analysis',
          senderDomain,
          confidence: this.calculateDetectionConfidence(newsletterName, website, description)
        }
      };

    } catch (error) {
      console.error('Error in newsletter content detection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Find existing newsletter source by sender information
   */
  async findExistingNewsletterSource(fromEmail, senderDomain, subject) {
    try {
      const { Op } = require('sequelize');

      // Look for newsletter source with matching sender info
      const source = await NewsletterSource.findOne({
        where: {
          [Op.or]: [
            { senderEmails: { [Op.contains]: [fromEmail] } },
            { senderDomains: { [Op.contains]: [senderDomain] } },
            {
              subjectPatterns: {
                [Op.overlap]: [this.extractSubjectPattern(subject)]
              }
            }
          ]
        }
      });

      return source;
    } catch (error) {
      console.error('Error finding existing newsletter source:', error);
      return null;
    }
  }

  /**
   * Update newsletter source with new sender information
   */
  async updateNewsletterSourceSenderInfo(source, fromEmail, senderDomain, subject) {
    try {
      const updates = {};

      // Add email if not already present
      if (!source.senderEmails.includes(fromEmail)) {
        updates.senderEmails = [...source.senderEmails, fromEmail];
      }

      // Add domain if not already present
      if (!source.senderDomains.includes(senderDomain)) {
        updates.senderDomains = [...source.senderDomains, senderDomain];
      }

      // Add subject pattern if not already present
      const subjectPattern = this.extractSubjectPattern(subject);
      if (!source.subjectPatterns.includes(subjectPattern)) {
        updates.subjectPatterns = [...source.subjectPatterns, subjectPattern];
      }

      if (Object.keys(updates).length > 0) {
        await source.update(updates);
        console.log(`📝 Updated newsletter source ${source.name} with new sender info`);
      }
    } catch (error) {
      console.error('Error updating newsletter source sender info:', error);
    }
  }

  /**
   * Extract pattern from subject line for future detection
   */
  extractSubjectPattern(subject) {
    // Remove dates, numbers, and issue numbers to create a pattern
    return subject
      .replace(/\d+/g, 'X') // Replace numbers with X
      .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, 'MONTH')
      .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, 'DAY')
      .toLowerCase()
      .trim();
  }

  /**
   * Determine approval status for new content
   */
  async determineApprovalStatus(userId, newsletterSource, fromEmail) {
    try {
      // Check if user has auto-approve enabled for this newsletter source
      if (newsletterSource) {
        const subscription = await NewsletterSubscription.findOne({
          where: {
            userId,
            newsletterSourceId: newsletterSource.id,
            autoApprove: true,
            isActive: true
          }
        });

        if (subscription) {
          return 'approved'; // Auto-approve via subscription settings
        }
      }

      // Check if user has previously approved content from this sender (new UX improvement)
      const previouslyApproved = await NewsletterContent.findOne({
        where: {
          userId,
          originalFrom: fromEmail,
          approvalStatus: ['approved', 'auto_approved']
        }
      });

      if (previouslyApproved) {
        console.log(`✅ Auto-approving from previously approved sender: ${fromEmail}`);
        return 'auto_approved'; // Auto-approve since sender was approved before
      }

      // Default to pending approval for new/unknown senders
      return 'pending';
    } catch (error) {
      console.error('Error determining approval status:', error);
      return 'pending';
    }
  }

  /**
   * Create or update newsletter subscription tracking
   */
  async updateSubscriptionTracking(userId, newsletterSource) {
    try {
      if (!newsletterSource) return null;

      const [subscription, created] = await NewsletterSubscription.findOrCreate({
        where: {
          userId,
          newsletterSourceId: newsletterSource.id
        },
        defaults: {
          isActive: true,
          autoApprove: false,
          subscribedAt: new Date(),
          lastContentAt: new Date()
        }
      });

      if (!created) {
        // Update last content received time
        await subscription.update({
          lastContentAt: new Date()
        });
      }

      return subscription;
    } catch (error) {
      console.error('Error updating subscription tracking:', error);
      return null;
    }
  }

  /**
   * Process incoming newsletter email (Single Inbox Approach)
   */
  async processIncomingNewsletter({ userId, fromEmail, subject, html, text, receivedAt }) {
    try {
      console.log(`🔄 Processing newsletter for user ${userId} from ${fromEmail}`);

      const senderDomain = fromEmail.split('@')[1]?.toLowerCase();

      // Check if email is blocked
      const isBlocked = await this.isEmailBlocked(userId, fromEmail, subject, senderDomain);
      if (isBlocked) {
        console.log(`🚫 Email blocked for user ${userId}: ${fromEmail}`);
        return { success: true, message: 'Email blocked by user settings' };
      }

      // Detect or find newsletter source
      const newsletterSource = await this.detectNewsletterSource(fromEmail, subject, html, userId);

      // Determine approval status (defaults to 'pending')
      const approvalStatus = await this.determineApprovalStatus(userId, newsletterSource, fromEmail);

      // Update subscription tracking
      await this.updateSubscriptionTracking(userId, newsletterSource);

      // Extract content
      const extractionResult = await contentExtractionService.extractContent(
        html || text,
        newsletterSource || { name: this.extractNewsletterName(fromEmail, subject) }
      );

      // Prepare content data
      const contentData = {
        userId,
        newsletterSourceId: newsletterSource?.id || null,
        approvalStatus,
        originalSubject: subject,
        originalHtml: html,
        originalFrom: fromEmail,
        senderDomain,
        receivedAt: receivedAt || new Date(),
        detectedNewsletterName: newsletterSource?.name || this.extractNewsletterName(fromEmail, subject),
        detectedCategory: this.detectCategory(subject + ' ' + (html || text || ''))
      };

      if (!extractionResult.success) {
        console.log(`⚠️  Content extraction failed for ${subject}, saving as raw content`);

        // Save raw content for manual review
        const fallbackContent = await NewsletterContent.create({
          ...contentData,
          metadata: {
            title: subject,
            extractionFailed: true,
            rawContent: true,
            senderInfo: { email: fromEmail, domain: senderDomain }
          },
          sections: [],
          processingStatus: 'failed',
          processingError: extractionResult.error,
          extractionConfidence: 0,
          wordCount: (html || text || '').length,
          searchText: subject.toLowerCase(),
          tags: []
        });

        return {
          success: true,
          contentId: fallbackContent.id,
          approvalStatus,
          message: 'Content saved as raw (extraction failed)'
        };
      }

      // Create processed newsletter content
      const newsletterContent = await NewsletterContent.create({
        ...contentData,
        metadata: {
          ...extractionResult.metadata,
          senderInfo: { email: fromEmail, domain: senderDomain }
        },
        sections: extractionResult.sections,
        processingStatus: 'completed',
        extractionConfidence: extractionResult.extractionConfidence || 0.8,
        wordCount: extractionResult.wordCount || 0,
        searchText: extractionResult.searchText || '',
        tags: extractionResult.tags || []
      });

      // Auto-approve if enabled
      if (approvalStatus === 'approved') {
        await newsletterContent.update({
          approvedAt: new Date()
        });
        console.log(`✅ Auto-approved: ${subject}`);
      } else {
        console.log(`📥 Pending approval: ${subject}`);
      }

      return {
        success: true,
        contentId: newsletterContent.id,
        approvalStatus,
        message: 'Newsletter processed successfully'
      };

    } catch (error) {
      console.error('❌ Error processing incoming newsletter:', error);
      throw error;
    }
  }

  /**
   * Extract newsletter name from email/subject if no source detected
   */
  extractNewsletterName(fromEmail, subject) {
    // Try to extract from sender name or domain
    const domain = fromEmail.split('@')[1]?.toLowerCase();

    // Common newsletter domain patterns
    if (domain?.includes('substack.com')) {
      const subdomain = fromEmail.split('@')[1].split('.')[0];
      return subdomain.charAt(0).toUpperCase() + subdomain.slice(1);
    }

    if (domain?.includes('convertkit.com') || domain?.includes('ck.page')) {
      return 'Newsletter'; // Generic fallback
    }

    // Try to extract from subject line
    const subjectWords = subject.split(' ');
    if (subjectWords.length > 0) {
      return subjectWords[0];
    }

    return domain || 'Unknown Newsletter';
  }

  /**
   * Enhanced category detection from content
   */
  detectCategory(contentText) {
    const text = contentText.toLowerCase();

    const categoryKeywords = {
      'tech': ['technology', 'ai', 'software', 'programming', 'tech', 'startup', 'developer', 'code', 'saas'],
      'business': ['business', 'finance', 'investing', 'marketing', 'entrepreneur', 'revenue', 'growth', 'strategy'],
      'design': ['design', 'ux', 'ui', 'creative', 'visual', 'brand', 'figma', 'adobe'],
      'news': ['news', 'politics', 'current events', 'world', 'breaking', 'report', 'analysis'],
      'lifestyle': ['lifestyle', 'health', 'wellness', 'personal', 'fitness', 'food', 'travel'],
      'education': ['education', 'learning', 'course', 'tutorial', 'university', 'study', 'research'],
      'crypto': ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'nft', 'trading']
    };

    // Calculate score for each category
    const categoryScores = {};
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      categoryScores[category] = keywords.reduce((score, keyword) => {
        return score + (text.includes(keyword) ? 1 : 0);
      }, 0);
    }

    // Find category with highest score
    const bestCategory = Object.keys(categoryScores).reduce((a, b) => 
      categoryScores[a] > categoryScores[b] ? a : b
    );

    return categoryScores[bestCategory] > 0 ? bestCategory : 'other';
  }

  /**
   * Extract newsletter description from content
   */
  extractNewsletterDescription(subject, htmlContent) {
    // Try to extract meaningful description
    let description = null;

    if (htmlContent) {
      // Look for meta description or preview text
      const metaDescMatch = htmlContent.match(/<meta[^>]*name=['"](description|Description)['"]*[^>]*content=['"]([^'"]+)['"]/);
      if (metaDescMatch) {
        description = metaDescMatch[2];
      } else {
        // Extract first meaningful text block
        const textMatch = htmlContent.replace(/<[^>]*>/g, ' ').match(/\b.{20,100}\b/);
        if (textMatch) {
          description = textMatch[0].trim();
        }
      }
    }

    // Fallback to subject-based description
    if (!description || description.length < 10) {
      description = `Newsletter: ${subject.substring(0, 80)}${subject.length > 80 ? '...' : ''}`;
    }

    return description;
  }

  /**
   * Calculate detection confidence score
   */
  calculateDetectionConfidence(name, website, description) {
    let confidence = 0.3; // Base confidence

    if (name && name !== 'Unknown Newsletter') confidence += 0.3;
    if (website) confidence += 0.3;
    if (description && description.length > 20) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Update newsletter source metadata
   */
  async updateNewsletterSourceMetadata(source, fromEmail, senderDomain, subject) {
    try {
      const updates = {};
      let hasUpdates = false;

      // Add to metadata if new info is found
      if (source.metadata && source.metadata.detectedFromEmail) {
        if (!source.metadata.senderEmails || !source.metadata.senderEmails.includes(fromEmail)) {
          updates['metadata.senderEmails'] = [...(source.metadata.senderEmails || []), fromEmail];
          hasUpdates = true;
        }
        
        if (!source.metadata.senderDomains || !source.metadata.senderDomains.includes(senderDomain)) {
          updates['metadata.senderDomains'] = [...(source.metadata.senderDomains || []), senderDomain];
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        await source.update({ metadata: { ...source.metadata, ...updates } });
        console.log(`📝 Updated metadata for newsletter source: ${source.name}`);
      }
    } catch (error) {
      console.error('Error updating newsletter source metadata:', error);
    }
  }

  /**
   * Find existing newsletter source by sender information
   */
  async findExistingNewsletterSource(fromEmail, senderDomain, subject) {
    try {
      const { Op } = require('sequelize');

      // Simplified search - just look for matching name or website
      // For test emails, we'll create a new source each time
      const source = await NewsletterSource.findOne({
        where: {
          [Op.or]: [
            { name: { [Op.iLike]: `%${senderDomain.split('.')[0]}%` } },
            { website: { [Op.iLike]: `%${senderDomain}%` } }
          ]
        }
      });

      return source;
    } catch (error) {
      console.error('Error finding existing newsletter source:', error);
      return null;
    }
  }

  /**
   * Process webhook email from email service
   */
  async processWebhookEmail(emailData) {
    try {
      console.log('📧 Processing webhook email');

      // Parse email data (adjust based on your email service format)
      let to, subject, html, from, text, receivedAt;

      if (typeof emailData === 'string') {
        const parsed = JSON.parse(emailData);
        to = parsed.to;
        subject = parsed.subject;
        html = parsed.html;
        from = parsed.from;
        text = parsed.text;
        receivedAt = parsed.timestamp ? new Date(parsed.timestamp) : new Date();
      } else {
        to = emailData.to;
        subject = emailData.subject;
        html = emailData.html;
        from = emailData.from;
        text = emailData.text;
        receivedAt = emailData.timestamp ? new Date(emailData.timestamp) : new Date();
      }

      console.log(`📧 Processing email: ${subject} → ${to}`);

      // Find user by inbox email
      const user = await this.findUserByInboxEmail(to);

      if (!user) {
        console.log('❌ No user found for inbox email:', to);
        throw new Error('User not found for inbox email');
      }

      // Process the email content
      const result = await this.processIncomingNewsletter({
        userId: user.id,
        fromEmail: from,
        subject,
        html: html || text,
        text,
        receivedAt
      });

      return result;

    } catch (error) {
      console.error('❌ Email processing error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

}

module.exports = new EmailProcessingService();