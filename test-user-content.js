require('dotenv').config();
const { User, UserNewsletterSubscription, NewsletterContent } = require('./models');

async function testUserContent() {
  try {
    console.log('Testing user content check...');
    
    // Get the existing user
    const user = await User.findOne({ where: { email: 'smith.jamie.developer@gmail.com' } });
    if (!user) {
      console.log('❌ No user found');
      return;
    }
    
    console.log('👤 Found user:', user.email);
    
    // Check for newsletter subscriptions
    const subscriptionCount = await UserNewsletterSubscription.count({
      where: {
        userId: user.id,
        isActive: true
      }
    });
    
    console.log('📧 Active subscriptions:', subscriptionCount);
    
    // Check for newsletter content
    const contentCount = await NewsletterContent.count({
      where: {
        userId: user.id
      }
    });
    
    console.log('📄 Newsletter content:', contentCount);
    
    // Test the checkUserHasContent logic
    const hasContent = subscriptionCount > 0 || contentCount > 0;
    console.log('✅ User has content:', hasContent);
    
    if (hasContent) {
      console.log('🎯 User should go to dashboard');
    } else {
      console.log('🎯 User should go to onboarding');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testUserContent();