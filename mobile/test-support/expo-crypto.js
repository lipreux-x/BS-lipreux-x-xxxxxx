// Node stand-in for expo-crypto in Jest.
const crypto = require('node:crypto');
module.exports = {
  randomUUID: () => crypto.randomUUID(),
  getRandomValues: (array) => crypto.getRandomValues(array),
};
