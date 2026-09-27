// New "user" accounts get a 24-hour full trial. After that, unless a master/regular
// admin has granted them unlimitedAccess, they move into a RESTRICTED mode: capped at
// TRIAL_PRACTICE_LIMIT distinct questions ever practiced, and My Test Results / Practice
// Log are unavailable. This does NOT block login (that's the separate admin block/grant
// toggle on `status`) - it's a lighter usage cap, not an account lock.
const TRIAL_HOURS = 24;
const TRIAL_PRACTICE_LIMIT = 50;

function isTrialRestricted(user) {
  if (!user || user.role !== 'user' || user.unlimitedAccess) return false;
  const ageMs = Date.now() - new Date(user.createdAt).getTime();
  return ageMs > TRIAL_HOURS * 60 * 60 * 1000;
}

module.exports = { isTrialRestricted, TRIAL_HOURS, TRIAL_PRACTICE_LIMIT };
