import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const [projectPath, outputStem, ...checks] = process.argv.slice(2);
assert(
  projectPath && outputStem && checks.length && checks.length % 4 === 0,
  'Usage: node scripts/tectonic-synctex-probe.mjs <project-dir> <output-stem> <source> <line> <page> "<PDF text>" [...]',
);
const project = resolve(projectPath);
const stem = resolve(project, outputStem);
const signedInteger = "(-?\\d+)";
const locationRecord = new RegExp(
  `^([hxgkr$(])(\\d+),(\\d+)(?:,-?\\d+)?:${signedInteger},${signedInteger}(?::${signedInteger}(?:,-?\\d+,-?\\d+)?)?$`,
);

// The reference reader converts TeX scaled points to PDF points with this
// denominator. Magnification scales positions and dimensions; offsets use
// the un-magnified unit. Scope this probe to Tectonic's PDF preamble.
const scaledPointsPerPdfPoint = (65536 * 72.27) / 72;

function parseSyncTeX(data) {
  const contents = gunzipSync(data, {
    maxOutputLength: 32 * 1024 * 1024,
  }).toString("utf8");
  const [preamble, content] = contents.split(/^Content:\r?$/m);
  assert(
    /^SyncTeX Version:1\r?$/m.test(preamble),
    "Expected SyncTeX format version 1",
  );
  assert(/^Output:pdf\r?$/m.test(preamble), "Expected a PDF SyncTeX file");
  assert(
    content && /^Postamble:\r?$/m.test(content),
    "Missing SyncTeX content or postamble",
  );
  const unit = Number(preamble.match(/^Unit:(\d+)\r?$/m)?.[1]);
  const magnification = Number(
    preamble.match(/^Magnification:(\d+)\r?$/m)?.[1],
  );
  const xOffset = Number(preamble.match(/^X Offset:(-?\d+)\r?$/m)?.[1]);
  const yOffset = Number(preamble.match(/^Y Offset:(-?\d+)\r?$/m)?.[1]);
  assert(
    unit > 0 &&
      magnification > 0 &&
      Number.isFinite(xOffset) &&
      Number.isFinite(yOffset),
  );
  const offsetScale = unit / scaledPointsPerPdfPoint;
  const scale = (offsetScale * magnification) / 1000;

  // Bundle inputs can appear beside project files. Only index readable
  // project sources so an inverse jump resolves to the editor's document.
  const sources = new Map();
  const records = [];
  const pages = new Set();
  let page = 0;
  for (const row of contents.split(/\r?\n/)) {
    const input = row.match(/^Input:(\d+):(.+)$/);
    if (input) {
      const [, tag, inputPath] = input;
      const path = resolve(project, inputPath);
      const localPath = relative(project, path);
      if (
        localPath &&
        !isAbsolute(localPath) &&
        localPath !== ".." &&
        !localPath.startsWith(`..${sep}`) &&
        existsSync(path)
      ) {
        sources.set(Number(tag), localPath.split(sep).join("/"));
      }
    }
    const sheet = row.match(/^\{(\d+)$/);
    if (sheet) {
      page = Number(sheet[1]);
      pages.add(page);
      continue;
    }
    if (row.startsWith("}")) {
      page = 0;
      continue;
    }
    if (page === 0) continue;
    const record = row.match(locationRecord);
    if (record) {
      const [, type, tag, line, h, v, width] = record;
      records.push({
        type,
        tag: Number(tag),
        line: Number(line),
        page,
        x: Number(h) * scale + xOffset * offsetScale,
        y: Number(v) * scale + yOffset * offsetScale,
        width: Number(width ?? 0) * scale,
      });
    }
  }
  const projectRecords = records.flatMap(({ tag, ...record }) => {
    const source = sources.get(tag);
    return source && record.line > 0 ? [{ source, ...record }] : [];
  });
  assert(
    projectRecords.length > 0,
    "No SyncTeX positions for the project sources",
  );
  return {
    sources,
    pages,
    records: projectRecords,
    unit,
    magnification,
    xOffset,
    yOffset,
  };
}

function anchorPriority(record) {
  // Prefer source-mapped glyphs over enclosing boxes, whose line may refer
  // to the following command rather than the text inside the box.
  if (record.type === "g") return 0;
  if (record.type === "h") return 1;
  if (record.type === "x") return 2;
  if (record.type === "(" && record.width > 0) return 3;
  return 4;
}

function forward(records, source, line) {
  const candidates = records.filter(
    (record) => record.source === source && record.line === line,
  );
  return candidates.sort((a, b) => anchorPriority(a) - anchorPriority(b))[0];
}

function distanceFromSpan(x, left, right) {
  return Math.max(left - x, 0, x - right);
}

function backward(records, page, x, y) {
  const pageRecords = records.filter((record) => record.page === page);
  const glyphRecords = pageRecords.filter((record) =>
    ["g", "h", "x"].includes(record.type),
  );
  const candidates = glyphRecords.length ? glyphRecords : pageRecords;
  const rank = (record) => {
    const end = record.x + record.width;
    const dx = distanceFromSpan(
      x,
      Math.min(record.x, end),
      Math.max(record.x, end),
    );
    const dy = Math.abs(y - record.y);
    return dy * 5 + dx + anchorPriority(record);
  };
  return candidates.sort((a, b) => rank(a) - rank(b))[0];
}

async function pdfTextPositions(pdf) {
  const positions = [];
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const pdfPage = await pdf.getPage(page);
    assert.equal(pdfPage.rotate, 0, "The probe expects an unrotated PDF page");
    const viewport = pdfPage.getViewport({ scale: 1 });
    const text = await pdfPage.getTextContent();
    for (const item of text.items) {
      if (!item.str?.trim()) continue;
      const [x, y] = viewport.convertToViewportPoint(
        item.transform[4],
        item.transform[5],
      );
      positions.push({
        text: item.str,
        page,
        x,
        y,
        width: item.width,
        height: item.height,
      });
    }
  }
  return positions;
}

