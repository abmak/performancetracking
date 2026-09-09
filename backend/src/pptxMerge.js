// pptxMerge.js
// Wraps a fully generated pptxgenjs report deck inside the official VAS
// template: keeps template slides 1-5 (title + intro pages) at the front,
// inserts the generated *content* slides in the middle, and keeps template
// slide 7 ("Thank You") as the closing page.
//
// Merge strategy (validated against PowerPoint's OPC rules):
//  - The TEMPLATE file is the base, so its slides/masters/layouts/themes/media
//    stay byte-identical (intro pages render exactly as authored).
//  - Only the needed content slides are imported from the generated deck.
//    Each imported part (slide -> layout -> master -> theme, charts,
//    embeddings, media) is copied under a fresh non-colliding name and its
//    relationships are re-mapped.  Notes slides are dropped.
//  - presentation.xml slide/master lists and [Content_Types].xml are rebuilt.

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const R_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';
const R_SLIDE_MASTER = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster';

const TEMPLATE_PATH = path.join(__dirname, 'assets', 'template.pptx');

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i + 1).toLowerCase();
}
function resolveRef(partPath, target) {
  // partPath like "ppt/slides/slide1.xml", target is relative to its folder
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null; // external / uri scheme
  if (target.startsWith('/')) {
    // absolute-from-package-root targets (pptxgenjs writes chart rels this way)
    return target.replace(/^\//, '');
  }
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const parts = (dir + '/' + target).split('/');
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  const norm = out.join('/');
  return norm.startsWith('ppt/') ? norm : null;
}

// ---------------------------------------------------------------- template helpers
function slideList(zip) {
  // returns [{ file, rid }] in the template's display order (slides only)
  const relsXml = zip.file('ppt/_rels/presentation.xml.rels').async('string');
  return relsXml.then(rels => {
    const ridMap = {};
    for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      if (m[2].endsWith('/slide') || m[2].endsWith('/slideMaster')) ridMap[m[1]] = m[3];
    }
    return zip.file('ppt/presentation.xml').async('string').then(pres => {
      const lst = (pres.match(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/) || [''])[0];
      const ids = [...lst.matchAll(/r:id="(rId\d+)"/g)].map(m => m[1]);
      return ids.map(rid => ({ file: ridMap[rid], rid })).filter(s => s.file && s.file.startsWith('slides/'));
    });
  });
}

// Extracts the Ethio Telecom brand logo (the small top-left logo the template
// shows on its branded pages) into a standalone file so generated report
// slides can re-use it. Picks the smallest picture on template slide 6.
async function extractTemplateLogo(destPath, opts = {}) {
  const templatePath = opts.templatePath || TEMPLATE_PATH;
  const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
  const s6 = zip.file('ppt/slides/slide6.xml');
  const rels6 = zip.file('ppt/slides/_rels/slide6.xml.rels');
  if (!s6 || !rels6) return null;
  const xml = await s6.async('string');
  const relsXml = await rels6.async('string');
  const ridTarget = {};
  for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) ridTarget[m[1]] = m[2];
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map(p => p[0]);
  let best = null;
  for (const pic of pics) {
    const emb = (pic.match(/r:embed="(rId\d+)"/) || [])[1];
    const ext = (pic.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/) || []);
    if (!emb || !ext) continue;
    const w = Number(ext[1]) / 914400;
    const h = Number(ext[2]) / 914400;
    const area = w * h;
    if (!best || area < best.area) best = { area, target: ridTarget[emb] };
  }
  if (!best || !best.target) return null;
  const mediaPath = 'ppt/' + best.target.replace('../', '');
  const f = zip.file(mediaPath);
  if (!f) return null;
  fs.writeFileSync(destPath, await f.async('nodebuffer'));
  return destPath;
}

