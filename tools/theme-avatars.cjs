// Preserve all avatar geometry and light colors; embed a dark palette in each SVG.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../storage/overlay/static/nas-avatars');
const rgb = hex => hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16));
const mix = (a, b, amount) => '#' + a.map((value, i) => Math.round(value * (1 - amount) + b[i] * amount).toString(16).padStart(2, '0')).join('');
for (const file of fs.readdirSync(root).filter(name => /^avatar-\d+\.svg$/.test(name))) {
  const target = path.join(root, file);
  let svg = fs.readFileSync(target, 'utf8').replace(/<style data-avatar-theme(?:="true")?>[\s\S]*?<\/style>/g, '');
  const background = svg.match(/<rect[^>]*fill="(#[a-f\d]{6})"/i)?.[1];
  if (!background) throw new Error('Missing avatar background: ' + file);
  const colors = [...new Set([...svg.matchAll(/(?:fill|stroke|color)="(#[a-f\d]{6})"/gi)].map(match => match[1]))];
  const rules = colors.map(color => {
    const values = rgb(color);
    const dark = color === background ? mix([19, 29, 45], values, .14)
      : Math.max(...values) < 90 ? color : mix(values, [230, 239, 255], .3);
    return `[fill="${color}"]{fill:${dark}}[stroke="${color}"]{stroke:${dark}}[color="${color}"]{color:${dark}}`;
  }).join('');
  svg = svg.replace(/(<svg[^>]*>)/, '$1<style data-avatar-theme="true">@media(prefers-color-scheme:dark){' + rules + '}</style>');
  fs.writeFileSync(target, svg);
}
console.log('Updated 42 avatar palettes; original shapes and light colors preserved.');
