// services/newsletterDetection.js
const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');

class NewsletterDetectionService {
  constructor() {
    // Common newsletter platforms and their patterns
    this.platformPatterns = {
      substack: {
        pattern: /substack\.com/i,
        subscriptionPath: '/subscribe',
        logoSelector: 'img[class*="logo"], .navbar-brand img, .publication-logo img',
        titleSelector: '.publication-name, .navbar-brand, h1, title',
        descriptionSelector: '.publication-description, .subtitle, meta[name="description"]'
      },
      mailchimp: {
        pattern: /mailchimp\.com|us\d+\.list-manage\.com/i,
        subscriptionPath: '',
        logoSelector: '.brand img, .header img, img[alt*="logo"]',
        titleSelector: '.brand, .header h1, h1, title',
        descriptionSelector: '.description, p, meta[name="description"]'
      },
      convertkit: {
        pattern: /convertkit\.com|ck\.page/i,
        subscriptionPath: '',
        logoSelector: '.formkit-image img, .logo img, img[class*="logo"]',
        titleSelector: '.formkit-header, h1, h2, title',
        descriptionSelector: '.formkit-subheader, .description, p, meta[name="description"]'
      },
      beehiiv: {
        pattern: /beehiiv\.com/i,
        subscriptionPath: '/subscribe',
        logoSelector: '.publication-logo img, .header img, img[class*="logo"]',
        titleSelector: '.publication-name, h1, title',
        descriptionSelector: '.publication-description, .subtitle, meta[name="description"]'
      },
      ghost: {
        pattern: /ghost\.io|\.ghost\.io/i,
        subscriptionPath: '/subscribe',
        logoSelector: '.site-logo img, .brand img, img[class*="logo"]',
        titleSelector: '.site-title, .brand, h1, title',
        descriptionSelector: '.site-description, .description, meta[name="description"]'
      }
    };

    this.timeout = 10000; // 10 seconds
  }

  async detectNewsletter(inputUrl) {
    try {
      // Normalize URL
      const normalizedUrl = this.normalizeUrl(inputUrl);
      if (!normalizedUrl) {
        return {
          success: false,
          message: 'Invalid URL provided'
        };
      }

      // Fetch page content
      const pageContent = await this.fetchPageContent(normalizedUrl);
      if (!pageContent.success) {
        return pageContent;
      }

      const $ = cheerio.load(pageContent.html);

      // Detect platform
      const platform = this.detectPlatform(normalizedUrl);

      // Extract newsletter information
      const newsletterInfo = await this.extractNewsletterInfo($, normalizedUrl, platform);

      return {
        success: true,
        ...newsletterInfo
      };

    } catch (error) {
      console.error('Newsletter detection error:', error);
      return {
        success: false,
        message: 'Failed to analyze the provided URL'
      };
    }
  }

  normalizeUrl(inputUrl) {
    try {
      // Add protocol if missing
      if (!inputUrl.startsWith('http://') && !inputUrl.startsWith('https://')) {
        inputUrl = 'https://' + inputUrl;
      }

      const parsedUrl = new URL(inputUrl);

      // Basic validation
      if (!parsedUrl.hostname || parsedUrl.hostname === 'localhost') {
        return null;
      }

      return parsedUrl.href;
    } catch (error) {
      return null;
    }
  }

