// Node stand-in for expo-crypto in Jest.
module.exports = { randomUUID: () => require('node:crypto').randomUUID() };
