const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const YouTubeVideo = sequelize.define('YouTubeVideo', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  videoId: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true, // YouTube video ID should be unique
  },
  youtubeChannelId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'YouTubeChannels',
      key: 'id',
    },
  },
  title: {
    type: DataTypes.TEXT,
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
  duration: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  publishedAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  viewCount: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  likeCount: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  videoType: {
    type: DataTypes.ENUM('video', 'short', 'live', 'premiere'),
    defaultValue: 'video',
  },
  videoUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isProcessed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  approvalStatus: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'auto_approved'),
    defaultValue: 'pending',
  },
});

// User-specific YouTube video interactions
const UserYouTubeVideoInteraction = sequelize.define('UserYouTubeVideoInteraction', {
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
  youtubeVideoId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'YouTubeVideos',
      key: 'id',
    },
  },
  caughtUp: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  caughtUpAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  isWatched: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  watchedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  indexes: [
    {
      unique: true,
      fields: ['userId', 'youtubeVideoId']
    }
  ]
});

module.exports = { YouTubeVideo, UserYouTubeVideoInteraction };