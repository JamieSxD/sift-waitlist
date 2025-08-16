const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserSpotifySubscription = sequelize.define('UserSpotifySubscription', {
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
  spotifyArtistId: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: 'spotify_artists',
      key: 'id',
    },
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  addedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'user_spotify_subscriptions',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['userId', 'spotifyArtistId'],
    },
  ],
});

module.exports = UserSpotifySubscription;