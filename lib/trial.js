// Access restrictions are now controlled only by an admin through unlimitedAccess.
// They do not block login; that is controlled separately by `status`.
const TRIAL_PRACTICE_LIMIT = 50;

function isTrialRestricted(user) {
  return !!user && user.role === 'user' && !user.unlimitedAccess;
}

module.exports = { isTrialRestricted, TRIAL_PRACTICE_LIMIT };
