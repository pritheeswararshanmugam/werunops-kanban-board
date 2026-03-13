const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const root = path.resolve(__dirname, '..', '..');
  const seedFile = path.join(root, 'backend', 'data', 'state_store.seed.json');
  const stateFile = path.join(root, 'backend', 'data', 'state_store.json');

  if (!fs.existsSync(seedFile)) {
    throw new Error(`Missing seed state file: ${seedFile}`);
  }

  fs.copyFileSync(seedFile, stateFile);
};
