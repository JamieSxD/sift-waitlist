const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { generateInboxEmail } = require('../utils/emailUtils');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ where: { googleId: profile.id } });

    if (user) {
      return done(null, user);
    }

    // Generate unique inbox email
    const userEmail = profile.emails[0].value;
    const checkExisting = async (inboxEmail) => {
      const existingUser = await User.findOne({ where: { inboxEmail } });
      return !!existingUser;
    };
    
    const inboxEmail = await generateInboxEmail(userEmail, checkExisting);

    user = await User.create({
      googleId: profile.id,
      name: profile.displayName,
      email: userEmail,
      avatar: profile.photos?.[0]?.value,
      inboxEmail,
    });

    return done(null, user);
  } catch (error) {
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;