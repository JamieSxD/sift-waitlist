// scripts/seed-newsletters.js
require('dotenv').config();
const { NewsletterSource } = require('../models');

const popularNewsletters = [
  // Tech
  {
    name: "Morning Brew",
    description: "Daily business news that doesn't suck. Get smarter in just 5 minutes.",
    website: "https://morningbrew.com",
    category: "business",
    subscriptionUrl: "https://morningbrew.com/daily/subscribe",
    logo: "https://morningbrew.com/favicon.ico",
    metadata: {
      frequency: "daily",
      subscribers: "4M+",
      isPopular: true,
      tags: ["business", "finance", "startups"]
    }
  },
  {
    name: "The Hustle",
    description: "Business and tech news in 5 minutes. Join 2M+ readers who start their day with The Hustle.",
    website: "https://thehustle.co",
    category: "business",
    subscriptionUrl: "https://thehustle.co/subscribe",
    logo: "https://thehustle.co/favicon.ico",
    metadata: {
      frequency: "daily",
      subscribers: "2M+",
      isPopular: true,
      tags: ["business", "startups", "entrepreneurship"]
    }
  },
  {
    name: "Benedict's Newsletter",
    description: "Weekly analysis of tech and media. Smart insights from a former Andreessen Horowitz partner.",
    website: "https://www.ben-evans.com",
    category: "tech",
    subscriptionUrl: "https://www.ben-evans.com/newsletter",
    logo: "https://www.ben-evans.com/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "200K+",
      isPopular: true,
      tags: ["tech", "analysis", "venture capital"]
    }
  },
  {
    name: "Stratechery",
    description: "Technology strategy analysis. Ben Thompson's essential read for understanding tech business models.",
    website: "https://stratechery.com",
    category: "tech",
    subscriptionUrl: "https://stratechery.com/membership",
    logo: "https://stratechery.com/favicon.ico",
    metadata: {
      frequency: "3x/week",
      subscribers: "100K+",
      isPopular: true,
      tags: ["tech", "strategy", "business models"]
    }
  },
  {
    name: "Dense Discovery",
    description: "A thoughtful weekly newsletter helping you feel less overwhelmed and more inspired.",
    website: "https://densediscovery.com",
    category: "design",
    subscriptionUrl: "https://densediscovery.com/subscribe",
    logo: "https://densediscovery.com/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "70K+",
      isPopular: true,
      tags: ["design", "creativity", "lifestyle"]
    }
  },
  {
    name: "Designer Hangout Newsletter",
    description: "Weekly UX/UI design insights, job opportunities, and community highlights.",
    website: "https://designerhangout.co",
    category: "design",
    subscriptionUrl: "https://designerhangout.co/newsletter",
    logo: "https://designerhangout.co/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "50K+",
      isPopular: false,
      tags: ["design", "UX", "UI", "jobs"]
    }
  },
  {
    name: "Sidebar",
    description: "5 design links, every weekday. The best design news, hand-picked daily.",
    website: "https://sidebar.io",
    category: "design",
    subscriptionUrl: "https://sidebar.io/subscribe",
    logo: "https://sidebar.io/favicon.ico",
    metadata: {
      frequency: "weekdays",
      subscribers: "30K+",
      isPopular: false,
      tags: ["design", "inspiration", "daily"]
    }
  },
  {
    name: "Finimize",
    description: "Daily financial news explained in 3 minutes. Learn finance without the jargon.",
    website: "https://finimize.com",
    category: "finance",
    subscriptionUrl: "https://finimize.com/subscribe",
    logo: "https://finimize.com/favicon.ico",
    metadata: {
      frequency: "daily",
      subscribers: "500K+",
      isPopular: true,
      tags: ["finance", "investing", "markets"]
    }
  },
  {
    name: "Morning Brew - Retail",
    description: "Everything you need to know about retail, delivered to your inbox 3x per week.",
    website: "https://morningbrew.com/retail",
    category: "business",
    subscriptionUrl: "https://morningbrew.com/retail/subscribe",
    logo: "https://morningbrew.com/favicon.ico",
    metadata: {
      frequency: "3x/week",
      subscribers: "100K+",
      isPopular: false,
      tags: ["retail", "business", "ecommerce"]
    }
  },
  {
    name: "Hacker Newsletter",
    description: "Weekly roundup of the best articles from Hacker News. Curated by hand.",
    website: "https://hackernewsletter.com",
    category: "tech",
    subscriptionUrl: "https://hackernewsletter.com/subscribe",
    logo: "https://hackernewsletter.com/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "60K+",
      isPopular: false,
      tags: ["tech", "programming", "startups"]
    }
  },
  {
    name: "Paul Graham Essays",
    description: "New essays from Y Combinator's co-founder about startups, technology, and life.",
    website: "http://paulgraham.com",
    category: "startups",
    subscriptionUrl: "http://paulgraham.com/rss.html",
    logo: "http://paulgraham.com/favicon.ico",
    metadata: {
      frequency: "irregular",
      subscribers: "500K+",
      isPopular: true,
      tags: ["startups", "essays", "Y Combinator"]
    }
  },
  {
    name: "First Round Review",
    description: "In-depth articles on building companies from First Round's portfolio.",
    website: "https://review.firstround.com",
    category: "startups",
    subscriptionUrl: "https://review.firstround.com/subscribe",
    logo: "https://review.firstround.com/favicon.ico",
    metadata: {
      frequency: "2x/month",
      subscribers: "200K+",
      isPopular: true,
      tags: ["startups", "management", "venture capital"]
    }
  },
  {
    name: "The Diff",
    description: "Weekly newsletter about inflection points in finance and technology.",
    website: "https://diff.substack.com",
    category: "finance",
    subscriptionUrl: "https://diff.substack.com/subscribe",
    logo: "https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fbucketeer-e05bbc84-baa3-437e-9518-adb32be77984.s3.amazonaws.com%2Fpublic%2Fimages%2F942e3db9-8b11-4b1e-8dc5-96c0b97a8c7e_256x256.png",
    metadata: {
      frequency: "weekly",
      subscribers: "50K+",
      isPopular: false,
      tags: ["finance", "tech", "analysis"]
    }
  },
  {
    name: "Exponential View",
    description: "Weekly newsletter exploring technology, society, and their intersection.",
    website: "https://exponentialview.co",
    category: "tech",
    subscriptionUrl: "https://exponentialview.co/subscribe",
    logo: "https://exponentialview.co/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "25K+",
      isPopular: false,
      tags: ["tech", "society", "future"]
    }
  },
  {
    name: "Austin Kleon Newsletter",
    description: "Weekly newsletter about creativity, art, and staying curious.",
    website: "https://austinkleon.com",
    category: "creativity",
    subscriptionUrl: "https://austinkleon.com/newsletter",
    logo: "https://austinkleon.com/favicon.ico",
    metadata: {
      frequency: "weekly",
      subscribers: "40K+",
      isPopular: false,
      tags: ["creativity", "art", "writing"]
    }
  }
];

