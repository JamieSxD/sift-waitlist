const sequelize = require('../config/database');
const User = require('./User');
const NewsletterSource = require('./NewsletterSource');
const NewsletterSubscription = require('./NewsletterSubscription');
const UserNewsletterSubscription = require('./UserNewsletterSubscription');
const UserBlockList = require('./UserBlockList');
const { NewsletterContent, UserContentInteraction } = require('./NewsletterContent');
const YouTubeChannel = require('./YouTubeChannel');
const UserYouTubeSubscription = require('./UserYouTubeSubscription');
const { YouTubeVideo, UserYouTubeVideoInteraction } = require('./YouTubeVideo');

// Define associations

// User associations
User.hasMany(NewsletterSubscription, {
  foreignKey: 'userId',
  as: 'subscriptions'
});

User.hasMany(UserBlockList, {
  foreignKey: 'userId',
  as: 'blockList'
});

User.hasMany(NewsletterContent, {
  foreignKey: 'userId',
  as: 'content'
});

// NewsletterSubscription associations
NewsletterSubscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

NewsletterSubscription.belongsTo(NewsletterSource, {
  foreignKey: 'newsletterSourceId',
  as: 'newsletter'
});

// NewsletterSource associations
NewsletterSource.hasMany(NewsletterSubscription, {
  foreignKey: 'newsletterSourceId',
  as: 'subscriptions'
});

// UserBlockList associations
UserBlockList.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// NewsletterContent associations
NewsletterSource.hasMany(NewsletterContent, {
  foreignKey: 'newsletterSourceId',
  as: 'content'
});

NewsletterContent.belongsTo(NewsletterSource, {
  foreignKey: 'newsletterSourceId',
  as: 'source'
});

NewsletterContent.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

// UserNewsletterSubscription associations
User.hasMany(UserNewsletterSubscription, {
  foreignKey: 'userId',
  as: 'newsletterSubscriptions'
});

UserNewsletterSubscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

NewsletterSource.hasMany(UserNewsletterSubscription, {
  foreignKey: 'newsletterSourceId',
  as: 'userSubscriptions'
});

UserNewsletterSubscription.belongsTo(NewsletterSource, {
  foreignKey: 'newsletterSourceId',
  as: 'newsletterSource'
});

User.hasMany(UserContentInteraction, {
  foreignKey: 'userId',
  as: 'contentInteractions'
});

UserContentInteraction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

NewsletterContent.hasMany(UserContentInteraction, {
  foreignKey: 'newsletterContentId',
  as: 'interactions'
});

UserContentInteraction.belongsTo(NewsletterContent, {
  foreignKey: 'newsletterContentId',
  as: 'content'
});

// YouTube associations
User.hasMany(UserYouTubeSubscription, {
  foreignKey: 'userId',
  as: 'youtubeSubscriptions'
});

UserYouTubeSubscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

YouTubeChannel.hasMany(UserYouTubeSubscription, {
  foreignKey: 'youtubeChannelId',
  as: 'userSubscriptions'
});

UserYouTubeSubscription.belongsTo(YouTubeChannel, {
  foreignKey: 'youtubeChannelId',
  as: 'youtubeChannel'
});

YouTubeChannel.hasMany(YouTubeVideo, {
  foreignKey: 'youtubeChannelId',
  as: 'videos'
});

YouTubeVideo.belongsTo(YouTubeChannel, {
  foreignKey: 'youtubeChannelId',
  as: 'youtubeChannel'
});

// YouTube Video Interaction associations
User.hasMany(UserYouTubeVideoInteraction, {
  foreignKey: 'userId',
  as: 'youtubeVideoInteractions'
});

UserYouTubeVideoInteraction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

YouTubeVideo.hasMany(UserYouTubeVideoInteraction, {
  foreignKey: 'youtubeVideoId',
  as: 'userInteractions'
});

UserYouTubeVideoInteraction.belongsTo(YouTubeVideo, {
  foreignKey: 'youtubeVideoId',
  as: 'video'
});

module.exports = {
  sequelize,
  User,
  NewsletterSource,
  NewsletterSubscription,
  UserNewsletterSubscription,
  UserBlockList,
  NewsletterContent,
  UserContentInteraction,
  YouTubeChannel,
  UserYouTubeSubscription,
  YouTubeVideo,
  UserYouTubeVideoInteraction,
};