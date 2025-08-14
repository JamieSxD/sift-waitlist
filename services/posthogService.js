const { PostHog } = require('posthog-node');

class PostHogService {
  constructor() {
    this.client = null;
    this.initialize();
  }

  initialize() {
    if (!process.env.POSTHOG_API_KEY) {
      console.warn('⚠️ PostHog API key not found. Analytics will be disabled.');
      return;
    }

    this.client = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
    });

    console.log('✅ PostHog analytics initialized');
  }

  // Track user events
  track(userId, event, properties = {}) {
    if (!this.client) {
      console.warn('⚠️ PostHog client not initialized, skipping event:', event);
      return;
    }

    try {
      console.log('📊 PostHog tracking event:', event, 'for user:', userId, 'with properties:', properties);
      this.client.capture({
        distinctId: userId,
        event,
        properties: {
          ...properties,
          timestamp: new Date(),
          source: 'backend'
        }
      });
      console.log('✅ PostHog event sent successfully');
    } catch (error) {
      console.error('❌ PostHog tracking error:', error);
    }
  }

  // Identify user
  identify(userId, properties = {}) {
    if (!this.client) return;

    try {
      this.client.identify({
        distinctId: userId,
        properties: {
          ...properties,
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('❌ PostHog identify error:', error);
    }
  }

  // Track authentication events
  trackAuth(userId, event, properties = {}) {
    this.track(userId, `auth_${event}`, {
      ...properties,
      category: 'authentication'
    });
  }

  // Track subscription events
  trackSubscription(userId, event, subscriptionType, properties = {}) {
    this.track(userId, `subscription_${event}`, {
      ...properties,
      subscription_type: subscriptionType,
      category: 'subscription'
    });
  }

  // Track content interaction events
  trackContentInteraction(userId, event, contentType, properties = {}) {
    this.track(userId, `content_${event}`, {
      ...properties,
      content_type: contentType,
      category: 'content'
    });
  }

  // Track YouTube events
  trackYouTube(userId, event, properties = {}) {
    this.track(userId, `youtube_${event}`, {
      ...properties,
      category: 'youtube'
    });
  }

  // Track newsletter events
  trackNewsletter(userId, event, properties = {}) {
    this.track(userId, `newsletter_${event}`, {
      ...properties,
      category: 'newsletter'
    });
  }

  // Shutdown - ensure events are sent
  async shutdown() {
    if (this.client) {
      try {
        await this.client.shutdown();
        console.log('✅ PostHog client shutdown complete');
      } catch (error) {
        console.error('❌ PostHog shutdown error:', error);
      }
    }
  }
}

// Export singleton instance
module.exports = new PostHogService();