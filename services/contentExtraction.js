const cheerio = require('cheerio');

class UniversalContentExtractionService {
  async extractContent(emailHtml, newsletterSource) {
    try {
      console.log(`🔍 Extracting content from ${newsletterSource.name}...`);

      const $ = cheerio.load(emailHtml);

      // Clean up the HTML first
      this.cleanHtml($);

      // Extract brand colors from CSS
      const brandColors = this.extractBrandColors($, emailHtml);

      // Extract all content hierarchically
      const sections = this.extractAllContent($);

      // Extract metadata
      const metadata = this.extractMetadata($, newsletterSource, brandColors);

      // Post-process and enhance
      const processed = {
        metadata,
        sections,
        searchText: this.generateSearchText(sections, metadata.title),
        wordCount: this.calculateWordCount(sections),
        tags: this.extractTags(sections, metadata.title),
        extractionConfidence: this.calculateConfidence(sections, metadata)
      };

      console.log(`✅ Extracted ${sections.length} sections from ${newsletterSource.name}`);

      return {
        success: true,
        ...processed
      };

    } catch (error) {
      console.error('❌ Content extraction failed:', error);
      return {
        success: false,
        error: error.message,
        fallback: this.createFallbackContent(emailHtml, newsletterSource)
      };
    }
  }

  cleanHtml($) {
    // Remove unwanted elements
    $('script, style, meta, link').remove();

    // Remove common email cruft
    $('[class*="unsubscribe"], [class*="footer"], [class*="header"], [id*="footer"], [id*="header"]').remove();

    // Remove elements with unsubscribe content
    $('*').each((i, el) => {
      const text = $(el).text().toLowerCase();
      if (text.includes('unsubscribe') ||
          text.includes('privacy policy') ||
          text.includes('manage preferences') ||
          text.includes('view in browser')) {
        $(el).remove();
      }
    });

    // Remove empty elements
    $('*').each((i, el) => {
      const $el = $(el);
      if ($el.text().trim() === '' && $el.find('img').length === 0) {
        $el.remove();
      }
    });
  }

  extractBrandColors($, emailHtml) {
    const colors = { primary: '#6C7BFF', accent: '#1E1E1E' }; // defaults

    try {
      // Extract from inline styles
      const styleRegex = /(?:background-color|color):\s*([#\w]+)/gi;
      const colorMatches = emailHtml.match(styleRegex);

      if (colorMatches) {
        const extractedColors = colorMatches.map(match => {
          const colorMatch = match.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/);
          return colorMatch ? colorMatch[0] : null;
        }).filter(Boolean);

        if (extractedColors.length > 0) {
          colors.primary = extractedColors[0];
          if (extractedColors.length > 1) {
            colors.accent = extractedColors[1];
          }
        }
      }

      // Try to extract from CSS classes/styles
      $('*[style*="color"], *[style*="background"]').each((i, el) => {
        const style = $(el).attr('style');
        if (style) {
          const colorMatch = style.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/);
          if (colorMatch && i === 0) { // Use first found color
            colors.primary = colorMatch[0];
          }
        }
      });
    } catch (error) {
      console.log('Color extraction failed, using defaults');
    }

    return colors;
  }

  extractAllContent($) {
    const sections = [];
    let order = 1;

    // Find meaningful content elements
    const contentElements = $('h1, h2, h3, h4, h5, h6, p, div, table, img, ul, ol').filter((i, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Skip empty elements
      if (text.length === 0 && $el.find('img').length === 0) return false;

      // Skip very short text (except headings and images)
      if (text.length < 10 && !el.tagName.match(/^h[1-6]$/i) && el.tagName !== 'IMG') return false;

      // Skip navigation content
      if (this.isNavigationContent(text)) return false;

      return true;
    });

    contentElements.each((i, element) => {
      const section = this.processElement($, $(element), order);

      if (section) {
        sections.push(section);
        order++;
      }
    });

    return this.mergeRelatedSections(sections);
  }

