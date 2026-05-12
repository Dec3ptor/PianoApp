import fs from 'fs';

const content = fs.readFileSync('src/lib/trackData.json', 'utf8');
const match = content.match(/notes:\s+(\[[\s\S]*\])/);
if (match) {
  // eval the string
  const notes = eval(match[1]);
  const json = {
    title: "Moonlight Sonata - 1st Movement",
    bpm: 49,
    notes: notes
  };
  fs.writeFileSync('src/lib/trackData.json', JSON.stringify(json, null, 2));
}