async function seedNewsletters() {
  try {
    console.log('🌱 Starting newsletter seeding...');

    // Clear existing newsletters (optional - comment out if you want to keep existing)
    // await NewsletterSource.destroy({ where: {} });
    // console.log('🗑️  Cleared existing newsletters');

    let created = 0;
    let skipped = 0;

    for (const newsletter of popularNewsletters) {
      try {
        const [newsletterRecord, wasCreated] = await NewsletterSource.findOrCreate({
          where: { name: newsletter.name },
          defaults: newsletter
        });

        if (wasCreated) {
          created++;
          console.log(`✅ Created: ${newsletter.name}`);
        } else {
          skipped++;
          console.log(`⏭️  Skipped: ${newsletter.name} (already exists)`);
        }
      } catch (error) {
        console.error(`❌ Error creating ${newsletter.name}:`, error.message);
      }
    }

    console.log('\n📊 Seeding Summary:');
    console.log(`✅ Created: ${created} newsletters`);
    console.log(`⏭️  Skipped: ${skipped} newsletters`);
    console.log(`📝 Total processed: ${popularNewsletters.length} newsletters`);

    // Show category breakdown
    const categories = popularNewsletters.reduce((acc, newsletter) => {
      acc[newsletter.category] = (acc[newsletter.category] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📂 Category Breakdown:');
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`   ${category}: ${count} newsletters`);
    });

    console.log('\n🎉 Newsletter seeding completed!');

  } catch (error) {
    console.error('❌ Error seeding newsletters:', error);
    throw error;
  }
}

// Run seeding if called directly
if (require.main === module) {
  seedNewsletters()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { seedNewsletters, popularNewsletters };