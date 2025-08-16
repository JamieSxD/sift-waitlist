const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserSpotifyToken = sequelize.define('UserSpotifyToken', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  spotifyUserId: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  accessToken: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  refreshToken: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  tokenType: {
    type: DataTypes.STRING,
    defaultValue: 'Bearer',
  },
  scope: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  lastRefreshed: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'user_spotify_tokens',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['userId'],
    },
    {
      fields: ['spotifyUserId'],
    },
  ],
});

module.exports = UserSpotifyToken;