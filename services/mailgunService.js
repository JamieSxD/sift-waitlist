const Mailgun = require('mailgun.js');
const formData = require('form-data');
const crypto = require('crypto');

class MailgunService {
  constructor() {
    this.apiKey = process.env.MAILGUN_API_KEY;
    this.domain = process.env.MAILGUN_DOMAIN || 'inbox.siftly.space';
    this.webhookSigningKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    
    if (this.apiKey) {
      const mailgun = new Mailgun(formData);
      this.mg = mailgun.client({
        username: 'api',
        key: this.apiKey
      });
      console.log('✅ Mailgun service initialized');
    } else {
      console.log('⚠️ Mailgun API key not found - webhook processing only');
    }
  }

  /**
   * Verify Mailgun webhook signature for security
   */
  verifyWebhookSignature(signature, timestamp, token) {
    if (!this.webhookSigningKey) {
      console.log('⚠️ No webhook signing key configured - skipping verification');
      return true; // In development, skip verification if no key
    }

    const encodedToken = crypto
      .createHmac('sha256', this.webhookSigningKey)
      .update(timestamp.concat(token))
      .digest('hex');

    return signature === encodedToken;
  }

  /**
   * Parse Mailgun webhook data into standardized format
   */
  parseMailgunWebhook(webhookData) {
    try {
      // Mailgun sends form data, not JSON
      const eventData = webhookData;

      // Extract email details from Mailgun webhook
      const to = eventData.recipient || eventData.To;
      const from = eventData.sender || eventData.From;
      const subject = eventData.subject || eventData.Subject;
      const htmlBody = eventData['body-html'] || eventData.html;
      const textBody = eventData['body-plain'] || eventData.text;
      const timestamp = eventData.timestamp ? new Date(eventData.timestamp * 1000) : new Date();

      // Additional Mailgun metadata
      const messageId = eventData['Message-Id'] || eventData['message-id'];
      const messageUrl = eventData['message-url'];

      return {
        to,
        from,
        subject,
        html: htmlBody,
        text: textBody,
        timestamp,
        messageId,
        messageUrl,
        raw: eventData
      };
    } catch (error) {
      console.error('❌ Error parsing Mailgun webhook:', error);
      throw new Error('Invalid webhook data format');
    }
  }

  /**
   * Set up domain and webhooks (for initial configuration)
   */
  async setupDomain() {
    if (!this.mg) {
      throw new Error('Mailgun not initialized - check API key');
    }

    try {
      // Add domain if not exists
      const domains = await this.mg.domains.list();
      const domainExists = domains.items.some(d => d.name === this.domain);

      if (!domainExists) {
        console.log(`🔧 Adding domain ${this.domain} to Mailgun...`);
        await this.mg.domains.create({
          name: this.domain,
          smtp_password: crypto.randomBytes(16).toString('hex')
        });
        console.log('✅ Domain added successfully');
      } else {
        console.log('✅ Domain already configured');
      }

      return true;
    } catch (error) {
      console.error('❌ Error setting up domain:', error);
      throw error;
    }
  }

  /**
   * Configure webhook endpoints
   */
  async setupWebhooks(webhookUrl) {
    if (!this.mg) {
      throw new Error('Mailgun not initialized - check API key');
    }

    try {
      // List existing webhooks
      const webhooks = await this.mg.webhooks.list(this.domain);
      
      // Check if webhook already exists
      const webhookExists = webhooks.find(w => w.url === webhookUrl);
      
      if (!webhookExists) {
        console.log(`🔧 Setting up webhook: ${webhookUrl}`);
        
        // Create webhook for received emails
        await this.mg.webhooks.create(this.domain, {
          id: 'received',
          url: webhookUrl
        });
        
        console.log('✅ Webhook configured successfully');
      } else {
        console.log('✅ Webhook already configured');
      }

      return true;
    } catch (error) {
      console.error('❌ Error setting up webhooks:', error);
      throw error;
    }
  }

  /**
   * Get domain information and DNS records
   */
  async getDomainInfo() {
    if (!this.mg) {
      throw new Error('Mailgun not initialized - check API key');
    }

    try {
      const domain = await this.mg.domains.get(this.domain);
      return domain;
    } catch (error) {
      console.error('❌ Error getting domain info:', error);
      throw error;
    }
  }

  /**
   * Send test email (for validation)
   */
  async sendTestEmail(to, from = `test@${this.domain}`) {
    if (!this.mg) {
      throw new Error('Mailgun not initialized - check API key');
    }

    try {
      const messageData = {
        from,
        to,
        subject: 'Test Email from Sift',
        text: 'This is a test email to verify Mailgun configuration.',
        html: `
          <h2>Test Email from Sift</h2>
          <p>This is a test email to verify that your Mailgun configuration is working correctly.</p>
          <p><strong>Domain:</strong> ${this.domain}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        `
      };

      const response = await this.mg.messages.create(this.domain, messageData);
      console.log('✅ Test email sent:', response.id);
      return response;
    } catch (error) {
      console.error('❌ Error sending test email:', error);
      throw error;
    }
  }
}

module.exports = new MailgunService();