// ---------------------------------------------------------------- deck import
async function importDeckSlides(tzip, dzip, deckSlideFiles) {
  // copy closure of every part reachable from deckSlideFiles, renamed safely
  const rename = new Map(); // original "ppt/..." path -> new "ppt/..." path
  const queue = deckSlideFiles.map(f => 'ppt/' + f);
  let ctr = 0;
  const newSlidePaths = [];
  const newMasterPaths = [];
  const pendingRels = new Map(); // new part path -> original rels path in deck

  while (queue.length) {
    const orig = queue.shift();
    if (rename.has(orig) || orig.startsWith('ppt/notes')) continue;
    const dir = orig.slice(0, orig.lastIndexOf('/'));
    const base = orig.slice(orig.lastIndexOf('/') + 1);
    let nb;
    if (dir === 'ppt/slides') { ctr++; nb = 'slide' + (700 + ctr) + '.xml'; newSlidePaths.push(dir + '/' + nb); }
    else if (dir === 'ppt/slideLayouts') { ctr++; nb = 'slideLayout' + (900 + ctr) + '.xml'; }
    else if (dir === 'ppt/slideMasters') { ctr++; nb = 'slideMaster' + (900 + ctr) + '.xml'; newMasterPaths.push(dir + '/' + nb); }
    else if (dir === 'ppt/theme') { ctr++; nb = 'theme' + (900 + ctr) + '.xml'; }
    else if (dir === 'ppt/charts') { ctr++; nb = 'chart' + (900 + ctr) + '.xml'; }
    else if (dir === 'ppt/media') { ctr++; nb = 'media' + (900 + ctr) + '.' + (extOf(base) || 'bin'); }
    else if (dir === 'ppt/embeddings') { ctr++; nb = 'Microsoft_Excel_Worksheet' + (900 + ctr) + '.xlsx'; }
    else continue; // unsupported part type -> skip

    const np = dir + '/' + nb;
    rename.set(orig, np);
    tzip.file(np, await dzip.file(orig).async('nodebuffer'));

    const origRels = dir + '/_rels/' + base + '.rels';
    if (dzip.file(origRels)) {
      pendingRels.set(np, origRels);
      const relsXml = await dzip.file(origRels).async('string');
      for (const m of relsXml.matchAll(/Target="([^"]+)"/g)) {
        const res = resolveRef(orig, m[1]);
        if (res) queue.push(res);
      }
    }
  }

  // rewrite relationship files: drop notes refs, remap renamed targets
  for (const [partPath, origRels] of pendingRels) {
    let relsXml = await dzip.file(origRels).async('string');
    relsXml = relsXml.replace(/<Relationship [^>]*Type="[^"]*\/notesSlide"[^>]*\/>/g, '');
    for (const [orig, np] of rename) {
      const ob = orig.slice(orig.lastIndexOf('/') + 1);
      const nbn = np.slice(np.lastIndexOf('/') + 1);
      if (ob !== nbn) relsXml = relsXml.split(ob).join(nbn);
    }
    const dir = partPath.slice(0, partPath.lastIndexOf('/'));
    const npRels = dir + '/_rels/' + partPath.slice(partPath.lastIndexOf('/') + 1) + '.rels';
    tzip.file(npRels, relsXml);
  }

  return { newSlidePaths, newMasterPaths, rename };
}

