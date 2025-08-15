const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  avatar: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  googleId: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  inboxEmail: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  preferredLanguage: {
    type: DataTypes.STRING(5),
    allowNull: true,
    defaultValue: 'en',
    validate: {
      isIn: [['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'sv', 'da', 'no']]
    }
  },
});

module.exports = User;