  async fetchPageContent(url) {
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SiftBot/1.0; +https://sift.example.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 400
      });

      return {
        success: true,
        html: response.data,
        finalUrl: response.request.res.responseUrl || url
      };

    } catch (error) {
      console.error('Error fetching page:', error.message);

      if (error.code === 'ENOTFOUND') {
        return {
          success: false,
          message: 'Website not found. Please check the URL.'
        };
      } else if (error.code === 'ECONNREFUSED') {
        return {
          success: false,
          message: 'Connection refused. The website may be temporarily unavailable.'
        };
      } else if (error.response?.status === 404) {
        return {
          success: false,
          message: 'Page not found (404). Please check the URL.'
        };
      } else if (error.response?.status >= 500) {
        return {
          success: false,
          message: 'Server error. The website may be temporarily unavailable.'
        };
      } else {
        return {
          success: false,
          message: 'Unable to access the website. Please check the URL and try again.'
        };
      }
    }
  }

  detectPlatform(url) {
    for (const [platform, config] of Object.entries(this.platformPatterns)) {
      if (config.pattern.test(url)) {
        return platform;
      }
    }
    return 'unknown';
  }

  extractNewsletterInfo($, url, platform) {
    const config = this.platformPatterns[platform] || {};

    // Extract title
    const title = this.extractTitle($, config.titleSelector);

    // Extract description
    const description = this.extractDescription($, config.descriptionSelector);

    // Extract logo
    const logo = this.extractLogo($, config.logoSelector, url);

    // Determine subscription URL
    const subscriptionUrl = this.determineSubscriptionUrl(url, platform, $);

    // Determine category
    const category = this.guessCategory(title, description, url);

    // Parse domain for website name
    const websiteName = this.extractWebsiteName(url);

    return {
      name: title || websiteName,
      description: description || `Newsletter from ${websiteName}`,
      website: this.getBaseUrl(url),
      subscriptionUrl,
      logo,
      category,
      metadata: {
        platform,
        detectedAt: new Date().toISOString(),
        originalUrl: url,
        confidence: this.calculateConfidence(title, description, subscriptionUrl)
      }
    };
  }

  extractTitle($, selectors) {
    if (!selectors) {
      selectors = 'h1, .title, .publication-name, .site-title, title';
    }

    const candidates = [];

    selectors.split(',').forEach(selector => {
      $(selector.trim()).each((i, el) => {
        let text = $(el).text().trim();
        if (text && text.length > 0 && text.length < 100) {
          candidates.push(text);
        }
      });
    });

    // Filter out generic titles
    const filtered = candidates.filter(title =>
      !/(sign up|subscribe|newsletter|email)/i.test(title) ||
      title.length > 20
    );

    return filtered[0] || candidates[0] || '';
  }

  extractDescription($, selectors) {
    if (!selectors) {
      selectors = 'meta[name="description"], .description, .subtitle, .tagline, p';
    }

    const candidates = [];

    // Try meta description first
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc && metaDesc.trim().length > 10) {
      candidates.push(metaDesc.trim());
    }

    // Try other selectors
    selectors.split(',').forEach(selector => {
      $(selector.trim()).each((i, el) => {
        let text;
        if ($(el).attr('content')) {
          text = $(el).attr('content');
        } else {
          text = $(el).text().trim();
        }

        if (text && text.length > 10 && text.length < 300) {
          candidates.push(text);
        }
      });
    });

    // Filter and return best description
    const filtered = candidates.filter(desc =>
      desc.length > 20 &&
      !/(subscribe|sign up|enter your email)/i.test(desc)
    );

    return filtered[0] || candidates[0] || '';
  }

  extractLogo($, selectors, baseUrl) {
    if (!selectors) {
      selectors = 'img[class*="logo"], .logo img, .brand img, .header img';
    }

    let logoUrl = '';

    selectors.split(',').forEach(selector => {
      if (!logoUrl) {
        const img = $(selector.trim()).first();
        if (img.length) {
          const src = img.attr('src') || img.attr('data-src');
          if (src) {
            logoUrl = this.resolveUrl(src, baseUrl);
          }
        }
      }
    });

    // Fallback to favicon
    if (!logoUrl) {
      const favicon = $('link[rel*="icon"]').attr('href');
      if (favicon) {
        logoUrl = this.resolveUrl(favicon, baseUrl);
      }
    }

    return logoUrl;
  }

  determineSubscriptionUrl(url, platform, $) {
    const config = this.platformPatterns[platform];

    // Try to find subscription forms or links
    const subscriptionSelectors = [
      'a[href*="subscribe"]',
      'a[href*="signup"]',
      'a[href*="join"]',
      'form[action*="subscribe"]',
      'form[action*="signup"]'
    ];

    let foundUrl = '';

    subscriptionSelectors.forEach(selector => {
      if (!foundUrl) {
        const link = $(selector).first();
        if (link.length) {
          const href = link.attr('href') || link.attr('action');
          if (href) {
            foundUrl = this.resolveUrl(href, url);
          }
        }
      }
    });

    if (foundUrl) {
      return foundUrl;
    }

    // Use platform-specific patterns
    if (config?.subscriptionPath) {
      const baseUrl = this.getBaseUrl(url);
      return baseUrl + config.subscriptionPath;
    }

    // Return the original URL as fallback
    return url;
  }

  guessCategory(title, description, url) {
    const text = `${title} ${description} ${url}`.toLowerCase();

    const categoryKeywords = {
      tech: ['tech', 'technology', 'programming', 'developer', 'code', 'software', 'ai', 'artificial intelligence'],
      business: ['business', 'startup', 'entrepreneur', 'finance', 'investing', 'economy', 'market'],
      design: ['design', 'ux', 'ui', 'creative', 'art', 'visual'],
      finance: ['finance', 'investing', 'money', 'crypto', 'stocks', 'trading'],
      news: ['news', 'daily', 'weekly', 'current events', 'politics'],
      lifestyle: ['lifestyle', 'health', 'wellness', 'personal', 'productivity'],
      marketing: ['marketing', 'growth', 'seo', 'social media', 'advertising']
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return category;
      }
    }

    return 'other';
  }

  calculateConfidence(title, description, subscriptionUrl) {
    let score = 0;

    if (title && title.length > 3) score += 30;
    if (description && description.length > 20) score += 25;
    if (subscriptionUrl && subscriptionUrl.includes('subscribe')) score += 25;
    if (title && description && !title.includes(description.substring(0, 20))) score += 20;

    return Math.min(score, 100);
  }

  resolveUrl(relativeUrl, baseUrl) {
    try {
      return new URL(relativeUrl, baseUrl).href;
    } catch (error) {
      return relativeUrl;
    }
  }

  getBaseUrl(fullUrl) {
    try {
      const parsed = new URL(fullUrl);
      return `${parsed.protocol}//${parsed.hostname}`;
    } catch (error) {
      return fullUrl;
    }
  }

  extractWebsiteName(url) {
    try {
      const parsed = new URL(url);
      let hostname = parsed.hostname.replace(/^www\./, '');

      // Remove common subdomains
      hostname = hostname.replace(/^(newsletter|blog|news|mail)\./, '');

      // Capitalize first letter
      return hostname.split('.')[0].charAt(0).toUpperCase() +
             hostname.split('.')[0].slice(1);
    } catch (error) {
      return 'Newsletter';
    }
  }
}

module.exports = new NewsletterDetectionService();