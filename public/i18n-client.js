class I18nClient {
  constructor() {
    this.currentLanguage = 'en';
    this.translations = {};
    this.supportedLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'sv', 'da', 'no'];
    this.initialized = false;
  }

  async init() {
    try {
      // Load current language and translations from server
      const response = await fetch('/api/languages');
      const data = await response.json();
      
      if (data.success) {
        this.currentLanguage = data.current;
        this.supportedLanguages = data.languages.map(lang => lang.code);
      }

      // Load translations for current language
      await this.loadTranslations(this.currentLanguage);
      
      // Apply translations to current page
      this.applyTranslations();
      
      // Update page language attribute
      document.documentElement.lang = this.currentLanguage;
      
      this.initialized = true;
      
      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('i18nInitialized', {
        detail: { language: this.currentLanguage }
      }));
      
    } catch (error) {
      console.warn('Failed to initialize i18n:', error);
      this.initialized = true; // Fail gracefully
    }
  }

  async loadTranslations(language) {
    try {
      const response = await fetch(`/translations/${language}.json`);
      const translations = await response.json();
      this.translations[language] = translations;
    } catch (error) {
      console.warn(`Failed to load translations for ${language}:`, error);
      // Fallback to English if not already trying English
      if (language !== 'en') {
        await this.loadTranslations('en');
      }
    }
  }

  translate(key, variables = {}) {
    const translations = this.translations[this.currentLanguage] || this.translations['en'] || {};
    
    let translation = this.getNestedValue(translations, key);
    
    // Fallback to English if translation not found
    if (!translation && this.currentLanguage !== 'en') {
      const englishTranslations = this.translations['en'] || {};
      translation = this.getNestedValue(englishTranslations, key);
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

  applyTranslations() {
    // Find all elements with data-i18n attributes
    const elements = document.querySelectorAll('[data-i18n]');
    
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      const variables = this.parseVariables(element.getAttribute('data-i18n-vars'));
      const translation = this.translate(key, variables);
      
      // Determine what to update based on element type
      if (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'email')) {
        element.placeholder = translation;
      } else if (element.tagName === 'INPUT' && element.type === 'submit') {
        element.value = translation;
      } else if (element.tagName === 'BUTTON') {
        element.textContent = translation;
      } else if (element.hasAttribute('title')) {
        element.title = translation;
      } else {
        element.textContent = translation;
      }
    });
  }

  parseVariables(varsString) {
    if (!varsString) return {};
    
    try {
      return JSON.parse(varsString);
    } catch (error) {
      console.warn('Failed to parse i18n variables:', varsString);
      return {};
    }
  }

  async changeLanguage(newLanguage) {
    if (!this.supportedLanguages.includes(newLanguage)) {
      console.warn(`Language ${newLanguage} is not supported`);
      return false;
    }

    // Load translations if not already loaded
    if (!this.translations[newLanguage]) {
      await this.loadTranslations(newLanguage);
    }

    this.currentLanguage = newLanguage;
    
    // Update page language attribute
    document.documentElement.lang = newLanguage;
    
    // Apply new translations
    this.applyTranslations();
    
    // Save preference to server if user is authenticated
    try {
      const response = await fetch('/api/user/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          preferredLanguage: newLanguage
        })
      });
      
      const result = await response.json();
      if (!result.success) {
        console.warn('Failed to save language preference:', result.message);
      }
    } catch (error) {
      console.warn('Failed to save language preference:', error);
    }

    // Dispatch event to notify other components
    window.dispatchEvent(new CustomEvent('languageChanged', {
      detail: { language: newLanguage }
    }));

    return true;
  }

  createLanguageSelector(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`Container ${containerId} not found`);
      return;
    }

    const select = document.createElement('select');
    select.className = options.className || 'language-selector';
    
    // Create options for each supported language
    this.supportedLanguages.forEach(code => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = this.translate(`languages.${code}`);
      if (code === this.currentLanguage) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    // Add change event listener
    select.addEventListener('change', (e) => {
      this.changeLanguage(e.target.value);
    });

    container.appendChild(select);
    return select;
  }

  // Helper method to format dates according to current language
  formatDate(date, options = {}) {
    const locale = this.getLocaleFromLanguage(this.currentLanguage);
    return new Intl.DateTimeFormat(locale, options).format(new Date(date));
  }

  getLocaleFromLanguage(language) {
    const localeMap = {
      'en': 'en-US',
      'es': 'es-ES',
      'fr': 'fr-FR',
      'de': 'de-DE',
      'pt': 'pt-PT',
      'it': 'it-IT',
      'nl': 'nl-NL',
      'sv': 'sv-SE',
      'da': 'da-DK',
      'no': 'no-NO'
    };
    return localeMap[language] || 'en-US';
  }
}

// Initialize global i18n instance
window.i18n = new I18nClient();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.i18n.init());
} else {
  window.i18n.init();
}