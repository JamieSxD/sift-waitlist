const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const NewsletterSource = sequelize.define('NewsletterSource', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
  },
  website: {
    type: DataTypes.STRING,
  },
  logo: {
    type: DataTypes.STRING,
  },
  category: {
    type: DataTypes.STRING, // tech, business, lifestyle, etc.
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
});

module.exports = NewsletterSource;