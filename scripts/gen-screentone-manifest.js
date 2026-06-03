const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'assets/screentones';
const out = path.join(dir, 'manifest.json');

const files = fs.readdirSync(dir)
  .filter(f => /\.(png|jpe?g|svg)$/i.test(f))
  .sort();

const manifest = files.map(f => ({
  name: f.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
  filename: f
}));

fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`Wrote ${manifest.length} entries to ${out}`);
