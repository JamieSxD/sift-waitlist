const sequelize = require('../config/database');
const User = require('./User');
const NewsletterSource = require('./NewsletterSource');
const UserNewsletterSubscription = require('./UserNewsletterSubscription');
const { NewsletterContent, UserContentInteraction } = require('./NewsletterContent');

// Define associations
User.hasMany(UserNewsletterSubscription, {
  foreignKey: 'userId',
  as: 'subscriptions'
});

UserNewsletterSubscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user'
});

NewsletterSource.hasMany(UserNewsletterSubscription, {
  foreignKey: 'newsletterSourceId',
  as: 'subscriptions'
});

UserNewsletterSubscription.belongsTo(NewsletterSource, {
  foreignKey: 'newsletterSourceId',
  as: 'newsletter'
});

// New content associations
NewsletterSource.hasMany(NewsletterContent, {
  foreignKey: 'newsletterSourceId',
  as: 'content'
});

NewsletterContent.belongsTo(NewsletterSource, {
  foreignKey: 'newsletterSourceId',
  as: 'source'
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
  UserNewsletterSubscription,
  NewsletterContent,
  UserContentInteraction,
};