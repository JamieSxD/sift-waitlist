const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const NewsletterSubscription = sequelize.define('NewsletterSubscription', {
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
  autoApprove: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  subscribedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  lastContentAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
});

module.exports = NewsletterSubscription;