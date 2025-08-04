const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.redirect('/?login=required');
  };

  module.exports = { requireAuth };