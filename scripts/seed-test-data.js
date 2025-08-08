// scripts/seed-test-data.js
require('dotenv').config();

const sequelize = require('../config/database');
const { NewsletterSource, NewsletterContent } = require('../models');

async function seedTestData() {
  try {
    console.log('🌱 Starting test data seeding...');

    // Connect to database
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Test newsletter sources
    const testSources = [
      {
        name: 'Stratechery',
        description: 'Analysis of the strategy and business side of technology and media, and the impact of technology on society.',
        website: 'https://stratechery.com',
        subscriptionUrl: 'https://stratechery.com/subscribe',
        logo: null,
        category: 'tech',
        metadata: {
          isPopular: true,
          subscribers: '100000+',
          frequency: 'weekly',
          tags: ['tech', 'business', 'strategy', 'analysis'],
          description: 'Deep analysis of tech strategy'
        }
      },
      {
        name: 'Morning Brew',
        description: 'The daily email newsletter covering the latest news from Wall St. to Silicon Valley. Business news for the modern professional.',
        website: 'https://morningbrew.com',
        subscriptionUrl: 'https://morningbrew.com/daily/subscribe',
        logo: null,
        category: 'business',
        metadata: {
          isPopular: true,
          subscribers: '4000000+',
          frequency: 'daily',
          tags: ['business', 'finance', 'news', 'markets'],
          description: 'Daily business news digest'
        }
      },
      {
        name: 'The Hustle',
        description: 'Daily tech and business news in 5 minutes. Stories that matter, delivered with personality.',
        website: 'https://thehustle.co',
        subscriptionUrl: 'https://thehustle.co/subscribe',
        logo: null,
        category: 'business',
        metadata: {
          isPopular: true,
          subscribers: '2000000+',
          frequency: 'daily',
          tags: ['business', 'tech', 'startups', 'entrepreneurship'],
          description: 'Quick daily business updates'
        }
      },
      {
        name: 'Benedict Evans',
        description: 'Trying to understand how tech changes things. Weekly newsletter about technology and society.',
        website: 'https://www.ben-evans.com',
        subscriptionUrl: 'https://www.ben-evans.com/newsletter',
        logo: null,
        category: 'tech',
        metadata: {
          isPopular: true,
          subscribers: '50000+',
          frequency: 'weekly',
          tags: ['tech', 'society', 'trends', 'analysis'],
          description: 'Tech trends and societal impact'
        }
      },
      {
        name: 'Not Boring',
        description: 'Strategy, business, and finance made simple. Weekly deep-dives into the strategy and business side of tech.',
        website: 'https://www.notboring.co',
        subscriptionUrl: 'https://www.notboring.co/subscribe',
        logo: null,
        category: 'tech',
        metadata: {
          isPopular: true,
          subscribers: '75000+',
          frequency: 'weekly',
          tags: ['strategy', 'business', 'finance', 'startups'],
          description: 'Strategy and business analysis'
        }
      },
      {
        name: 'Axios',
        description: 'Smart brevity worthy of your time, attention and trust. Essential news and analysis.',
        website: 'https://axios.com',
        subscriptionUrl: 'https://axios.com/newsletters',
        logo: null,
        category: 'news',
        metadata: {
          isPopular: true,
          subscribers: '500000+',
          frequency: 'daily',
          tags: ['news', 'politics', 'business', 'technology'],
          description: 'Essential news and analysis'
        }
      }
    ];

    console.log('📝 Creating newsletter sources...');

    for (const sourceData of testSources) {
      // Check if source already exists
      let source = await NewsletterSource.findOne({
        where: { name: sourceData.name }
      });

      if (!source) {
        source = await NewsletterSource.create(sourceData);
        console.log(`   ✅ Created: ${source.name}`);
      } else {
        console.log(`   ⏭️  Already exists: ${source.name}`);
      }
    }

    // Create sample newsletter content for Stratechery
    const stratecherySource = await NewsletterSource.findOne({
      where: { name: 'Stratechery' }
    });

    if (stratecherySource) {
      console.log('📄 Creating sample newsletter content...');

      const sampleContent = {
        newsletterSourceId: stratecherySource.id,
        originalSubject: 'Weekly Update: The State of Tech in 2025',
        originalHtml: `
          <h1>The State of Tech in 2025</h1>
          <p>Welcome to this week's analysis of the technology landscape.</p>

          <h2>🤖 AI Developments</h2>
          <p>This week saw significant developments in artificial intelligence, with several major companies announcing new models and capabilities. The race for AI supremacy continues to intensify.</p>

          <h2>📱 Mobile Platform Updates</h2>
          <p>Both iOS and Android received major updates this week, focusing on privacy and user control. These changes will have significant implications for app developers and advertisers.</p>

          <h2>💰 Market Analysis</h2>
          <p>Tech stocks showed mixed performance this week:</p>
          <ul>
            <li>Apple: +2.3%</li>
            <li>Google: -1.1%</li>
            <li>Microsoft: +0.8%</li>
            <li>Meta: +3.2%</li>
          </ul>

          <h2>🚀 Startup News</h2>
          <p>Several notable funding rounds this week:</p>
          <ul>
            <li>AI startup raises $50M Series B</li>
            <li>Climate tech company secures $30M</li>
            <li>Fintech unicorn announces $100M Series C</li>
          </ul>

          <p>That's all for this week. Thanks for reading!</p>
        `,
        metadata: {
          title: 'The State of Tech in 2025',
          publishDate: new Date().toISOString(),
          readTime: '7 min',
          brandColors: {
            primary: '#1E40AF',
            accent: '#3B82F6'
          },
          source: 'Stratechery',
          extractedAt: new Date().toISOString()
        },
        sections: [
          {
            id: 'section-1',
            order: 1,
            type: 'heading',
            title: 'The State of Tech in 2025',
            content: 'The State of Tech in 2025',
            level: 1,
            links: [],
            images: []
          },
          {
            id: 'section-2',
            order: 2,
            type: 'text_block',
            title: 'Introduction',
            content: 'Welcome to this week\'s analysis of the technology landscape.',
            links: [],
            images: []
          },
          {
            id: 'section-3',
            order: 3,
            type: 'data_highlight',
            title: '🤖 AI Developments',
            content: 'This week saw significant developments in artificial intelligence, with several major companies announcing new models and capabilities. The race for AI supremacy continues to intensify.',
            links: [],
            images: []
          },
          {
            id: 'section-4',
            order: 4,
            type: 'article_block',
            title: '📱 Mobile Platform Updates',
            content: 'Both iOS and Android received major updates this week, focusing on privacy and user control. These changes will have significant implications for app developers and advertisers.',
            links: [],
            images: []
          },
          {
            id: 'section-5',
            order: 5,
            type: 'data_highlight',
            title: '💰 Market Analysis',
            content: 'Tech stocks showed mixed performance this week: Apple: +2.3%, Google: -1.1%, Microsoft: +0.8%, Meta: +3.2%',
            links: [],
            images: []
          },
          {
            id: 'section-6',
            order: 6,
            type: 'text_block',
            title: '🚀 Startup News',
            content: 'Several notable funding rounds this week: AI startup raises $50M Series B, Climate tech company secures $30M, Fintech unicorn announces $100M Series C',
            links: [],
            images: []
          }
        ],
        processingStatus: 'completed',
        extractionConfidence: 0.95,
        wordCount: 185,
        searchText: 'tech ai artificial intelligence mobile ios android market analysis stocks startup funding',
        tags: ['tech', 'ai', 'mobile', 'startups', 'market'],
        receivedAt: new Date()
      };

      // Check if content already exists
      const existingContent = await NewsletterContent.findOne({
        where: {
          newsletterSourceId: stratecherySource.id,
          originalSubject: sampleContent.originalSubject
        }
      });

      if (!existingContent) {
        await NewsletterContent.create(sampleContent);
        console.log('   ✅ Created sample newsletter content');
      } else {
        console.log('   ⏭️  Sample content already exists');
      }
    }

    console.log('🎉 Test data seeding completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   • Newsletter sources: ${testSources.length}`);
    console.log(`   • Sample content: 1`);
    console.log('\n🚀 You can now test the dashboard with real data!');

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
  } finally {
    await sequelize.close();
  }
}

// Run the seeding if this file is executed directly
if (require.main === module) {
  seedTestData();
}

module.exports = seedTestData;