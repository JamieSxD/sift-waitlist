const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserYouTubeSubscription = sequelize.define('UserYouTubeSubscription', {
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
  youtubeChannelId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'YouTubeChannels',
      key: 'id',
    },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  subscribedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  preferences: {
    type: DataTypes.JSONB,
    defaultValue: {
      notifications: true,
      priority: 'normal', // high, normal, low
      uploadTypes: ['all'], // all, shorts, videos, live
    },
  },
  sourceType: {
    type: DataTypes.ENUM('oauth', 'manual'),
    allowNull: false,
    defaultValue: 'oauth',
  },
});

module.exports = UserYouTubeSubscription;