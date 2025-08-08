require('dotenv').config();
const sequelize = require('../config/database');

async function updateDatabase() {
  try {
    console.log('🔄 Updating database schema...');

    // This will add the new columns to existing tables
    await sequelize.sync({ alter: true });

    console.log('✅ Database updated successfully!');
  } catch (error) {
    console.error('❌ Error updating database:', error);
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  updateDatabase();
}