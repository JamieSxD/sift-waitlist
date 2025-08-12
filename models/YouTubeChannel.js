const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const YouTubeChannel = sequelize.define('YouTubeChannel', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  channelId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // YouTube channel ID should be unique
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  thumbnail: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  subscriberCount: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  videoCount: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  lastChecked: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  channelUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

module.exports = YouTubeChannel;