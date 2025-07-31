// Toast notification system
class ToastManager {
    constructor() {
        this.container = document.getElementById('toast-container');
    }
    
    show(message, type = 'success', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        this.container.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto remove
        setTimeout(() => {
            this.hide(toast);
        }, duration);
        
        return toast;
    }
    
    hide(toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }
}

// Form handler class
class FormHandler {
    constructor(formId, emailId, errorId) {
        this.form = document.getElementById(formId);
        this.emailInput = document.getElementById(emailId);
        this.errorElement = document.getElementById(errorId);
        this.submitBtn = this.form.querySelector('.submit-btn');
        this.toastManager = new ToastManager();
        
        this.init();
    }
    
    init() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        this.emailInput.addEventListener('input', () => this.clearError());
        this.emailInput.addEventListener('blur', () => this.validateEmail());
    }
    
    validateEmail() {
        const email = this.emailInput.value.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (email && !emailRegex.test(email)) {
            this.showError('Please enter a valid email address');
            return false;
        }
        
        this.clearError();
        return true;
    }
    
    showError(message) {
        this.errorElement.textContent = message;
        this.errorElement.classList.add('show');
    }
    
    clearError() {
        this.errorElement.classList.remove('show');
        setTimeout(() => {
            this.errorElement.textContent = '';
        }, 200);
    }
    
    setLoading(loading) {
        if (loading) {
            this.submitBtn.classList.add('loading');
            this.submitBtn.disabled = true;
        } else {
            this.submitBtn.classList.remove('loading');
            this.submitBtn.disabled = false;
        }
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const email = this.emailInput.value.trim();
        
        if (!email) {
            this.showError('Please enter your email address');
            this.emailInput.focus();
            return;
        }
        
        if (!this.validateEmail()) {
            this.emailInput.focus();
            return;
        }
        
        this.setLoading(true);
        this.clearError();
        
        try {
            const response = await fetch('/api/signup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.toastManager.show(data.message, 'success');
                this.emailInput.value = '';
                
                // Add a subtle success animation
                this.form.style.transform = 'scale(0.98)';
                setTimeout(() => {
                    this.form.style.transform = 'scale(1)';
                }, 150);
                
            } else {
                if (response.status === 409) {
                    // Email already exists
                    this.toastManager.show(data.message, 'success');
                    this.emailInput.value = '';
                } else {
                    this.showError(data.message || 'Please enter a valid email address');
                }
            }
            
        } catch (error) {
            console.error('Error:', error);
            this.showError('Something went wrong. Please try again later.');
            this.toastManager.show('Connection error. Please check your internet and try again.', 'error');
        } finally {
            this.setLoading(false);
        }
    }
}

// Initialize forms when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize both forms
    new FormHandler('hero-form', 'hero-email', 'hero-error');
    new FormHandler('cta-form', 'cta-email', 'cta-error');
    
    // Add smooth scrolling enhancement
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add intersection observer for subtle animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);
    
    // Observe sections for fade-in effect
    document.querySelectorAll('.problem-section, .cta-section').forEach(section => {
        section.style.opacity = '0';
        section.style.transform = 'translateY(20px)';
        section.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
        observer.observe(section);
    });
    
    // Add keyboard navigation support
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'BUTTON') {
            e.target.click();
        }
    });
});

// Handle online/offline status
window.addEventListener('online', () => {
    new ToastManager().show('Connection restored', 'success', 2000);
});

window.addEventListener('offline', () => {
    new ToastManager().show('Connection lost. Please check your internet.', 'error', 3000);
});

// Performance optimization: Preload critical resources
if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
        // Preload any additional resources here if needed
    });
}