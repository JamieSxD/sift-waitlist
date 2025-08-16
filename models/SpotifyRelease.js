const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SpotifyRelease = sequelize.define('SpotifyRelease', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true, // Spotify album/single ID
  },
  spotifyArtistId: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'spotify_artists',
      key: 'id',
    },
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  albumType: {
    type: DataTypes.ENUM('album', 'single', 'compilation'),
    allowNull: false,
  },
  releaseDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  releaseDatePrecision: {
    type: DataTypes.ENUM('year', 'month', 'day'),
    allowNull: false,
  },
  imageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  externalUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  totalTracks: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  markets: {
    type: DataTypes.TEXT, // JSON string array
    allowNull: true,
  },
  discoveredAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'spotify_releases',
  timestamps: true,
  indexes: [
    {
      fields: ['spotifyArtistId'],
    },
    {
      fields: ['releaseDate'],
    },
    {
      fields: ['discoveredAt'],
    },
  ],
});

// Model for tracking user interactions with releases
const UserSpotifyReleaseInteraction = sequelize.define('UserSpotifyReleaseInteraction', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  spotifyReleaseId: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'spotify_releases',
      key: 'id',
    },
  },
  interactionType: {
    type: DataTypes.ENUM('view', 'like', 'dismiss', 'save'),
    allowNull: false,
  },
  interactedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'user_spotify_release_interactions',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['userId', 'spotifyReleaseId', 'interactionType'],
    },
  ],
});

module.exports = { SpotifyRelease, UserSpotifyReleaseInteraction };