  processElement($, $el, order) {
    const tagName = $el[0].tagName.toLowerCase();
    const text = this.cleanText($el.text());

    // Skip empty or too short content
    if (text.length < 5) return null;

    const section = {
      id: `section-${order}`,
      order: order,
      type: this.determineSectionType(tagName, text, $el),
      title: '',
      content: text,
      links: this.extractAllLinks($, $el),
      images: this.extractAllImages($, $el)
    };

    // Determine title based on content type
    if (tagName.match(/^h[1-6]$/)) {
      section.title = text;
      section.type = 'heading';
      section.level = parseInt(tagName.substring(1));
    } else if (tagName === 'img') {
      section.type = 'image';
      section.title = $el.attr('alt') || 'Image';
    } else if (tagName === 'table') {
      section.type = 'data_table';
      section.title = 'Data Table';
      section.tableData = this.extractTableData($, $el);
    } else if ($el.find('img').length > 0 && text.length < 100) {
      section.type = 'image_with_caption';
      section.title = text || 'Image';
    } else {
      // For paragraphs and divs, try to extract a title
      const headingBefore = $el.prevAll('h1, h2, h3, h4, h5, h6').first();
      if (headingBefore.length > 0) {
        section.title = this.cleanText(headingBefore.text()).substring(0, 100);
      } else {
        // Use first sentence as title
        const firstSentence = text.split('.')[0];
        section.title = firstSentence.length > 100 ? '' : firstSentence;
      }
    }

    return section;
  }

  determineSectionType(tagName, text, $el) {
    if (tagName.match(/^h[1-6]$/)) {
      return 'heading';
    }

    if (tagName === 'img') {
      return 'image';
    }

    if (tagName === 'table') {
      return 'data_table';
    }

    if ($el.find('img').length > 0) {
      if (text.length < 50) {
        return 'image_with_caption';
      } else {
        return 'article_with_images';
      }
    }

    if ($el.find('a').length > 3) {
      return 'link_collection';
    }

    if (text.includes('📊') || text.includes('📈') || text.includes('📉') ||
        text.includes('%') || text.match(/\$[\d,]+/) || text.match(/[\d,]+%/)) {
      return 'data_highlight';
    }

    if (text.length > 500) {
      return 'article_block';
    }

    if ($el.find('ul, ol').length > 0) {
      return 'list_content';
    }

    return 'text_block';
  }

  extractAllLinks($, $el) {
    const links = [];

    $el.find('a').each((i, link) => {
      const $link = $(link);
      const href = $link.attr('href');
      let text = this.cleanText($link.text());

      if (!href) return;

      // Skip unsubscribe and footer links
      if (text.toLowerCase().includes('unsubscribe') ||
          text.toLowerCase().includes('privacy') ||
          href.includes('unsubscribe')) return;

      // Clean up the URL
      let cleanHref = href;
      if (href.startsWith('http')) {
        cleanHref = href;
      } else if (href.startsWith('//')) {
        cleanHref = 'https:' + href;
      } else if (href.startsWith('/')) {
        return; // Skip relative URLs
      }

      // If no text, try to get context
      if (!text || text.length < 2) {
        text = $link.attr('title') || 'Link';
      }

      // Detect link type
      const linkType = this.detectLinkType(cleanHref, text);

      links.push({
        text: text.substring(0, 200),
        href: cleanHref,
        target: '_blank',
        type: linkType
      });
    });

    return links;
  }

  detectLinkType(href, text) {
    const url = href.toLowerCase();

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return 'video';
    }
    if (url.includes('twitter.com') || url.includes('x.com')) {
      return 'social';
    }
    if (url.includes('linkedin.com')) {
      return 'social';
    }
    if (text.toLowerCase().includes('read more') ||
        text.toLowerCase().includes('continue reading') ||
        text.toLowerCase().includes('full article')) {
      return 'article';
    }
    if (text.toLowerCase().includes('download') || url.includes('.pdf')) {
      return 'download';
    }

