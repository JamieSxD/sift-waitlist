require('dotenv').config();
const sequelize = require('../config/database');

async function forceAddColumns() {
  try {
    console.log('🔧 Force adding database columns...');

    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Add columns to NewsletterSources
    try {
      await sequelize.query(`
        ALTER TABLE "NewsletterSources"
        ADD COLUMN "subscriptionType" VARCHAR(255) DEFAULT 'individual'
      `);
      console.log('✅ Added subscriptionType to NewsletterSources');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⏭️ subscriptionType already exists');
      } else {
        console.error('❌ Error adding subscriptionType:', error.message);
      }
    }

    try {
      await sequelize.query(`
        ALTER TABLE "NewsletterSources"
        ADD COLUMN "isSharedActive" BOOLEAN DEFAULT false
      `);
      console.log('✅ Added isSharedActive to NewsletterSources');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⏭️ isSharedActive already exists');
      } else {
        console.error('❌ Error adding isSharedActive:', error.message);
      }
    }

    // Add column to UserNewsletterSubscriptions
    try {
      await sequelize.query(`
        ALTER TABLE "UserNewsletterSubscriptions"
        ADD COLUMN "subscriptionMethod" VARCHAR(255) DEFAULT 'individual_forwarding'
      `);
      console.log('✅ Added subscriptionMethod to UserNewsletterSubscriptions');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⏭️ subscriptionMethod already exists');
      } else {
        console.error('❌ Error adding subscriptionMethod:', error.message);
      }
    }

    // Add columns to NewsletterContents
    try {
      await sequelize.query(`
        ALTER TABLE "NewsletterContents"
        ADD COLUMN "contentType" VARCHAR(255) DEFAULT 'individual'
      `);
      console.log('✅ Added contentType to NewsletterContents');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⏭️ contentType already exists');
      } else {
        console.error('❌ Error adding contentType:', error.message);
      }
    }

    try {
      await sequelize.query(`
        ALTER TABLE "NewsletterContents"
        ADD COLUMN "userId" UUID REFERENCES "Users"("id")
      `);
      console.log('✅ Added userId to NewsletterContents');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⏭️ userId already exists');
      } else {
        console.error('❌ Error adding userId:', error.message);
      }
    }

    console.log('🎉 All columns added successfully!');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sequelize.close();
  }
}

forceAddColumns();