'use strict';

/** Security classification labels and their palette, shared by every template. */
const CLASSIFICATIONS = Object.freeze({
  top_secret:   { label: 'سري للغاية ومكتوم', color: '#8A1B1B', bg: '#FDF2F2', border: '#F8B4B4' },
  secret:       { label: 'سري وخاص',          color: '#8A6A12', bg: '#FCF7EA', border: '#F4D89A' },
  official:     { label: 'رسمي',               color: '#02443A', bg: '#E7F0EA', border: '#A6D0BA' },
  unclassified: { label: 'غير مصنف',          color: '#5E6B64', bg: '#F0EDE4', border: '#DDD8CA' }
});

const VALID_CLASSIFICATIONS = Object.freeze(Object.keys(CLASSIFICATIONS));

function resolveClassification(value) {
  return CLASSIFICATIONS[value] || CLASSIFICATIONS.official;
}

function formatArabicDate(date = new Date()) {
  return date.toLocaleDateString('ar-SY', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

module.exports = {
  CLASSIFICATIONS,
  VALID_CLASSIFICATIONS,
  resolveClassification,
  formatArabicDate
};
