import fs from 'fs';
const content = fs.readFileSync('src/lib/trackData.json', 'utf8');
const match = content.match(/notes:\s+(\[[\s\S]*\])/);
if (match) {
  const json = {
    title: "Moonlight Sonata - 1st Movement",
    bpm: 49,
    notes: JSON.parse(match[1])
  };
  fs.writeFileSync('src/lib/trackData.json', JSON.stringify(json, null, 2));
}
