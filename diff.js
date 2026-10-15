#!/usr/bin/env node
/**
 * JSON Diff CLI - AI-friendly interface
 *
 * Usage:
 *   node diff.js <file1.json> <file2.json>              # Compare two files
 *   node diff.js <file1.json> <file2.json> -o out.json  # Output to file
 *   node diff.js --watch                                # Watch mode for AI integration
 *
 * Watch Mode (AI Integration):
 *   Place files in ./input/ folder:
 *     - input/left.json   (first JSON)
 *     - input/right.json  (second JSON)
 *
 *   Run: node diff.js --watch
 *
 *   Result written to: ./output/result.json
 *
 *   To trigger comparison, create file: ./input/.compare
 *   Script watches for this trigger file, runs diff, deletes trigger.
 */

const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TRIGGER_FILE = path.join(INPUT_DIR, '.compare');

function findDiffs(obj1, obj2, currentPath = '') {
  const diffs = [];

  // Type mismatch
  if (typeof obj1 !== typeof obj2 || Array.isArray(obj1) !== Array.isArray(obj2)) {
    diffs.push({
      type: 'modified',
      path: currentPath || 'root',
      oldValue: obj1,
      newValue: obj2
    });
    return diffs;
  }

  // Primitives or null
  if (typeof obj1 !== 'object' || obj1 === null) {
    if (obj1 !== obj2) {
      diffs.push({
        type: 'modified',
        path: currentPath || 'root',
        oldValue: obj1,
        newValue: obj2
      });
    }
    return diffs;
  }

  // Objects/Arrays
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  const allKeys = new Set([...keys1, ...keys2]);

  for (const key of allKeys) {
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    const inObj1 = key in obj1;
    const inObj2 = key in obj2;

    if (inObj1 && !inObj2) {
      diffs.push({ type: 'removed', path: newPath, value: obj1[key] });
    } else if (!inObj1 && inObj2) {
      diffs.push({ type: 'added', path: newPath, value: obj2[key] });
    } else {
      diffs.push(...findDiffs(obj1[key], obj2[key], newPath));
    }
  }

  return diffs;
}

function compareFiles(file1, file2) {
  let json1, json2;

  try {
    json1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
  } catch (e) {
    return { error: `Failed to parse ${file1}: ${e.message}` };
  }

  try {
    json2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
  } catch (e) {
    return { error: `Failed to parse ${file2}: ${e.message}` };
  }

  const diffs = findDiffs(json1, json2);

  return {
    identical: diffs.length === 0,
    diffCount: diffs.length,
    diffs: diffs,
    summary: diffs.length === 0
      ? 'No differences found'
      : `Found ${diffs.length} difference(s)`,
    files: {
      left: file1,
      right: file2
    },
    timestamp: new Date().toISOString()
  };
}

function ensureDirs() {
  if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR);
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
}

function runComparison() {
  const leftFile = path.join(INPUT_DIR, 'left.json');
  const rightFile = path.join(INPUT_DIR, 'right.json');
  const outputFile = path.join(OUTPUT_DIR, 'result.json');

  if (!fs.existsSync(leftFile)) {
    const result = { error: 'input/left.json not found' };
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    return result;
  }

  if (!fs.existsSync(rightFile)) {
    const result = { error: 'input/right.json not found' };
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    return result;
  }

  const result = compareFiles(leftFile, rightFile);
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`Result written to ${outputFile}`);
  return result;
}

function watchMode() {
  ensureDirs();
  console.log('JSON Diff - Watch Mode');
  console.log('======================');
  console.log(`Watching: ${INPUT_DIR}`);
  console.log(`Output:   ${OUTPUT_DIR}/result.json`);
  console.log('');
  console.log('Place left.json and right.json in input/');
  console.log('Create input/.compare to trigger comparison');
  console.log('');

  // Initial check
  if (fs.existsSync(TRIGGER_FILE)) {
    fs.unlinkSync(TRIGGER_FILE);
    runComparison();
  }

  // Watch for trigger
  fs.watch(INPUT_DIR, (eventType, filename) => {
    if (filename === '.compare' && fs.existsSync(TRIGGER_FILE)) {
      console.log(`[${new Date().toISOString()}] Trigger detected, running comparison...`);
      fs.unlinkSync(TRIGGER_FILE);
      const result = runComparison();
      if (result.error) {
        console.log(`Error: ${result.error}`);
      } else {
        console.log(`Done: ${result.summary}`);
      }
    }
  });
}

// CLI
const args = process.argv.slice(2);

if (args.includes('--watch') || args.includes('-w')) {
  watchMode();
} else if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(`
JSON Diff CLI

Usage:
  node diff.js <file1> <file2>              Compare two JSON files
  node diff.js <file1> <file2> -o <out>     Compare and save to file
  node diff.js --watch                      Watch mode for AI integration
  node diff.js --once                       One-shot mode (input/left.json + right.json)

Watch Mode:
  1. Place left.json and right.json in ./input/
  2. Create ./input/.compare file to trigger
  3. Read result from ./output/result.json

Examples:
  node diff.js config-old.json config-new.json
  node diff.js a.json b.json -o diff-result.json
  `);
} else if (args.includes('--once')) {
  ensureDirs();
  const result = runComparison();
  console.log(JSON.stringify(result, null, 2));
} else if (args.length >= 2) {
  const file1 = args[0];
  const file2 = args[1];
  const outputIdx = args.indexOf('-o');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  const result = compareFiles(file1, file2);

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
    console.log(`Result written to ${outputFile}`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
