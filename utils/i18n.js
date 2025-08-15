const fs = require('fs');
const path = require('path');

class I18nService {
  constructor() {
    this.defaultLanguage = 'en';
    this.supportedLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'sv', 'da', 'no'];
    this.translations = new Map();
    this.loadTranslations();
  }

  loadTranslations() {
    const translationsDir = path.join(__dirname, '../translations');
    
    // Create translations directory if it doesn't exist
    if (!fs.existsSync(translationsDir)) {
      fs.mkdirSync(translationsDir, { recursive: true });
    }

    this.supportedLanguages.forEach(lang => {
      try {
        const translationPath = path.join(translationsDir, `${lang}.json`);
        if (fs.existsSync(translationPath)) {
          const content = fs.readFileSync(translationPath, 'utf-8');
          this.translations.set(lang, JSON.parse(content));
        }
      } catch (error) {
        console.warn(`Failed to load translations for ${lang}:`, error.message);
      }
    });
  }

  detectLanguage(req) {
    // Priority order: URL parameter, user preference, Accept-Language header, default
    
    // 1. Check URL parameter
    if (req.query.lang && this.supportedLanguages.includes(req.query.lang)) {
      return req.query.lang;
    }

    // 2. Check user preference (if user is logged in)
    if (req.user && req.user.preferredLanguage && this.supportedLanguages.includes(req.user.preferredLanguage)) {
      return req.user.preferredLanguage;
    }

    // 3. Check Accept-Language header
    if (req.headers['accept-language']) {
      const acceptedLanguages = this.parseAcceptLanguage(req.headers['accept-language']);
      for (const lang of acceptedLanguages) {
        if (this.supportedLanguages.includes(lang)) {
          return lang;
        }
      }
    }

    // 4. Default language
    return this.defaultLanguage;
  }

  parseAcceptLanguage(acceptLanguageHeader) {
    return acceptLanguageHeader
      .split(',')
      .map(lang => {
        const parts = lang.split(';');
        const code = parts[0].trim().toLowerCase();
        const q = parts[1] ? parseFloat(parts[1].split('=')[1]) : 1.0;
        return { code: code.split('-')[0], q }; // Take only the main language code
      })
      .sort((a, b) => b.q - a.q)
      .map(lang => lang.code);
  }

  translate(key, language = this.defaultLanguage, variables = {}) {
    const translations = this.translations.get(language) || this.translations.get(this.defaultLanguage) || {};
    
    let translation = this.getNestedValue(translations, key);
    
    // Fallback to default language if translation not found
    if (!translation && language !== this.defaultLanguage) {
      const defaultTranslations = this.translations.get(this.defaultLanguage) || {};
      translation = this.getNestedValue(defaultTranslations, key);
    }
    
    // Fallback to key if no translation found
    if (!translation) {
      translation = key;
    }

    // Replace variables in translation
    return this.interpolate(translation, variables);
  }

  getNestedValue(obj, key) {
    return key.split('.').reduce((current, keyPart) => {
      return current && current[keyPart];
    }, obj);
  }

  interpolate(text, variables) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] !== undefined ? variables[key] : match;
    });
  }

  getClientTranslations(language) {
    return this.translations.get(language) || this.translations.get(this.defaultLanguage) || {};
  }

  middleware() {
    return (req, res, next) => {
      const language = this.detectLanguage(req);
      req.language = language;
      
      // Add translation helper to response locals
      res.locals.t = (key, variables) => this.translate(key, language, variables);
      res.locals.language = language;
      res.locals.supportedLanguages = this.supportedLanguages;
      res.locals.translations = this.getClientTranslations(language);
      
      next();
    };
  }

  getSupportedLanguages() {
    return this.supportedLanguages;
  }

  isLanguageSupported(language) {
    return this.supportedLanguages.includes(language);
  }
}

module.exports = new I18nService();