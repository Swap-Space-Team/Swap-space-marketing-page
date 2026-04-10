import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, '../assets');

ffmpeg.setFfmpegPath(ffmpegStatic);
mkdirSync(`${assetsDir}/videos`, { recursive: true });

const videos = [
  { input: 'Solo travel.mp4',   output: 'solo-travel.mp4' },
  { input: 'Family travel.mp4', output: 'family-travel.mp4' },
  { input: 'Retiree video.mp4', output: 'retiree.mp4' },
  { input: 'Remote worker.mp4', output: 'remote-worker.mp4' },
];

for (const { input, output } of videos) {
  const inputPath  = `${assetsDir}/${input}`;
  const outputPath = `${assetsDir}/videos/${output}`;
  console.log(`Compressing: ${input} …`);
  await new Promise((res, rej) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .outputOptions([
        '-crf 22',
        '-preset slow',
        '-movflags faststart',
        '-an',
        '-pix_fmt yuv420p',
      ])
      .output(outputPath)
      .on('progress', (p) => {
        if (p.percent) process.stdout.write(`\r  ${Math.round(p.percent)}%  `);
      })
      .on('end', () => { process.stdout.write('\n'); console.log(`  ✓ assets/videos/${output}`); res(); })
      .on('error', (err) => { console.error(`  ✗ ${input}: ${err.message}`); rej(err); })
      .run();
  });
}
console.log('\nAll videos compressed → assets/videos/');