    return 'external';
  }

  extractAllImages($, $el) {
    const images = [];

    $el.find('img').each((i, img) => {
      const $img = $(img);
      const src = $img.attr('src') || $img.attr('data-src');
      const alt = $img.attr('alt') || '';
      const width = $img.attr('width');
      const height = $img.attr('height');

      if (!src) return;

      // Skip tracking pixels and tiny images
      if ((width && parseInt(width) < 10) ||
          (height && parseInt(height) < 10) ||
          src.includes('tracking') ||
          src.includes('pixel')) {
        return;
      }

      // Determine image type
      const imageType = this.detectImageType(src, alt);

      images.push({
        src: src.startsWith('http') ? src : `https:${src}`,
        alt: alt,
        caption: alt,
        width: width ? parseInt(width) : null,
        height: height ? parseInt(height) : null,
        type: imageType
      });
    });

    return images;
  }

  detectImageType(src, alt) {
    const srcLower = src.toLowerCase();
    const altLower = alt.toLowerCase();

    if (altLower.includes('chart') || altLower.includes('graph') ||
        altLower.includes('data') || srcLower.includes('chart')) {
      return 'chart';
    }

    if (altLower.includes('logo') || srcLower.includes('logo')) {
      return 'logo';
    }

    if (altLower.includes('product') || altLower.includes('screenshot')) {
      return 'product';
    }

    return 'content';
  }

  extractTableData($, $table) {
    const data = [];

    $table.find('tr').each((i, row) => {
      const rowData = [];
      $(row).find('td, th').each((j, cell) => {
        rowData.push(this.cleanText($(cell).text()));
      });
      if (rowData.some(cell => cell.length > 0)) {
        data.push(rowData);
      }
    });

    return data;
  }

  mergeRelatedSections(sections) {
    // Simple implementation - just return sections as is for now
    return sections;
  }

  extractMetadata($, newsletterSource, brandColors) {
    // Extract title from multiple possible sources
    const titleSources = [
      $('title').text(),
      $('h1').first().text(),
      $('[class*="subject"]').first().text(),
      $('[class*="title"]').first().text(),
      $('[id*="subject"]').first().text()
    ].filter(Boolean);

    const title = titleSources[0] || `${newsletterSource.name} Newsletter`;

    // Try to extract date
    const publishDate = new Date().toISOString();

    return {
      title: this.cleanText(title),
      publishDate: publishDate,
      readTime: '5 min',
      brandColors: brandColors,
      source: newsletterSource.name,
      sourceLogo: newsletterSource.logo,
      sourceWebsite: newsletterSource.website,
      extractedAt: new Date().toISOString()
    };
  }

  generateSearchText(sections, title) {
    let text = title + ' ';
    sections.forEach(section => {
      text += section.title + ' ' + section.content + ' ';
    });
    return text.toLowerCase();
  }

  calculateWordCount(sections) {
    return sections.reduce((count, section) => {
      return count + section.content.split(' ').length;
    }, 0);
  }

  extractTags(sections, title) {
    const allText = (title + ' ' + sections.map(s => s.content).join(' ')).toLowerCase();

    const tagKeywords = {
      'tech': ['technology', 'ai', 'artificial intelligence', 'software', 'app'],
      'business': ['business', 'company', 'revenue', 'profit', 'market'],
      'finance': ['finance', 'money', 'investment', 'stock', 'crypto'],
      'startup': ['startup', 'founder', 'funding', 'venture'],
      'news': ['news', 'breaking', 'update', 'report'],
      'data': ['data', 'chart', 'graph', 'statistics']
    };

    const tags = [];
    for (const [tag, keywords] of Object.entries(tagKeywords)) {
      if (keywords.some(keyword => allText.includes(keyword))) {
        tags.push(tag);
      }
    }

    return tags;
  }

  calculateConfidence(sections, metadata) {
    let score = 0.5;

    if (metadata.title && metadata.title.length > 10) score += 0.2;
    if (sections.length >= 3) score += 0.1;
    if (sections.some(s => s.images && s.images.length > 0)) score += 0.1;
    if (sections.some(s => s.links && s.links.length > 0)) score += 0.1;

    return Math.min(score, 1.0);
  }

  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\t/g, ' ')
      .trim();
  }

  isNavigationContent(text) {
    const lowerText = text.toLowerCase();
    const navKeywords = [
      'unsubscribe',
      'privacy policy',
      'manage preferences',
      'view in browser',
      'forward to a friend',
      'update preferences',
      'contact us'
    ];

    return navKeywords.some(keyword => lowerText.includes(keyword));
  }

  createFallbackContent(emailHtml, newsletterSource) {
    const $ = cheerio.load(emailHtml);

    return {
      metadata: {
        title: `${newsletterSource.name} Newsletter`,
        publishDate: new Date().toISOString(),
        readTime: '5 min',
        brandColors: { primary: '#6C7BFF', accent: '#1E1E1E' }
      },
      sections: [{
        id: 'fallback-1',
        type: 'article_block',
        title: 'Newsletter Content',
        content: $('body').text().substring(0, 1000) + '...',
        order: 1,
        links: [],
        images: []
      }],
      extractionConfidence: 0.3,
      wordCount: 200,
      searchText: $('body').text().toLowerCase(),
      tags: []
    };
  }
}

module.exports = new UniversalContentExtractionService();