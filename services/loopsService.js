const { LoopsClient, APIError, RateLimitExceededError } = require('loops');

class LoopsService {
  constructor() {
    if (!process.env.LOOPS_API_KEY) {
      console.warn('⚠️  LOOPS_API_KEY not found - Loops integration disabled');
      this.loops = null;
      return;
    }

    this.loops = new LoopsClient(process.env.LOOPS_API_KEY);
    this.isEnabled = true;
    console.log('✅ Loops service initialized');
  }

  /**
   * Test the API connection
   */
  async testConnection() {
    if (!this.loops) return { success: false, message: 'Loops not configured' };

    try {
      await this.loops.testApiKey();
      console.log('✅ Loops API connection successful');
      return { success: true };
    } catch (error) {
      console.error('❌ Loops API connection failed:', error.message);
      return { success: false, message: error.message };
    }
  }

  /**
   * Add email to Loops waitlist
   * @param {string} email - The email address to add
   * @returns {Promise<Object>} - Result object
   */
  async addToWaitlist(email) {
    // If Loops is not configured, just return success (fallback gracefully)
    if (!this.loops) {
      console.log('ℹ️  Loops not configured - skipping email addition');
      return { success: true, message: 'Email saved locally' };
    }

    try {
      console.log(`📧 Adding email to Loops: ${email}`);

      // Create contact with basic properties
      const contactProperties = {
        source: 'sift-waitlist',
        signupDate: new Date().toISOString()
      };

      const response = await this.loops.createContact(email, contactProperties);

      console.log('✅ Email added to Loops successfully:', email);

      // Send welcome event to trigger any email sequences
      try {
        await this.loops.sendEvent({
          email: email,
          eventName: 'waitlist_joined',
          eventProperties: {
            source: 'website',
            timestamp: new Date().toISOString()
          }
        });
        console.log('✅ Welcome event sent to Loops');
      } catch (eventError) {
        console.log('ℹ️  Event sending failed (non-critical):', eventError.message);
      }

      return {
        success: true,
        loops: response,
        message: 'Added to email list'
      };

    } catch (error) {
      return this.handleError(error, email);
    }
  }

  /**
   * Handle Loops API errors
   * @private
   */
  handleError(error, email) {
    if (error instanceof RateLimitExceededError) {
      console.error(`🚫 Loops rate limit exceeded for: ${email}`);
      return {
        success: false,
        error: 'rate_limit',
        message: 'Too many requests - please try again later'
      };
    }

    if (error instanceof APIError) {
      console.error(`❌ Loops API error for ${email}:`, {
        status: error.statusCode,
        message: error.json?.message
      });

      // Handle duplicate email (409 conflict)
      if (error.statusCode === 409) {
        console.log(`ℹ️  Email already exists in Loops: ${email}`);
        return {
          success: true, // Treat as success since email is already in system
          message: 'Email already in our system'
        };
      }

      // Handle other API errors
      return {
        success: false,
        error: 'api_error',
        message: 'Email service temporarily unavailable'
      };
    }

    // Handle unexpected errors
    console.error(`❌ Unexpected Loops error for ${email}:`, error);
    return {
      success: false,
      error: 'unknown',
      message: 'Email service error'
    };
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      enabled: !!this.loops,
      configured: !!process.env.LOOPS_API_KEY
    };
  }
}

// Create and export singleton instance
const loopsService = new LoopsService();

module.exports = loopsService;