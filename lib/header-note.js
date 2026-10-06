'use strict';

const HEADER_NOTE_LINE_MAX = 240;
const HEADER_NOTE_COUNT = 3;
const HEADER_NOTE_AUTHOR_MAX = 40;

function clip(value, max) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f]/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function noteTextOf(item) {
  if (item && typeof item === 'object') return clip(item.text || item.body || '', HEADER_NOTE_LINE_MAX);
  return clip(item || '', HEADER_NOTE_LINE_MAX);
}

function noteAuthorOf(item) {
  if (!item || typeof item !== 'object') return '';
  return clip(item.author || '', HEADER_NOTE_AUTHOR_MAX).toLowerCase();
}

function readHeaderNoteItems(raw) {
  if (raw == null || raw === '') return [];
  let updatedBy = '';
  let list = null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === 'object') {
      updatedBy = clip(parsed.updatedBy || '', HEADER_NOTE_AUTHOR_MAX).toLowerCase();
      if (Array.isArray(parsed.notes)) list = parsed.notes;
      else list = parsed.text ? [parsed.text] : [];
    } else if (typeof parsed === 'string') {
      list = [parsed];
    }
  } catch (e) {
    const plain = clip(String(raw), HEADER_NOTE_LINE_MAX);
    return plain ? [{ text: plain, author: '' }] : [];
  }
  const out = [];
  (list || []).forEach((item) => {
    if (out.length >= HEADER_NOTE_COUNT) return;
    const text = noteTextOf(item);
    if (!text) return;
    out.push({ text, author: noteAuthorOf(item) || updatedBy });
  });
  return out;
}

function headerNoteTexts(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (out.length >= HEADER_NOTE_COUNT) return;
    const text = noteTextOf(item);
    if (text) out.push(text);
  });
  return out;
}

/** Değişmeyen satır eski amirde kalır; yeni veya değişen satır kaydeden amire yazılır. */
function assignHeaderNoteAuthors(incoming, previous, username) {
  const author = clip(username || '', HEADER_NOTE_AUTHOR_MAX).toLowerCase();
  const prev = (Array.isArray(previous) ? previous : []).map((item) => ({
    text: noteTextOf(item),
    author: noteAuthorOf(item),
    used: false,
  })).filter((item) => item.text);
  return headerNoteTexts(incoming).map((text, index) => {
    const sameSlot = prev[index];
    if (sameSlot && !sameSlot.used && sameSlot.text === text) {
      sameSlot.used = true;
      return { text, author: sameSlot.author || author };
    }
    const match = prev.find((item) => !item.used && item.text === text);
    if (match) {
      match.used = true;
      return { text, author: match.author || author };
    }
    return { text, author };
  });
}

function headerNotePayload(items, username, now) {
  const notes = (Array.isArray(items) ? items : []).slice(0, HEADER_NOTE_COUNT);
  return {
    notes,
    authors: notes.map((item) => item.author || ''),
    text: notes[0] ? notes[0].text : '',
    updatedAt: Number(now) || Date.now(),
    updatedBy: clip(username || '', HEADER_NOTE_AUTHOR_MAX).toLowerCase(),
  };
}

module.exports = {
  HEADER_NOTE_LINE_MAX,
  HEADER_NOTE_COUNT,
  readHeaderNoteItems,
  headerNoteTexts,
  assignHeaderNoteAuthors,
  headerNotePayload,
};
