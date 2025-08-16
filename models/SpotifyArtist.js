const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SpotifyArtist = sequelize.define('SpotifyArtist', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true, // Spotify artist ID
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  imageUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  genres: {
    type: DataTypes.TEXT, // JSON string array
    allowNull: true,
  },
  popularity: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  followers: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  externalUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  lastChecked: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'spotify_artists',
  timestamps: true,
});

module.exports = SpotifyArtist;