// ---------------------------------------------------------------- content types
async function mergeContentTypes(tzip, dzip, rename) {
  const tct = await tzip.file('[Content_Types].xml').async('string');
  const dct = await dzip.file('[Content_Types].xml').async('string');
  const dDef = new Map(); // ext -> type
  const dOvr = new Map(); // /ppt/... -> type
  for (const m of dct.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"/g)) dDef.set(m[1].toLowerCase(), m[2]);
  for (const m of dct.matchAll(/<Override PartName="(\/[^"]+)" ContentType="([^"]+)"/g)) dOvr.set(m[1], m[2]);

  const addDefault = [];
  const addOverride = [];
  for (const [orig, np] of rename) {
    const dType = dOvr.get('/' + orig);
    if (dType) addOverride.push(`<Override PartName="/${np}" ContentType="${dType}"/>`);
    else {
      const e = extOf(orig);
      const t = dDef.get(e);
      if (t) addDefault.push(`<Default Extension="${e}" ContentType="${t}"/>`);
    }
  }
  let out = tct;
  const insert = [];
  for (const d of addDefault) {
    const e = (d.match(/Extension="([^"]+)"/) || [])[1].toLowerCase();
    if (!new RegExp(`<Default Extension="${e}" `, 'i').test(out)) insert.push(d);
  }
  for (const o of addOverride) {
    const p = (o.match(/PartName="([^"]+)"/) || [])[1];
    if (!out.includes(p)) insert.push(o);
  }
  if (insert.length) {
    out = out.replace(/<\/Types>/, insert.join('') + '</Types>');
  }
  tzip.file('[Content_Types].xml', out);
}

// ---------------------------------------------------------------- presentation wiring
async function rebuildPresentation(tzip, templateOrder, keepIntro, deckNew) {
  const pres = await tzip.file('ppt/presentation.xml').async('string');
  const rels = await tzip.file('ppt/_rels/presentation.xml.rels').async('string');

  // ---- relationships: figure out next free rId
  const usedRids = new Set();
  for (const m of rels.matchAll(/"rId(\d+)"/g)) usedRids.add(Number(m[1]));
  let nextRid = Math.max(0, ...usedRids) + 1;

  let relsOut = rels.replace(/<\/Relationships>/, '');
  const slideRelTargets = new Map(); // new slide path -> rid
  for (const np of deckNew.newSlidePaths) {
    const rid = 'rId' + nextRid++;
    relsOut += `<Relationship Id="${rid}" Type="${R_SLIDE}" Target="${np.slice(4)}"/>`;
    slideRelTargets.set(np, rid);
  }
  let masterRid = null;
  if (deckNew.newMasterPaths.length) {
    masterRid = 'rId' + nextRid++;
    relsOut += `<Relationship Id="${masterRid}" Type="${R_SLIDE_MASTER}" Target="${deckNew.newMasterPaths[0].slice(4)}"/>`;
  }
  relsOut += '</Relationships>';

  // ---- master id list: append the imported deck master
  let presOut = pres;
  if (masterRid) {
    const masterIds = [...pres.matchAll(/<p:sldMasterId id="(\d+)"/g)].map(m => Number(m[1]));
    const newMasterId = Math.max(2147483648, ...masterIds) + 100;
    presOut = presOut.replace(
      /<\/p:sldMasterIdLst>/,
      `<p:sldMasterId id="${newMasterId}" r:id="${masterRid}"/></p:sldMasterIdLst>`
    );
  }

  // ---- slide id list: template intro (by template file basename) + deck + Thank You
  const byFile = new Map(templateOrder.map(t => [t.file.split('/').pop(), t]));
  const ridToEl = new Map();
  for (const el of pres.matchAll(/<p:sldId [^>]*\/?>/g)) {
    const rid = (el[0].match(/r:id="(rId\d+)"/) || [])[1];
    if (rid) ridToEl.set(rid, el[0]);
  }
  const elFor = t => (t ? ridToEl.get(t.rid) : null);

  const existingSldIds = [...pres.matchAll(/<p:sldId id="(\d+)"/g)].map(m => Number(m[1]));
  let nextSldId = Math.max(0, ...existingSldIds) + 1;
  const newEls = deckNew.newSlidePaths.map(np =>
    `<p:sldId id="${nextSldId++}" r:id="${slideRelTargets.get(np)}"/>`
  );

  const final = [
    ...keepIntro.map(f => elFor(byFile.get(f))),
    ...newEls,
    elFor(byFile.get('slide7.xml')), // template Thank You closes the deck
  ].filter(Boolean).join('');
  presOut = presOut.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${final}</p:sldIdLst>`);

  tzip.file('ppt/presentation.xml', presOut);
  tzip.file('ppt/_rels/presentation.xml.rels', relsOut);
}

// ---------------------------------------------------------------- public API
// deckBuffer: nodebuffer of the fully generated pptxgenjs report
async function wrapWithTemplate(deckBuffer, opts = {}) {
  const templatePath = opts.templatePath || TEMPLATE_PATH;
  const tzip = await JSZip.loadAsync(fs.readFileSync(templatePath));
  const dzip = await JSZip.loadAsync(deckBuffer);

  const tOrder = await slideList(tzip); // template display order (slides only)
  const dOrder = await slideList(dzip); // deck display order

  // Template pages to keep at the front (slides 1-5 by file name, in display order)
  const keepIntro = opts.keepIntro || ['slide1.xml', 'slide2.xml', 'slide3.xml', 'slide4.xml', 'slide5.xml'];
  // Deck content = everything except its own title, TOC and Thank-You pages
  const skipFirst = opts.deckSkipFirst ?? 2;
  const skipLast = opts.deckSkipLast ?? 1;
  const contentFiles = dOrder.slice(skipFirst, dOrder.length - skipLast).map(s => s.file);
  if (!contentFiles.length) throw new Error('No content slides to import from generated deck');

  const deckNew = await importDeckSlides(tzip, dzip, contentFiles);
  await mergeContentTypes(tzip, dzip, deckNew.rename);
  await rebuildPresentation(tzip, tOrder, keepIntro, deckNew);

  return tzip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { wrapWithTemplate, extractTemplateLogo };
