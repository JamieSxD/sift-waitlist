// PostHog configuration for frontend
async function initPostHog() {
    try {
        const response = await fetch('/api/config/posthog');
        const config = await response.json();
        
        if (typeof posthog !== 'undefined' && config.apiKey) {
            posthog.init(config.apiKey, {
                api_host: config.host,
                // Capture pageviews automatically
                capture_pageview: true,
                // Enable session recordings
                session_recording: {
                    maskAllInputs: false,
                    maskInputOptions: {
                        password: true,
                        email: false
                    }
                }
            });
            
            console.log('✅ PostHog initialized');
        } else {
            console.warn('⚠️ PostHog not initialized - missing or invalid API key');
        }
    } catch (error) {
        console.warn('⚠️ Failed to initialize PostHog:', error);
    }
}

// Helper functions for tracking events
window.trackEvent = function(eventName, properties = {}) {
    if (typeof posthog !== 'undefined') {
        posthog.capture(eventName, {
            ...properties,
            timestamp: new Date().toISOString(),
            page: window.location.pathname
        });
    }
};

window.identifyUser = function(userId, properties = {}) {
    if (typeof posthog !== 'undefined') {
        posthog.identify(userId, properties);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', function() {
    initPostHog();
});

// Track page views for single page app navigation
window.trackPageView = function(pageName) {
    if (typeof posthog !== 'undefined') {
        posthog.capture('$pageview', {
            page: pageName || window.location.pathname
        });
    }
};