const [syncData, pdfData] = await Promise.all([
  readFile(`${stem}.synctex.gz`),
  readFile(`${stem}.pdf`),
]);
const sync = parseSyncTeX(syncData);
const pdfTask = getDocument({ data: new Uint8Array(pdfData) });
const pdf = await pdfTask.promise;
const evidence = [];
try {
  assert.equal(
    sync.pages.size,
    pdf.numPages,
    "SyncTeX and PDF page counts differ",
  );
  const pdfPositions = await pdfTextPositions(pdf);
  for (let i = 0; i < checks.length; i += 4) {
    const [rawSource, rawLine, rawPage, marker] = checks.slice(i, i + 4);
    const source = relative(project, resolve(project, rawSource))
      .split(sep)
      .join("/");
    const line = Number(rawLine);
    const page = Number(rawPage);
    const label = `${source}:${line}`;
    const sourceLines = (
      await readFile(resolve(project, source), "utf8")
    ).split(/\r?\n/);
    assert(
      sourceLines[line - 1]?.includes(marker),
      `${label} must contain "${marker}"`,
    );
    const forwardHit = forward(sync.records, source, line);
    assert(forwardHit, `SyncTeX does not map ${label}`);
    assert.equal(forwardHit.page, page, `Unexpected PDF page for ${label}`);
    const matches = pdfPositions.filter((item) => item.text.includes(marker));
    assert.equal(
      matches.length,
      1,
      `Expected a unique PDF text item containing "${marker}"`,
    );
    const [text] = matches;
    assert.equal(text.page, page, `Unexpected PDF text page for ${label}`);
    const deltaY = Math.abs(forwardHit.y - text.y);
    const forwardEnd = forwardHit.x + forwardHit.width;
    const deltaX = Math.max(
      Math.min(forwardHit.x, forwardEnd) - (text.x + text.width),
      0,
      text.x - Math.max(forwardHit.x, forwardEnd),
    );
    assert(
      deltaY < 1 && deltaX < 1,
      `SyncTeX and PDF text differ by (${deltaX}, ${deltaY}) pt for ${label}`,
    );

    const click = {
      page,
      x: text.x + text.width / 2,
      y: text.y - text.height / 3,
    };
    const backwardHit = backward(sync.records, click.page, click.x, click.y);
    const roundTrip = backward(
      sync.records,
      forwardHit.page,
      forwardHit.x,
      forwardHit.y,
    );
    for (const hit of [backwardHit, roundTrip]) {
      assert.equal(
        `${hit.source}:${hit.line}`,
        label,
        `Unexpected inverse hit for "${marker}": ${JSON.stringify(hit)}`,
      );
    }
    evidence.push({
      source,
      line,
      marker,
      forwardHit,
      pdfText: text,
      deltaX,
      deltaY,
      click,
      backwardHit,
      roundTrip,
    });
  }
} finally {
  await pdfTask.destroy();
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      pageCount: sync.pages.size,
      projectSources: [...new Set(sync.sources.values())],
      projectRecords: sync.records.length,
      conversion: {
        unit: sync.unit,
        magnification: sync.magnification,
        xOffset: sync.xOffset,
        yOffset: sync.yOffset,
        output: "PDF points, top-left origin",
      },
      cases: evidence,
    },
    null,
    2,
  ),
);
