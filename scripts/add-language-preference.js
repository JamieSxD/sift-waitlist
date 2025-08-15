require('dotenv').config();
const { QueryInterface, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

async function addLanguagePreference() {
  const queryInterface = sequelize.getQueryInterface();
  
  try {
    // Check if the column already exists
    const tableDescription = await queryInterface.describeTable('Users');
    
    if (!tableDescription.preferredLanguage) {
      console.log('Adding preferredLanguage column to Users table...');
      
      await queryInterface.addColumn('Users', 'preferredLanguage', {
        type: DataTypes.STRING(5),
        allowNull: true,
        defaultValue: 'en',
        validate: {
          isIn: [['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'sv', 'da', 'no']]
        }
      });
      
      console.log('✅ Successfully added preferredLanguage column');
      
      // Set default language for existing users
      await sequelize.query(`
        UPDATE "Users" 
        SET "preferredLanguage" = 'en' 
        WHERE "preferredLanguage" IS NULL
      `);
      
      console.log('✅ Set default language for existing users');
      
    } else {
      console.log('👍 preferredLanguage column already exists');
    }
    
  } catch (error) {
    console.error('❌ Error adding language preference:', error);
    throw error;
  }
}

// Run the migration
if (require.main === module) {
  addLanguagePreference()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addLanguagePreference;