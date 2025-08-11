/**
 * Generate a stable inbox email for a user based on their email address
 * Format: [username]@inbox.siftly.space or [username][number]@inbox.siftly.space for collisions
 * 
 * @param {string} userEmail - User's original email address
 * @param {Function} checkExisting - Function to check if email already exists
 * @returns {string} - Generated inbox email
 */
async function generateInboxEmail(userEmail, checkExisting = null) {
  if (!userEmail) {
    throw new Error('User email is required to generate inbox email');
  }

  // Extract username part (before @)
  const username = userEmail.split('@')[0].toLowerCase();
  
  // Clean username to be email-safe (remove special chars, keep alphanumeric and dashes)
  const cleanUsername = username.replace(/[^a-z0-9]/g, '');
  
  // Start with base email
  let inboxEmail = `${cleanUsername}@inbox.siftly.space`;
  
  // If we have a function to check for existing emails, handle collisions
  if (checkExisting) {
    let counter = 1;
    while (await checkExisting(inboxEmail)) {
      inboxEmail = `${cleanUsername}${counter}@inbox.siftly.space`;
      counter++;
    }
  }
  
  return inboxEmail;
}

/**
 * Validate if an email belongs to inbox.siftly.space domain
 * @param {string} email - Email to validate
 * @returns {boolean} - True if it's a siftly.space inbox email
 */
function isInboxEmail(email) {
  return email && email.endsWith('@inbox.siftly.space');
}

module.exports = {
  generateInboxEmail,
  isInboxEmail
};