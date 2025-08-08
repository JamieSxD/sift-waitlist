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
  subscriptionUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  logo: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  category: {
    type: DataTypes.STRING, 
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  subscriptionType: {
    type: DataTypes.ENUM('shared', 'individual'),
    defaultValue: 'individual',
  },
  isSharedActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
});

module.exports = NewsletterSource;