const sequelize = require('../config/database');
const User = require('./User');
const NewsletterSource = require('./NewsletterSource');
const NewsletterSubscription = require('./NewsletterSubscription');
const UserBlockList = require('./UserBlockList');
const { NewsletterContent, UserContentInteraction } = require('./NewsletterContent');

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

module.exports = {
  sequelize,
  User,
  NewsletterSource,
  NewsletterSubscription,
  UserBlockList,
  NewsletterContent,
  UserContentInteraction,
};