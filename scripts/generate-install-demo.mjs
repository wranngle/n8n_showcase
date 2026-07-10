#!/usr/bin/env node
// Deterministic generator for docs/install-demo.mp4 plus the 3x-speed
// docs/install-demo.webp README embed. Renders text slides with ffmpeg drawtext,
// concatenates them, and emits an MP4 no longer than 90s / 10MB.
//
// Honesty contract: every count, command, and output line in `slides` below must
// be reproducible against this checkout. Verified 2026-07-09:
//   - registry entry count:  grep '    path:' workflows/registry.yaml  (3 lines)
//   - workflow JSON count:   find workflows -name '*.json' | wc -l     (5 files)
//   - governance output:     node scripts/governance-engine.js \
//                              workflows/dev/pipeline-test-webhook-processor.json
//                            prints exactly "Governance Check: PASSED", exits 0
//   - installer contract:    scripts/install-workflow.js prints the new workflow
//                            id and exits 0 on success (described, not transcribed)
// Do not add slide lines that show terminal output you did not capture from a
// real run against the tree.

import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, statSync, existsSync, rmSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outDir = join(repoRoot, 'docs');
const outFile = join(outDir, 'install-demo.mp4');
const outWebp = join(outDir, 'install-demo.webp');
const workDir = join(repoRoot, '.work', 'install-demo');

const fontCandidates = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf',
  '/usr/share/fonts/truetype/ubuntu/UbuntuMono[wght].ttf',
];

function pickFont() {
  for (const candidate of fontCandidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No monospace font found; install ttf-dejavu or liberation-mono-fonts.');
}

const slides = [
  {
    title: 'n8n Workflow Library',
    body: [
      'sanitized, ready-to-import flows',
      '3 registry entries, 5 workflow JSON files',
      'one-click install path',
    ],
    seconds: 5,
    accent: '0x00b894',
  },
  {
    title: '1. Browse the registry',
    body: [
      "$ grep '    path:' workflows/registry.yaml",
      '    path: "lead-enrichment-microservice.json"',
      '    path: "lead-intake-main.json"',
      '    path: "knowledge_management/youtube-rag-pipeline/workflow.json"',
    ],
    seconds: 7,
    accent: '0x4a90e2',
  },
  {
    title: '2. Install into local n8n',
    body: [
      '$ node scripts/install-workflow.js workflows/lead-intake-main.json \\',
      '    --n8n-url http://localhost:5678 --api-key $N8N_API_KEY',
      '',
      'on success: prints the new workflow id, exits 0',
    ],
    seconds: 8,
    accent: '0x9b59b6',
  },
  {
    title: '3. Verify governance',
    body: [
      '$ node scripts/governance-engine.js \\',
      '    workflows/dev/pipeline-test-webhook-processor.json',
      'Governance Check: PASSED',
    ],
    seconds: 7,
    accent: '0x27ae60',
  },
  {
    title: 'Done.',
    body: [
      'registry, installer, governance: all in this repo',
      'github.com/wranngle/n8n',
    ],
    seconds: 5,
    accent: '0x2c3e50',
  },
];

const totalSeconds = slides.reduce((sum, s) => sum + s.seconds, 0);
const width = 1280;
const height = 720;
const fps = 24;
const font = pickFont();

// The text lands inside text='...' in a filtergraph passed as one argv element
// (no shell). Two parsers unescape it in sequence: the filtergraph option
// parser (quotes, backslash escapes) and drawtext's own expansion pass.
// Frame-verified against ffmpeg 6.1: colon, comma, and brackets take ONE
// backslash; percent and literal backslash take TWO (one per layer); a quote
// closes the quoted run, emits an escaped quote, and reopens it.
function escapeForDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function buildSlideFilter(slide) {
  const titleY = 120;
  const bodyStartY = 240;
  const lineSpacing = 56;
  const filters = [];
  filters.push(
    [
      `drawbox=x=0:y=0:w=${width}:h=8:color=${slide.accent}:t=fill`,
      `drawbox=x=0:y=${height - 8}:w=${width}:h=8:color=${slide.accent}:t=fill`,
    ].join(','),
  );
  filters.push(
    `drawtext=fontfile='${font}':text='${escapeForDrawtext(slide.title)}':fontcolor=white:fontsize=44:x=80:y=${titleY}`,
  );
  slide.body.forEach((line, index) => {
    if (line.trim() === '') return; // spacer line, nothing to draw
    // drawtext drops leading whitespace; preserve indentation via x offset
    // (16px per space at fontsize 26 monospace).
    const indent = line.length - line.trimStart().length;
    const x = 80 + indent * 16;
    filters.push(
      `drawtext=fontfile='${font}':text='${escapeForDrawtext(line.trimStart())}':fontcolor=0xd0d6dc:fontsize=26:x=${x}:y=${bodyStartY + index * lineSpacing}`,
    );
  });
  filters.push(
    `drawtext=fontfile='${font}':text='wranngle/n8n':fontcolor=0x7f8c8d:fontsize=18:x=${width - 200}:y=${height - 50}`,
  );
  return filters.join(',');
}

function renderSlide(slide, index) {
  const segmentFile = join(workDir, `slide-${String(index).padStart(2, '0')}.mp4`);
  const filterChain = buildSlideFilter(slide);
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', `color=c=0x1a1f24:s=${width}x${height}:d=${slide.seconds}:r=${fps}`,
    '-vf', filterChain,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-movflags', '+faststart',
    segmentFile,
  ];
  const result = spawnSync('ffmpeg', args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error(`ffmpeg failed on slide ${index}`);
  return segmentFile;
}

function concatSegments(segmentFiles) {
  const listPath = join(workDir, 'concat-list.txt');
  writeFileSync(listPath, segmentFiles.map((file) => `file '${file}'`).join('\n') + '\n');
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    outFile,
  ];
  const result = spawnSync('ffmpeg', args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error('ffmpeg concat failed');
}

function renderWebpDerivative() {
  // 3x-speed 800x450 looping webp of the mp4, for inline README embedding.
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', outFile,
    '-vf', 'setpts=PTS/3,fps=10,scale=800:450:flags=lanczos',
    '-loop', '0',
    '-c:v', 'libwebp',
    '-q:v', '60',
    '-an',
    outWebp,
  ];
  const result = spawnSync('ffmpeg', args, {stdio: 'inherit'});
  if (result.status !== 0) throw new Error('ffmpeg webp derivative failed');
}

function main() {
  if (totalSeconds > 90) {
    throw new Error(`Slide budget exceeds 90s (${totalSeconds}s). Adjust slides[].seconds.`);
  }
  rmSync(workDir, {recursive: true, force: true});
  mkdirSync(workDir, {recursive: true});
  mkdirSync(outDir, {recursive: true});
  const segmentFiles = slides.map((slide, index) => renderSlide(slide, index));
  concatSegments(segmentFiles);
  const sizeBytes = statSync(outFile).size;
  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb > 10) {
    throw new Error(`Output exceeds 10MB budget: ${sizeMb.toFixed(2)}MB. Tune CRF/resolution.`);
  }
  console.log(`wrote ${outFile} (${sizeMb.toFixed(2)}MB, ${totalSeconds}s, ${slides.length} slides)`);
  renderWebpDerivative();
  const webpMb = statSync(outWebp).size / (1024 * 1024);
  console.log(`wrote ${outWebp} (${webpMb.toFixed(2)}MB, 3x speed)`);
}

main();
