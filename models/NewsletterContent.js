const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const NewsletterContent = sequelize.define('NewsletterContent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  newsletterSourceId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'NewsletterSources',
      key: 'id',
    },
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id',
    },
  },
  approvalStatus: {
    type: DataTypes.ENUM('pending', 'approved', 'blocked'),
    defaultValue: 'pending',
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Original email data
  originalSubject: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  originalHtml: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  originalFrom: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  senderDomain: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  detectedNewsletterName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  detectedCategory: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  receivedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },

  // Extracted structured content
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },

  sections: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },

  // Processing status
  processingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending',
  },
  processingError: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // Analytics
  extractionConfidence: {
    type: DataTypes.FLOAT,
    defaultValue: 0.0,
  },
  wordCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },

  // SEO and search
  searchText: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  tags: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: [],
  },
});

const UserContentInteraction = sequelize.define('UserContentInteraction', {
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
  newsletterContentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'NewsletterContents',
      key: 'id',
    },
  },

  // User actions
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  readAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  isSaved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  savedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  isArchived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },

  // Reading analytics
  timeSpentReading: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  scrollProgress: {
    type: DataTypes.FLOAT,
    defaultValue: 0.0,
  },

  // Engagement
  clickedLinks: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  rating: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

module.exports = { NewsletterContent, UserContentInteraction };