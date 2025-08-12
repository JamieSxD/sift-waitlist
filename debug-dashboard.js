require('dotenv').config();
const { User, UserNewsletterSubscription, NewsletterContent } = require('./models');

async function debugDashboardAccess() {
  try {
    console.log('🔍 Debugging dashboard access...');
    
    // Get the existing user
    const user = await User.findOne({ where: { email: 'smith.jamie.developer@gmail.com' } });
    if (!user) {
      console.log('❌ No user found');
      return;
    }
    
    console.log('👤 Found user:', user.email);
    console.log('🆔 User ID:', user.id);
    
    // Check the exact same logic as checkUserHasContent
    console.log('\n📊 Checking user content...');
    
    const newsletterCount = await UserNewsletterSubscription.count({
      where: {
        userId: user.id,
        isActive: true
      }
    });
    console.log('📧 Newsletter subscriptions count:', newsletterCount);
    
    const contentCount = await NewsletterContent.count({
      where: {
        userId: user.id
      }
    });
    console.log('📄 Newsletter content count:', contentCount);
    
    const hasContent = newsletterCount > 0 || contentCount > 0;
    console.log('\n✅ Has content result:', hasContent);
    
    if (hasContent) {
      console.log('🎯 Should allow dashboard access');
    } else {
      console.log('❌ Should redirect to onboarding');
    }
    
    // Test the actual function from server
    const { checkUserHasContent } = require('./server.js');
    if (typeof checkUserHasContent === 'function') {
      const serverResult = await checkUserHasContent(user.id);
      console.log('🖥️ Server function result:', serverResult);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugDashboardAccess();