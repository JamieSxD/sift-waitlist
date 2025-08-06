#!/usr/bin/env node

require('dotenv').config();

const { sequelize, NewsletterSource } = require('../models');

async function seedNewsletters() {
  try {
    console.log('🌱 Seeding newsletter data...');

    // Connect to database
    await sequelize.authenticate();
    console.log('📊 Database connected');

    // Sync models (create tables)
    await sequelize.sync();
    console.log('📊 Database models synchronized');

    const newsletters = [
      {
        name: 'Morning Brew',
        description: 'Business news made simple - get smarter in just 5 minutes',
        website: 'https://morningbrew.com',
        category: 'business',
        metadata: {
          frequency: 'daily',
          averageLength: 'medium'
        }
      },
      {
        name: 'The Hustle',
        description: 'Tech and business news with personality',
        website: 'https://thehustle.co',
        category: 'tech',
        metadata: {
          frequency: 'daily',
          averageLength: 'short'
        }
      },
      {
        name: 'Axios',
        description: 'Get smarter, faster with news that matters',
        website: 'https://axios.com',
        category: 'news',
        metadata: {
          frequency: 'daily',
          averageLength: 'short'
        }
      },
      {
        name: 'Benedict Evans',
        description: 'Tech strategy and insights from a leading venture capitalist',
        website: 'https://benedictevans.com',
        category: 'tech',
        metadata: {
          frequency: 'weekly',
          averageLength: 'long'
        }
      },
      {
        name: 'Dense Discovery',
        description: 'A weekly design newsletter with a focus on sustainability',
        website: 'https://densediscovery.com',
        category: 'design',
        metadata: {
          frequency: 'weekly',
          averageLength: 'medium'
        }
      },
      {
        name: 'Really Good Emails',
        description: 'Email design inspiration and best practices',
        website: 'https://reallygoodemails.com',
        category: 'design',
        metadata: {
          frequency: 'weekly',
          averageLength: 'short'
        }
      }
    ];

    for (const newsletter of newsletters) {
      await NewsletterSource.findOrCreate({
        where: { name: newsletter.name },
        defaults: newsletter
      });
    }

    console.log(`✅ Created/updated ${newsletters.length} newsletters`);
    console.log('🎉 Newsletter seeding complete!');

  } catch (error) {
    console.error('❌ Error seeding newsletters:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run if called directly
if (require.main === module) {
  seedNewsletters();
}

module.exports = { seedNewsletters };