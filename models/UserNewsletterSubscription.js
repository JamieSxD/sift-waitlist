const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserNewsletterSubscription = sequelize.define('UserNewsletterSubscription', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  newsletterSourceId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'NewsletterSources',
      key: 'id',
    },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  forwardingEmail: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // Each forwarding email must be unique
  },
  preferences: {
    type: DataTypes.JSONB,
    defaultValue: {
      notifications: true,
      priority: 'normal', // high, normal, low
    },
  },
  subscribedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
});

module.exports = UserNewsletterSubscription;