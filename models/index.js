const sequelize = require('../config/database');
const User = require('./User');
const NewsletterSource = require('./NewsletterSource');
const UserNewsletterSubscription = require('./UserNewsletterSubscription');

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

module.exports = {
  sequelize,
  User,
  NewsletterSource,
  UserNewsletterSubscription,
};