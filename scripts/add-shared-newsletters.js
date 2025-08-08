require('dotenv').config();

const sequelize = require('../config/database');
const { NewsletterSource, NewsletterContent } = require('../models');

async function addSharedNewsletters() {
  try {
    console.log('🌱 Adding shared newsletters...');

    await sequelize.authenticate();
    console.log('✅ Database connected');

    const sharedNewsletters = [
      {
        name: 'Morning Brew',
        description: 'The daily email newsletter covering the latest news from Wall St. to Silicon Valley',
        website: 'https://morningbrew.com',
        subscriptionUrl: 'https://morningbrew.com/daily/subscribe',
        category: 'business',
        subscriptionType: 'shared',
        isSharedActive: true,
        metadata: {
          isPopular: true,
          frequency: 'daily',
          subscribers: '4000000+',
          tags: ['business', 'finance', 'news']
        }
      },
      {
        name: 'The Hustle',
        description: 'Daily tech and business news in 5 minutes',
        website: 'https://thehustle.co',
        subscriptionUrl: 'https://thehustle.co/subscribe',
        category: 'business',
        subscriptionType: 'shared',
        isSharedActive: true,
        metadata: {
          isPopular: true,
          frequency: 'daily',
          subscribers: '2000000+',
          tags: ['business', 'tech', 'startups']
        }
      },
      {
        name: 'Axios',
        description: 'Smart brevity worthy of your time, attention and trust',
        website: 'https://axios.com',
        subscriptionUrl: 'https://axios.com/newsletters',
        category: 'news',
        subscriptionType: 'shared',
        isSharedActive: true,
        metadata: {
          isPopular: true,
          frequency: 'daily',
          subscribers: '500000+',
          tags: ['news', 'politics', 'business']
        }
      }
    ];

    let created = 0;

    for (const newsletterData of sharedNewsletters) {
      const existing = await NewsletterSource.findOne({
        where: { name: newsletterData.name }
      });

      if (!existing) {
        await NewsletterSource.create(newsletterData);
        console.log(`   ✅ Created shared newsletter: ${newsletterData.name}`);
        created++;
      } else {
        await existing.update({
          subscriptionType: 'shared',
          isSharedActive: true
        });
        console.log(`   🔄 Updated existing newsletter to shared: ${newsletterData.name}`);
      }
    }

    const morningBrew = await NewsletterSource.findOne({
      where: { name: 'Morning Brew' }
    });

    if (morningBrew) {
      const existingContent = await NewsletterContent.findOne({
        where: {
          newsletterSourceId: morningBrew.id,
          contentType: 'shared'
        }
      });

      if (!existingContent) {
        await NewsletterContent.create({
          newsletterSourceId: morningBrew.id,
          contentType: 'shared',
          userId: null,
          originalSubject: 'The daily brew: Tech earnings and market moves',
          originalHtml: `<h1>Good morning, Brew readers ☕</h1><p>Here's what you need to know to start your day.</p><h2>💼 Business Headlines</h2><p>Tech earnings season is in full swing with mixed results</p>`,
          metadata: {
            title: 'The daily brew: Tech earnings and market moves',
            publishDate: new Date().toISOString(),
            readTime: '3 min',
            brandColors: { primary: '#F59E0B', accent: '#EF4444' },
            source: 'Morning Brew'
          },
          sections: [
            {
              id: 'section-1',
              order: 1,
              type: 'heading',
              title: 'Good morning, Brew readers ☕',
              content: 'Good morning, Brew readers ☕',
              level: 1,
              links: [],
              images: []
            }
          ],
          processingStatus: 'completed',
          extractionConfidence: 0.95,
          wordCount: 120,
          searchText: 'business tech earnings market',
          tags: ['business', 'tech', 'earnings'],
          receivedAt: new Date()
        });
        console.log(`   ✅ Created sample shared content for Morning Brew`);
      }
    }

    console.log('\n🎉 Shared newsletters setup completed!');

  } catch (error) {
    console.error('❌ Error adding shared newsletters:', error);
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  addSharedNewsletters();
}

module.exports = addSharedNewsletters;